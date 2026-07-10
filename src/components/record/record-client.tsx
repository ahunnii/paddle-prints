"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Map as MapLibreMap } from "maplibre-gl";

import { nextPoiAhead, type CorridorPoi } from "~/lib/recorder/next-poi";
import { simplifyTrack } from "~/lib/recorder/simplify";
import type { RecorderState, TripType } from "~/lib/recorder/types";
import {
  clearCheckpoint,
  readLiveCheckpoint,
  useRecorder,
} from "~/lib/recorder/use-recorder";
import type { Checkpoint } from "~/lib/recorder/checkpoint";
import { poiMeta, truncateNote, type PoiCategory } from "~/lib/pois";
import { queuePaddle, savePoiQueued, syncQueue } from "~/lib/offline/sync";
import { NavMap } from "~/components/record/nav-map";
import { PoiPlacement } from "~/components/map/poi-placement";
import { toast } from "~/components/ui/toaster";

const METERS_PER_MILE = 1609.344;
// `GeolocationPositionError.PERMISSION_DENIED` -- hardcoded rather than referencing the DOM
// constructor, which doesn't exist during server-side rendering of this client component.
const GEO_PERMISSION_DENIED = 1;

export interface RecordRoute {
  id: string;
  name: string;
  distanceM: number;
  shape: "one_way" | "out_and_back";
  type: "river" | "waypoint";
  coords: Array<[number, number]>;
  pois: CorridorPoi[];
  /** The paddler's personal historical cruising speed for this route (see `routes.etaForUser`), fed
   * into the live ETA blend so it starts from a real number instead of the generic 3.0 mph default. */
  historicalSpeedMps?: number;
}

function miles(m: number, dp = 2) {
  return (m / METERS_PER_MILE).toFixed(dp);
}

