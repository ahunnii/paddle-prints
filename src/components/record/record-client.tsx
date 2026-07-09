"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { simplifyTrack } from "~/lib/recorder/simplify";
import type { RecorderState, TripType } from "~/lib/recorder/types";
import {
  clearCheckpoint,
  readLiveCheckpoint,
  useRecorder,
} from "~/lib/recorder/use-recorder";
import type { Checkpoint } from "~/lib/recorder/checkpoint";
import { api } from "~/trpc/react";
import { NavMap } from "~/components/record/nav-map";

const METERS_PER_MILE = 1609.344;

export interface RecordRoute {
  id: string;
  name: string;
  distanceM: number;
  shape: "one_way" | "out_and_back";
  type: "river" | "waypoint";
  coords: Array<[number, number]>;
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

  const machine = useRecorder((s) => s.machine);
  const progress = useRecorder((s) => s.progress);
  const eta = useRecorder((s) => s.eta);
  const wakeLockOk = useRecorder((s) => s.wakeLockOk);
  const gpsAcc = useRecorder((s) => s.gpsAccuracyM);
  const geoError = useRecorder((s) => s.geoError);

  const [tripType, setTripType] = useState<TripType>(route?.type ?? "river");
  const [showMap, setShowMap] = useState(true);
  const [pending, setPending] = useState<Checkpoint | null>(null);
  const paddleId = useRef<string | null>(null);

  const create = api.paddles.create.useMutation({
    onSuccess: (row) => {
      clearCheckpoint();
      router.push(`/paddles/${row.id}`);
    },
  });

  // Configure the recorder for this page, and surface any live checkpoint as a resume offer.
  useEffect(() => {
    configure({
      routeId: route?.id ?? null,
      tripType: route?.type ?? "river",
      routeCoords: route?.coords ?? null,
      routeShape: route?.shape ?? "one_way",
    });
    setPending(readLiveCheckpoint());
    return () => dispose();
    // Only re-run if the route identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]);

  const submit = useCallback(() => {
    const m = useRecorder.getState().machine;
    paddleId.current ??= crypto.randomUUID();
    create.mutate(buildInput(m, route?.id ?? null, tripType, paddleId.current));
  }, [create, route?.id, tripType]);

  const handleFinish = useCallback(() => {
    if (!window.confirm("Finish and save this paddle?")) return;
    finish();
    submit();
  }, [finish, submit]);

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
        <h1 className="text-2xl font-extrabold">Resume your paddle?</h1>
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
              className="min-h-14 rounded-2xl bg-sunset-500 text-lg font-bold text-white shadow-lg"
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
            className="text-river-200 min-h-12 rounded-2xl border border-river-700 font-semibold"
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
              <h1 className="text-2xl font-extrabold">{route.name}</h1>
              <p className="text-river-300 mt-1 text-sm">
                {miles(route.distanceM * (route.shape === "out_and_back" ? 2 : 1), 1)} mi
                {route.shape === "out_and_back" ? " round trip" : ""} ·{" "}
                {route.type === "river" ? "River" : "Lake / open water"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-2xl font-extrabold">Free paddle</h1>
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

        <button
          type="button"
          onClick={() => void start()}
          className="min-h-16 rounded-3xl bg-sunset-500 text-xl font-extrabold text-white shadow-2xl active:bg-sunset-600"
          style={{ touchAction: "manipulation" }}
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
    <main
      className="relative flex h-dvh w-dvw flex-col bg-black text-white"
      style={{ touchAction: "manipulation" }}
    >
      {/* status chips */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-xs font-semibold">
        <span className="rounded-full bg-white/10 px-2.5 py-1">
          GPS {gpsAcc != null ? `±${Math.round(gpsAcc)}m` : "…"}
        </span>
        {isAcquiring ? (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-amber-300">
            Acquiring…
          </span>
        ) : null}
        {isAutoPaused ? (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-amber-300">
            Auto-paused
          </span>
        ) : null}
        {isPaused ? (
          <span className="rounded-full bg-white/20 px-2.5 py-1">Paused</span>
        ) : null}
        {progress?.offRoute ? (
          <span className="rounded-full bg-red-500/20 px-2.5 py-1 text-red-300">
            Off route
          </span>
        ) : null}
        {!wakeLockOk ? (
          <span className="rounded-full bg-red-500/20 px-2.5 py-1 text-red-300">
            Screen may sleep
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="ml-auto rounded-full bg-white/10 px-3 py-1"
        >
          {showMap ? "Stats only" : "Show map"}
        </button>
      </div>

      {/* stats */}
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
            className="h-full w-full"
          />
        </div>
      ) : null}

      {geoError ? (
        <p className="bg-red-900/60 px-4 py-2 text-center text-xs text-red-200">
          {geoError}
        </p>
      ) : null}

      {create.isError && isFinished ? (
        <div className="flex items-center justify-between gap-3 bg-red-900/70 px-4 py-3 text-sm">
          <span>Couldn&apos;t save. Your paddle is safe on this device.</span>
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending}
            className="rounded-lg bg-white px-3 py-1.5 font-bold text-red-900 disabled:opacity-50"
          >
            {create.isPending ? "Saving…" : "Retry"}
          </button>
        </div>
      ) : null}

      {/* controls */}
      <div className="flex items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        {isPaused ? (
          <button
            type="button"
            onClick={resume}
            className="min-h-14 flex-1 rounded-2xl bg-river-600 text-lg font-bold"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={pause}
            disabled={isFinished}
            className="min-h-14 flex-1 rounded-2xl bg-white/10 text-lg font-bold disabled:opacity-40"
          >
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={handleFinish}
          disabled={isFinished && create.isPending}
          className="min-h-14 flex-1 rounded-2xl bg-sunset-500 text-lg font-extrabold text-white active:bg-sunset-600 disabled:opacity-60"
        >
          {isFinished ? (create.isPending ? "Saving…" : "Finish") : "Finish"}
        </button>
      </div>
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
          big ? "text-5xl" : "text-3xl"
        } ${big ? "text-white" : "text-amber-300"}`}
      >
        {value}
        {unit ? <span className="ml-1 text-lg font-bold text-white/50">{unit}</span> : null}
      </p>
    </div>
  );
}