function formatElapsed(totalS: number) {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(sec)}`;
}

function formatEtaClock(etaSeconds: number | undefined) {
  if (etaSeconds == null || !Number.isFinite(etaSeconds)) return "--:--";
  const at = new Date(Date.now() + etaSeconds * 1000);
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Build the tRPC create input from a finished machine state. */
function buildInput(
  machine: RecorderState,
  routeId: string | null,
  tripType: TripType,
  id: string,
  note: string,
) {
  // Full fidelity into trackJson; ~10 m Douglas-Peucker into the stored geometry.
  const simplified = simplifyTrack(machine.track, 10);
  const coords = simplified.map((p) => [p.lng, p.lat] as [number, number]);
  const avgSpeedMps = machine.movingS > 0 ? machine.distanceM / machine.movingS : 0;
  return {
    id,
    routeId,
    tripType,
    startedAt: new Date(machine.startedAt ?? Date.now()),
    elapsedS: Math.round(machine.elapsedS),
    movingS: Math.round(machine.movingS),
    distanceM: machine.distanceM,
    avgSpeedMps,
    trackGeom:
      coords.length >= 2
        ? ({ type: "LineString" as const, coordinates: coords })
        : null,
    trackJson: machine.track.length > 0 ? machine.track : null,
    note: note.trim().length > 0 ? note.trim() : null,
  };
}

export function RecordClient({ route }: { route: RecordRoute | null }) {
  const router = useRouter();

  const configure = useRecorder((s) => s.configure);
  const start = useRecorder((s) => s.start);
  const pause = useRecorder((s) => s.pause);
  const resume = useRecorder((s) => s.resume);
  const finish = useRecorder((s) => s.finish);
  const restoreFrom = useRecorder((s) => s.restoreFrom);
  const discard = useRecorder((s) => s.discard);
  const dispose = useRecorder((s) => s.dispose);

  const note = useRecorder((s) => s.note);
  const setNote = useRecorder((s) => s.setNote);
  const headingDeg = useRecorder((s) => s.headingDeg);

  const machine = useRecorder((s) => s.machine);
  const progress = useRecorder((s) => s.progress);
  const eta = useRecorder((s) => s.eta);
  const routeModel = useRecorder((s) => s.routeModel);
  const wakeLockOk = useRecorder((s) => s.wakeLockOk);
  const gpsAcc = useRecorder((s) => s.gpsAccuracyM);
  const geoError = useRecorder((s) => s.geoError);
  const geoErrorCode = useRecorder((s) => s.geoErrorCode);
  const lowAccuracyHint = useRecorder((s) => s.lowAccuracyHint);

  const [tripType, setTripType] = useState<TripType>(route?.type ?? "river");
  const [showMap, setShowMap] = useState(true);
  const [pending, setPending] = useState<Checkpoint | null>(null);
  const [navMap, setNavMap] = useState<MapLibreMap | null>(null);
  const [placingPoi, setPlacingPoi] = useState(false);
  const [savingPoi, setSavingPoi] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const paddleId = useRef<string | null>(null);

  // Add-a-spot centers a crosshair over the map; save reads the map center and ALWAYS queues to
  // IndexedDB first (uniform online + offline), then a background sync ships it. Server dedupes by
  // the client uuid, so this can't duplicate. Mirrors the community map's handler.
  const handleSavePoi = useCallback(
    async (category: PoiCategory, note: string) => {
      if (!navMap) return;
      setSavingPoi(true);
      setPoiError(null);
      try {
        const center = navMap.getCenter();
        const status = await savePoiQueued({
          category,
          note: note.trim().length > 0 ? note.trim() : undefined,
          point: { lng: center.lng, lat: center.lat },
        });
        toast(status === "synced" ? "Spot saved" : "Saved offline — will sync when online");
        setPlacingPoi(false);
      } catch (err) {
        setPoiError(err instanceof Error ? err.message : "Couldn't save. Try again.");
      } finally {
        setSavingPoi(false);
      }
    },
    [navMap],
  );

  const nextPoi =
    route && progress && !progress.offRoute && routeModel
      ? nextPoiAhead(route.pois, route.shape, routeModel.totalM, progress.progressM)
      : null;

  // Configure the recorder for this page, and surface any live checkpoint as a resume offer.
  useEffect(() => {
    configure({
      routeId: route?.id ?? null,
      tripType: route?.type ?? "river",
      routeCoords: route?.coords ?? null,
      routeShape: route?.shape ?? "one_way",
      historicalSpeedMps: route?.historicalSpeedMps,
    });
    // Checkpoint lives in IndexedDB now, so the resume check is async.
    let cancelled = false;
    void readLiveCheckpoint().then((cp) => {
      if (!cancelled) setPending(cp);
    });
    return () => {
      cancelled = true;
      dispose();
    };
    // Only re-run if the route identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]);

  // Finishing ALWAYS writes the paddle to the offline queue first, then fires a background sync and
  // navigates to the summary immediately. The summary renders from IndexedDB until the sync lands, so
  // this path is identical online and offline -- no "save failed, retry" dead-ends on the river.
  const submit = useCallback(async () => {
    // Read the machine AND note straight from the store at finish time, not from a stale render
    // closure -- a note typed after the last commit still ships.
    const state = useRecorder.getState();
    paddleId.current ??= crypto.randomUUID();
    const input = buildInput(
      state.machine,
      route?.id ?? null,
      tripType,
      paddleId.current,
      state.note,
    );
    await queuePaddle(input);
    clearCheckpoint();
    void syncQueue();
    toast(
      navigator.onLine
        ? "Trip saved"
        : "Saved offline — will sync when online",
    );
    router.push(`/paddles/${input.id}`);
  }, [route?.id, tripType, router]);

  const handleFinish = useCallback(() => {
    if (!window.confirm("Finish and save this paddle?")) return;
    finish();
    void submit();
  }, [finish, submit]);

  // Guard the brief window between finish() and the router.push landing: the paddle has been queued
  // to IndexedDB (or is a millisecond from it) but the summary hasn't loaded yet. Closing the tab
  // here would be the only true data-loss gap. Recording in progress is NOT guarded -- the
  // checkpoint/resume system already covers a reload mid-paddle.
  useEffect(() => {
    if (machine.status !== "finished") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [machine.status]);

  const status = machine.status;
  const isPreStart = status === "idle";
  const isPaused = status === "manualPaused";
  const isAutoPaused = status === "autoPaused";
  const isAcquiring = status === "acquiring";
  const isFinished = status === "finished";

  const livePos = useMemo(() => {
    const last = machine.track[machine.track.length - 1];
    return last ? { lng: last.lng, lat: last.lat } : null;
  }, [machine.track]);

  const contextMatches = (pending?.routeId ?? null) === (route?.id ?? null);

  // --- resume / discard prompt ---------------------------------------------
  if (pending && isPreStart) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-river-950 px-6 text-center text-white">
        <span className="text-5xl">🛶</span>
        <h1 className="font-display text-2xl font-extrabold">Resume your paddle?</h1>
        <p className="text-river-200 max-w-xs text-sm">
          {contextMatches
            ? "We found an unfinished paddle on this device."
            : "You have an unfinished paddle on another route."}{" "}
          You&apos;ve logged {miles(pending.machine.distanceM)} mi so far.
        </p>
        <div className="flex w-full max-w-xs flex-col gap-3">
          {contextMatches ? (
            <button
              type="button"
              onClick={() => {
                void restoreFrom(pending);
                setPending(null);
              }}
              className="active:bg-sunset-600 active:scale-[0.98] min-h-14 rounded-2xl bg-sunset-500 text-lg font-bold text-white shadow-lg"
            >
              Resume paddle
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              discard();
              clearCheckpoint();
              setPending(null);
            }}
            className="text-river-200 active:bg-river-900 min-h-12 rounded-2xl border border-river-700 font-semibold"
          >
            Discard it
          </button>
        </div>
      </main>
    );
  }

  // --- pre-start ------------------------------------------------------------
  if (isPreStart) {
    return (
      <main className="flex min-h-dvh flex-col bg-river-950 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-center justify-between">
          <Link href={route ? `/routes/${route.id}` : "/"} className="text-river-300 text-sm font-semibold">
            ← Back
          </Link>
          <span className="text-river-400 text-xs uppercase tracking-widest">
            Record
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <span className="text-5xl">🛶</span>
          {route ? (
            <div>
              <h1 className="font-display text-2xl font-extrabold">{route.name}</h1>
              <p className="text-river-300 mt-1 text-sm">
                {miles(route.distanceM * (route.shape === "out_and_back" ? 2 : 1), 1)} mi
                {route.shape === "out_and_back" ? " round trip" : ""} ·{" "}
                {route.type === "river" ? "River" : "Lake / open water"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <h1 className="font-display text-2xl font-extrabold">Free paddle</h1>
              <div className="flex items-center gap-1 rounded-full bg-river-900 p-1">
                {(["river", "waypoint"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTripType(t)}
                    className={`min-h-11 rounded-full px-4 text-sm font-semibold ${
                      tripType === t ? "bg-river-600 text-white" : "text-river-300"
                    }`}
                  >
                    {t === "river" ? "River" : "Open water"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-river-400 max-w-xs text-xs">
            Keep the screen on — locking the phone stops GPS. We&apos;ll ask for
            location when you tap Start.
          </p>
        </div>

        <label className="mb-3 block">
          <span className="text-river-400 mb-1 block text-xs uppercase tracking-widest">
            Trip notes (optional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Conditions, who came along, anything to remember…"
            className="text-river-50 placeholder:text-river-500 focus:border-river-500 w-full resize-none rounded-2xl border border-river-800 bg-river-900 px-3 py-2 text-sm outline-none"
          />
        </label>

        <button
          type="button"
          onClick={() => void start()}
          className="min-h-16 rounded-3xl bg-sunset-500 text-xl font-extrabold text-white shadow-2xl active:scale-[0.98] active:bg-sunset-600"
        >
          START
        </button>
      </main>
    );
  }

  // --- nav mode -------------------------------------------------------------
  const distanceMi = miles(machine.distanceM);
  const remainingMi = progress ? miles(progress.remainingM) : null;

  return (
    <main className="relative flex h-dvh w-dvw flex-col overscroll-none bg-black text-white">
      {/* next-poi-ahead banner */}
      {nextPoi ? (
        <div className="flex items-center gap-2 border-b border-amber-400/30 bg-black px-4 py-2 text-sm font-bold text-amber-400">
          <span className="text-lg">{poiMeta(nextPoi.poi.category).emoji}</span>
          <span className="truncate">
            {nextPoi.poi.note ? truncateNote(nextPoi.poi.note) : poiMeta(nextPoi.poi.category).label} in{" "}
            {miles(nextPoi.distanceAheadM, 1)} mi
          </span>
        </div>
      ) : null}

      {/* status chips -- opaque backgrounds + light text for sunlight readability */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-xs font-bold">
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-white">
          GPS {gpsAcc != null ? `±${Math.round(gpsAcc)}m` : "…"}
        </span>
        {isAcquiring ? (
          <span className="rounded-full bg-amber-500/30 px-2.5 py-1 text-amber-200">
            Acquiring…
          </span>
        ) : null}
        {isAutoPaused ? (
          <span className="rounded-full bg-amber-500/30 px-2.5 py-1 text-amber-200">
            Auto-paused
          </span>
        ) : null}
        {isPaused ? (
          <span className="rounded-full bg-white/25 px-2.5 py-1 text-white">Paused</span>
        ) : null}
        {progress?.offRoute ? (
          <span className="rounded-full bg-red-500/30 px-2.5 py-1 text-red-200">
            Off route
          </span>
        ) : null}
        {!wakeLockOk ? (
          <span className="rounded-full bg-red-500/30 px-2.5 py-1 text-red-200">
            Screen may sleep
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="ml-auto rounded-full bg-white/15 px-3 py-1 text-white"
        >
          📝 Notes{note.trim().length > 0 ? " •" : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="rounded-full bg-white/15 px-3 py-1 text-white"
        >
          {showMap ? "Stats only" : "Show map"}
        </button>
      </div>

      {/* stats -- digits are the biggest thing on screen, pure white/amber on near-black */}
      <div className={showMap ? "px-4 py-2" : "flex flex-1 flex-col justify-center px-4"}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Distance" value={distanceMi} unit="mi" big />
          {remainingMi != null ? (
            <Stat label="Remaining" value={remainingMi} unit="mi" big />
          ) : (
            <Stat label="Moving" value={formatElapsed(machine.movingS)} big />
          )}
          <Stat label="Elapsed" value={formatElapsed(machine.elapsedS)} />
          {progress ? (
            <Stat label="ETA" value={formatEtaClock(eta?.etaSeconds)} />
          ) : (
            <Stat
              label="Avg mph"
              value={
                machine.movingS > 0
                  ? ((machine.distanceM / machine.movingS) * 2.2369363).toFixed(1)
                  : "0.0"
              }
            />
          )}
        </div>
      </div>

      {/* map */}
      {showMap ? (
        <div className="relative flex-1 overflow-hidden">
          <NavMap
            routeCoords={route?.coords ?? null}
            livePos={livePos}
            snapped={progress?.snapped ?? null}
            headingDeg={headingDeg}
            followSuspended={placingPoi}
            onMap={setNavMap}
            className="h-full w-full"
          />

          <PoiPlacement
            open={placingPoi}
            saving={savingPoi}
            error={poiError}
            onCancel={() => {
              setPlacingPoi(false);
              setPoiError(null);
            }}
            onSave={(category, note) => void handleSavePoi(category, note)}
          />

          {/* "+ Add spot": bottom-left so it clears the recenter button (bottom-right). Hidden
              while the placement card is open and after finishing. */}
          {!placingPoi && !isFinished ? (
            <button
              type="button"
              onClick={() => {
                setPoiError(null);
                setPlacingPoi(true);
              }}
              className="absolute bottom-3 left-3 z-10 flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-bold text-white shadow-lg backdrop-blur active:bg-white/25"
            >
              ＋ Add spot
            </button>
          ) : null}
        </div>
      ) : null}

      {geoError ? (
        geoErrorCode === GEO_PERMISSION_DENIED ? (
          <div className="flex flex-col gap-1 bg-red-950/90 px-4 py-3 text-center text-xs text-red-100">
            <p className="font-bold">Location is blocked</p>
            <p>
              iPhone: Settings → Privacy &amp; Security → Location Services →
              Safari Websites (or the installed app name) → While Using. Then
              reopen.
            </p>
          </div>
        ) : (
          <p className="bg-red-900/60 px-4 py-2 text-center text-xs text-red-200">
            {geoError}
          </p>
        )
      ) : lowAccuracyHint ? (
        <p className="bg-amber-900/70 px-4 py-2 text-center text-xs text-amber-100">
          GPS signal is weak (accuracy over 100m for 30+ seconds). On iPhone,
          try Settings → Privacy &amp; Security → Location Services → Precise
          Location: On.
        </p>
      ) : null}

      {/* controls */}
      <div className="flex items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        {isPaused ? (
          <button
            type="button"
            onClick={resume}
            className="active:bg-river-700 active:scale-[0.98] min-h-14 flex-1 rounded-2xl bg-river-600 text-lg font-bold"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={pause}
            disabled={isFinished}
            className="active:bg-white/20 min-h-14 flex-1 rounded-2xl bg-white/10 text-lg font-bold disabled:opacity-40"
          >
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={handleFinish}
          disabled={isFinished}
          className="min-h-14 flex-1 rounded-2xl bg-sunset-500 text-lg font-extrabold text-white active:scale-[0.98] active:bg-sunset-600 disabled:opacity-60"
        >
          {isFinished ? "Saving…" : "Finish"}
        </button>
      </div>

      {/* Notes bottom sheet. Every keystroke hits the zustand store, which the 15s checkpoint
          interval (and pause/visibility saves) persists -- no extra plumbing. */}
      {showNotes ? (
        <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/90 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-3 px-4 pt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Trip notes</h2>
              <button
                type="button"
                onClick={() => setShowNotes(false)}
                className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-bold text-white active:bg-white/25"
              >
                Done
              </button>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={5}
              maxLength={2000}
              autoFocus
              placeholder="Conditions, wildlife, who came along…"
              className="w-full resize-none rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-base text-white placeholder:text-white/40 outline-none focus:border-white/40"
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Stat({
  label,
  value,
  unit,
  big,
}: {
  label: string;
  value: string;
  unit?: string;
  big?: boolean;
}) {
  return (
    <div>
      <p className="text-[0.65rem] uppercase tracking-widest text-white/50">
        {label}
      </p>
      <p
        className={`font-extrabold tabular-nums leading-none ${
          big ? "text-[clamp(3rem,11vw,4rem)]" : "text-3xl"
        } ${big ? "text-white" : "text-amber-200"}`}
      >
        {value}
        {unit ? <span className="ml-1 text-lg font-bold text-white/60">{unit}</span> : null}
      </p>
    </div>
  );
}
