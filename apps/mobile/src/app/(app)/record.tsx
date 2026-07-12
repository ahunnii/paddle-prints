/**
 * The Record tab: a stats-first recording UI (no maps yet -- Phase 3) built on top of the recorder
 * engine in ../../lib/recorder/use-recorder.ts. Three phases driven entirely by `machine.status`:
 *   - idle, no live checkpoint            -> SetupScreen (route/free-paddle picker + Start)
 *   - idle, a live checkpoint exists       -> ResumePrompt (offered before any route picking)
 *   - acquiring/recording/*Paused          -> LiveScreen (big stat tiles + controls)
 *   - finished                            -> FinishedScreen (summary + note + Save/Discard)
 *
 * Mirrors apps/web/src/components/record/record-client.tsx's behavior (resume gating, buildInput
 * construction, status chips, next-POI banner) but uses the app's light river/sunset visual language
 * instead of the web build's night-vision black theme -- this app is used in daylight, in-hand.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { nextPoiAhead, type CorridorPoi } from "@paddle-prints/recorder-core/next-poi";
import { simplifyTrack } from "@paddle-prints/recorder-core/simplify";
import type { TripType } from "@paddle-prints/recorder-core/types";

import {
  formatClock,
  formatDistanceMi,
  formatSpeedMph,
  formatTimeOfDay,
} from "../../lib/format";
import { poiMeta, truncateNote } from "../../lib/pois";
import type { Checkpoint } from "../../lib/recorder/checkpoint";
import { ensureRecorderPermissions } from "../../lib/recorder/permissions";
import { readLiveCheckpoint, useRecorder } from "../../lib/recorder/use-recorder";
import { trpcVanilla } from "../../lib/trpc-vanilla";
import { api, type RouterOutputs } from "../../lib/trpc";
import { getRandomUUID } from "../../lib/uuid";

function permissionMessage(
  reason: "denied" | "needsBackground" | "servicesDisabled",
): string {
  switch (reason) {
    case "denied":
      return "Location access is off. Enable it in Settings to record a paddle.";
    case "servicesDisabled":
      return "Location Services are off on this device. Turn them on in Settings, then try again.";
    case "needsBackground":
      return "Location permissions need an update in Settings.";
  }
}

export default function RecordScreen() {
  const status = useRecorder((s) => s.machine.status);
  // Synchronous read (kv-store is SQLite-backed, no async hydrate step) -- checked once per mount.
  const [pendingCheckpoint, setPendingCheckpoint] = useState<Checkpoint | null>(
    () => readLiveCheckpoint(),
  );

  // The free-paddle trip-type toggle lives here (not inside SetupScreen) so it survives the
  // Setup -> Live -> Finished phase transitions -- each phase is a different mounted component, and
  // the recorder store's own `tripType` for a free paddle is always configured as the "river"
  // default (mirrors apps/web/src/components/record/record-client.tsx, where `configure()` never
  // receives the local trip-type toggle either -- only `buildInput()` at save time does), so it
  // can't be read back from the store for a free paddle.
  const [freeTripType, setFreeTripType] = useState<TripType>("river");

  if (pendingCheckpoint && status === "idle") {
    return (
      <ResumePrompt
        checkpoint={pendingCheckpoint}
        onResolved={() => setPendingCheckpoint(null)}
      />
    );
  }

  if (status === "finished") return <FinishedScreen freeTripType={freeTripType} />;
  if (status !== "idle") return <LiveScreen />;
  return (
    <SetupScreen freeTripType={freeTripType} onFreeTripTypeChange={setFreeTripType} />
  );
}

// --- resume / discard prompt -------------------------------------------------

function ResumePrompt({
  checkpoint,
  onResolved,
}: {
  checkpoint: Checkpoint;
  onResolved: () => void;
}) {
  const configure = useRecorder((s) => s.configure);
  const restoreFrom = useRecorder((s) => s.restoreFrom);
  const discard = useRecorder((s) => s.discard);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResume() {
    setBusy(true);
    setError(null);
    try {
      // A checkpoint carries routeId/tripType but NOT the route's geometry, so a routed checkpoint
      // needs its route re-fetched and re-configured before restoreFrom can rebuild progress/ETA.
      if (checkpoint.routeId) {
        const route = await trpcVanilla.routes.byId.query({ id: checkpoint.routeId });
        configure({
          routeId: route.id,
          tripType: route.type,
          routeCoords: route.geom.coordinates.map(
            (c) => [c[0], c[1]] as [number, number],
          ),
          routeShape: route.shape,
        });
      }
      await restoreFrom(checkpoint);
      onResolved();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't resume that paddle. Try discarding instead.",
      );
      setBusy(false);
    }
  }

  function handleDiscard() {
    discard();
    onResolved();
  }

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-river-50 px-6">
      <Text className="text-5xl">🛶</Text>
      <View className="items-center gap-1">
        <Text className="text-center text-2xl font-extrabold text-river-900">
          Resume your paddle?
        </Text>
        <Text className="max-w-xs text-center text-sm text-river-600">
          We found an unfinished paddle on this device. You&apos;ve logged{" "}
          {formatDistanceMi(checkpoint.machine.distanceM)} so far.
        </Text>
      </View>

      {error ? (
        <Text className="max-w-xs text-center text-sm text-red-600">{error}</Text>
      ) : null}

      <View className="w-full max-w-xs gap-3">
        <Pressable
          onPress={() => void handleResume()}
          disabled={busy}
          className="min-h-14 items-center justify-center rounded-2xl bg-sunset-500 disabled:opacity-60"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-lg font-bold text-white">Resume paddle</Text>
          )}
        </Pressable>
        <Pressable
          onPress={handleDiscard}
          disabled={busy}
          className="min-h-12 items-center justify-center rounded-2xl border border-river-300"
        >
          <Text className="font-semibold text-river-700">Discard it</Text>
        </Pressable>
      </View>
    </View>
  );
}

// --- setup phase: route/free-paddle picker + pre-start confirm --------------

type Selection = { type: "route"; id: string } | { type: "free" };

function SetupScreen({
  freeTripType,
  onFreeTripTypeChange,
}: {
  freeTripType: TripType;
  onFreeTripTypeChange: (t: TripType) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [starting, setStarting] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  const note = useRecorder((s) => s.note);
  const setNote = useRecorder((s) => s.setNote);
  const configure = useRecorder((s) => s.configure);
  const start = useRecorder((s) => s.start);

  const routesQuery = api.routes.list.useQuery(undefined, {
    enabled: selection === null,
  });

  const selectedRouteId = selection?.type === "route" ? selection.id : undefined;
  const byIdQuery = api.routes.byId.useQuery(
    { id: selectedRouteId ?? "" },
    { enabled: !!selectedRouteId },
  );
  const etaQuery = api.routes.etaForUser.useQuery(
    { routeId: selectedRouteId ?? "" },
    { enabled: !!selectedRouteId },
  );

  // Configure the recorder as soon as we know enough: once for a free paddle (the toggle is
  // deliberately NOT a dependency here -- it's read straight from `freeTripType` at save time
  // instead, same as web's buildInput -- so flipping it doesn't reset the store's `note`), or once
  // the route + personal ETA have both loaded for a picked route.
  useEffect(() => {
    if (!selection) return;
    if (selection.type === "free") {
      configure({ routeId: null, tripType: "river", routeCoords: null, routeShape: "one_way" });
      return;
    }
    if (byIdQuery.data && etaQuery.data) {
      const r = byIdQuery.data;
      configure({
        routeId: r.id,
        tripType: r.type,
        routeCoords: r.geom.coordinates.map((c) => [c[0], c[1]] as [number, number]),
        routeShape: r.shape,
        historicalSpeedMps: etaQuery.data.speedMps,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, byIdQuery.data, etaQuery.data]);

  async function handleStart() {
    setPermError(null);
    setStarting(true);
    try {
      const result = await ensureRecorderPermissions();
      if (!result.ok) {
        setPermError(permissionMessage(result.reason));
        return;
      }
      await start();
    } finally {
      setStarting(false);
    }
  }

  if (!selection) {
    return (
      <RoutePickerList
        routes={routesQuery.data}
        loading={routesQuery.isPending}
        error={routesQuery.isError ? routesQuery.error.message : null}
        onSelectRoute={(id) => setSelection({ type: "route", id })}
        onSelectFree={() => setSelection({ type: "free" })}
      />
    );
  }

  const loadingRoute =
    selection.type === "route" && (byIdQuery.isPending || etaQuery.isPending);
  const routeErrored = selection.type === "route" && byIdQuery.isError;
  const route = selection.type === "route" ? byIdQuery.data : null;

  return (
    <ScrollView
      className="flex-1 bg-river-50"
      contentContainerClassName="flex-grow gap-6 p-6"
    >
      <Pressable onPress={() => setSelection(null)} className="self-start">
        <Text className="text-sm font-semibold text-river-600">
          ← Choose a different route
        </Text>
      </Pressable>

      <View className="flex-1 items-center justify-center gap-4">
        <Text className="text-5xl">🛶</Text>
        {selection.type === "free" ? (
          <View className="items-center gap-3">
            <Text className="text-2xl font-extrabold text-river-900">Free paddle</Text>
            <View className="flex-row items-center gap-1 rounded-full bg-river-100 p-1">
              {(["river", "waypoint"] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => onFreeTripTypeChange(t)}
                  className={`min-h-11 justify-center rounded-full px-4 ${
                    freeTripType === t ? "bg-river-600" : ""
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      freeTripType === t ? "text-white" : "text-river-700"
                    }`}
                  >
                    {t === "river" ? "River" : "Flat water"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : loadingRoute ? (
          <ActivityIndicator color="#1f7796" />
        ) : routeErrored ? (
          <Text className="text-center text-sm text-red-600">
            Couldn&apos;t load that route.
          </Text>
        ) : route ? (
          <View className="items-center gap-1">
            <Text className="text-center text-2xl font-extrabold text-river-900">
              {route.name}
            </Text>
            <Text className="text-sm text-river-600">
              {formatDistanceMi(
                route.distanceM * (route.shape === "out_and_back" ? 2 : 1),
              )}
              {route.shape === "out_and_back" ? " round trip" : ""} ·{" "}
              {route.type === "river" ? "River" : "Flat water"}
            </Text>
          </View>
        ) : null}
        <Text className="max-w-xs text-center text-xs text-river-400">
          Recording keeps going with the screen off or the app in the
          background. We&apos;ll ask for location access when you tap Start.
        </Text>
      </View>

      <View>
        <Text className="mb-1 text-xs font-bold uppercase tracking-widest text-river-500">
          Trip notes (optional)
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={2}
          maxLength={2000}
          placeholder="Conditions, who came along, anything to remember…"
          placeholderTextColor="#88cde2"
          className="min-h-20 rounded-2xl border border-river-200 bg-white px-3 py-2 text-sm text-river-900"
        />
      </View>

      {permError ? (
        <Text className="text-center text-sm text-red-600">{permError}</Text>
      ) : null}

      <Pressable
        onPress={() => void handleStart()}
        disabled={starting || loadingRoute || routeErrored}
        className="min-h-16 items-center justify-center rounded-3xl bg-sunset-500 disabled:opacity-60"
      >
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-xl font-extrabold text-white">START</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function RoutePickerList({
  routes,
  loading,
  error,
  onSelectRoute,
  onSelectFree,
}: {
  routes: RouterOutputs["routes"]["list"] | undefined;
  loading: boolean;
  error: string | null;
  onSelectRoute: (id: string) => void;
  onSelectFree: () => void;
}) {
  return (
    <View className="flex-1 bg-river-50">
      <FlatList
        data={routes ?? []}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 p-4"
        ListHeaderComponent={
          <View className="mb-1 gap-3">
            <Text className="text-2xl font-extrabold tracking-tight text-river-900">
              Record a paddle
            </Text>
            <Pressable
              onPress={onSelectFree}
              className="flex-row items-center gap-3 rounded-2xl bg-white p-4 shadow-sm"
            >
              <Text className="text-3xl">🧭</Text>
              <View className="flex-1">
                <Text className="font-semibold text-river-900">Free paddle</Text>
                <Text className="text-sm text-river-500">
                  No route — just track your trip
                </Text>
              </View>
            </Pressable>
            {loading ? (
              <ActivityIndicator color="#1f7796" />
            ) : error ? (
              <Text className="text-sm text-red-600">
                Couldn&apos;t load routes. {error}
              </Text>
            ) : routes && routes.length > 0 ? (
              <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
                Or follow a route
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelectRoute(item.id)}
            className="flex-row items-center gap-3 rounded-2xl bg-white p-4 shadow-sm"
          >
            <Text className="text-3xl">{item.type === "waypoint" ? "🌊" : "🏞️"}</Text>
            <View className="flex-1">
              <Text className="font-semibold text-river-900">{item.name}</Text>
              <Text className="text-sm text-river-500">
                {formatDistanceMi(
                  item.distanceM * (item.shape === "out_and_back" ? 2 : 1),
                )}
                {item.shape === "out_and_back" ? " round trip" : " one-way"} ·{" "}
                {item.creatorName}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <Text className="mt-2 text-center text-sm text-river-400">
              No saved routes yet — free paddle away.
            </Text>
          ) : null
        }
      />
    </View>
  );
}

// --- live phase ---------------------------------------------------------------

function LiveScreen() {
  const machine = useRecorder((s) => s.machine);
  const progress = useRecorder((s) => s.progress);
  const eta = useRecorder((s) => s.eta);
  const routeModel = useRecorder((s) => s.routeModel);
  const routeId = useRecorder((s) => s.routeId);
  const gpsAccuracyM = useRecorder((s) => s.gpsAccuracyM);
  const geoError = useRecorder((s) => s.geoError);
  const lowAccuracyHint = useRecorder((s) => s.lowAccuracyHint);
  const wakeLockOk = useRecorder((s) => s.wakeLockOk);
  const note = useRecorder((s) => s.note);
  const setNote = useRecorder((s) => s.setNote);
  const pause = useRecorder((s) => s.pause);
  const resume = useRecorder((s) => s.resume);
  const finish = useRecorder((s) => s.finish);

  // Re-fetches the route this paddle is tied to purely for its corridor POIs (for the next-POI-ahead
  // banner) -- the recorder store only keeps the progress-matching geometry, not POI metadata. Same
  // query key as SetupScreen's byId call, so this is a cache hit in practice, not an extra round trip.
  const routeQuery = api.routes.byId.useQuery(
    { id: routeId ?? "" },
    { enabled: !!routeId },
  );

  const status = machine.status;
  const isAcquiring = status === "acquiring";
  const isAutoPaused = status === "autoPaused";
  const isPaused = status === "manualPaused";

  const nextPoi = useMemo(() => {
    if (!routeModel || !progress || progress.offRoute || !routeQuery.data) return null;
    const pois: CorridorPoi[] = routeQuery.data.pois.map((p) => ({
      id: p.id,
      category: p.category,
      note: p.note,
      routeDistM: p.routeDistM,
      lng: p.geom.coordinates[0]!,
      lat: p.geom.coordinates[1]!,
    }));
    return nextPoiAhead(pois, routeQuery.data.shape, routeModel.totalM, progress.progressM);
  }, [routeModel, progress, routeQuery.data]);

  const avgMph = machine.movingS > 0 ? machine.distanceM / machine.movingS : 0;
  const progressPct =
    routeModel && progress
      ? Math.min(100, Math.max(0, (progress.progressM / routeModel.totalM) * 100))
      : null;
  const etaClock =
    routeModel && progress && eta && Number.isFinite(eta.etaSeconds)
      ? formatTimeOfDay(new Date(Date.now() + eta.etaSeconds * 1000))
      : null;

  function handleFinish() {
    Alert.alert(
      "Finish paddle?",
      "This stops recording so you can review and save your trip.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Finish", style: "destructive", onPress: () => finish() },
      ],
    );
  }

  return (
    <View className="flex-1 bg-river-50">
      <ScrollView
        contentContainerClassName="gap-4 p-4 pb-2"
        keyboardShouldPersistTaps="handled"
      >
        {nextPoi ? (
          <View className="flex-row items-center gap-2 rounded-2xl bg-sunset-100 px-4 py-3">
            <Text className="text-lg">{poiMeta(nextPoi.poi.category).emoji}</Text>
            <Text className="flex-1 font-semibold text-sunset-700" numberOfLines={1}>
              {nextPoi.poi.note
                ? truncateNote(nextPoi.poi.note)
                : poiMeta(nextPoi.poi.category).label}{" "}
              in {formatDistanceMi(nextPoi.distanceAheadM)}
            </Text>
          </View>
        ) : null}

        <View className="flex-row flex-wrap gap-2">
          <Chip
            label={`GPS ${gpsAccuracyM != null ? `±${Math.round(gpsAccuracyM)}m` : "…"}`}
            tone="neutral"
          />
          {isAcquiring ? <Chip label="Acquiring GPS…" tone="warning" /> : null}
          {isAutoPaused ? <Chip label="Auto-paused" tone="warning" /> : null}
          {isPaused ? <Chip label="Paused" tone="neutral" /> : null}
          {progress?.offRoute ? <Chip label="Off route" tone="danger" /> : null}
          {!wakeLockOk ? <Chip label="Screen may sleep" tone="danger" /> : null}
        </View>

        <View className="rounded-3xl bg-white p-5 shadow-sm">
          <View className="flex-row flex-wrap gap-x-4 gap-y-4">
            <Stat label="Distance" value={formatDistanceMi(machine.distanceM)} big />
            {progress ? (
              <Stat label="Remaining" value={formatDistanceMi(progress.remainingM)} big />
            ) : null}
            <Stat label="Elapsed" value={formatClock(machine.elapsedS)} />
            <Stat label="Moving" value={formatClock(machine.movingS)} />
            <Stat label="Avg speed" value={formatSpeedMph(avgMph)} />
            {progressPct != null ? (
              <Stat label="Progress" value={`${Math.round(progressPct)}%`} />
            ) : null}
            {etaClock ? <Stat label="ETA" value={etaClock} /> : null}
          </View>
        </View>

        {geoError ? (
          <Text className="rounded-2xl bg-red-50 px-4 py-3 text-center text-xs text-red-700">
            {geoError}
          </Text>
        ) : lowAccuracyHint ? (
          <Text className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-800">
            GPS signal is weak (accuracy over 100m for 30+ seconds). On iPhone, try
            Settings → Privacy &amp; Security → Location Services → Precise Location: On.
          </Text>
        ) : null}

        <View>
          <Text className="mb-1 text-xs font-bold uppercase tracking-widest text-river-500">
            Notes
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            maxLength={2000}
            placeholder="Conditions, wildlife, who came along…"
            placeholderTextColor="#88cde2"
            className="min-h-16 rounded-2xl border border-river-200 bg-white px-3 py-2 text-sm text-river-900"
          />
        </View>
      </ScrollView>

      <View className="flex-row gap-3 px-4 pb-6 pt-2">
        {isPaused ? (
          <Pressable
            onPress={resume}
            className="min-h-14 flex-1 items-center justify-center rounded-2xl bg-river-600"
          >
            <Text className="text-lg font-bold text-white">Resume</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={pause}
            disabled={isAcquiring}
            className="min-h-14 flex-1 items-center justify-center rounded-2xl bg-river-100 disabled:opacity-40"
          >
            <Text className="text-lg font-bold text-river-700">Pause</Text>
          </Pressable>
        )}
        <Pressable
          onPress={handleFinish}
          className="min-h-14 flex-1 items-center justify-center rounded-2xl bg-sunset-500"
        >
          <Text className="text-lg font-extrabold text-white">Finish</Text>
        </Pressable>
      </View>
    </View>
  );
}

// --- finished phase: summary + save/discard ----------------------------------

function FinishedScreen({ freeTripType }: { freeTripType: TripType }) {
  const router = useRouter();
  const machine = useRecorder((s) => s.machine);
  const note = useRecorder((s) => s.note);
  const setNote = useRecorder((s) => s.setNote);
  const routeId = useRecorder((s) => s.routeId);
  const storeTripType = useRecorder((s) => s.tripType);
  const discard = useRecorder((s) => s.discard);
  // A routed paddle's tripType is authoritatively whatever `configure()` set from the route itself;
  // a free paddle's is always hardcoded "river" in the store (see SetupScreen), so the user's actual
  // toggle choice -- kept in RecordScreen's `freeTripType` -- is what actually goes on the record.
  const tripType = routeId != null ? storeTripType : freeTripType;

  const createPaddle = api.paddles.create.useMutation();
  const utils = api.useUtils();
  const paddleId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const avgMph = machine.movingS > 0 ? machine.distanceM / machine.movingS : 0;

  async function handleSave() {
    setError(null);
    paddleId.current ??= getRandomUUID();

    // Full fidelity into trackJson; ~10 m Douglas-Peucker into the stored geometry -- exactly
    // mirrors buildInput() in apps/web/src/components/record/record-client.tsx.
    const simplified = simplifyTrack(machine.track, 10);
    const coords = simplified.map((p) => [p.lng, p.lat] as [number, number]);
    const movingS = Math.round(machine.movingS);
    const distanceM = machine.distanceM;
    const trimmedNote = note.trim();

    const input = {
      id: paddleId.current,
      routeId,
      tripType,
      startedAt: new Date(machine.startedAt ?? Date.now()),
      elapsedS: Math.round(machine.elapsedS),
      movingS,
      distanceM,
      avgSpeedMps: movingS > 0 ? distanceM / movingS : 0,
      trackGeom:
        coords.length >= 2
          ? ({ type: "LineString" as const, coordinates: coords })
          : null,
      trackJson: machine.track.length > 0 ? machine.track : null,
      note: trimmedNote.length > 0 ? trimmedNote : null,
    };

    try {
      await createPaddle.mutateAsync(input);
      // The paddle is safely saved server-side; now it's safe to clear the checkpoint and reset the
      // recorder back to idle. discard() already clears the checkpoint and tears down, so it's the
      // right post-save reset -- no dedicated store method needed.
      discard();
      await utils.paddles.feed.invalidate();
      router.replace("/");
    } catch (err) {
      // Keep the checkpoint (still holds the finished machine state) so a failed save can be retried
      // without losing the trip.
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't save. Your paddle is still on this device — try again.",
      );
    }
  }

  function handleDiscard() {
    Alert.alert("Discard this paddle?", "This trip will not be saved.", [
      { text: "Cancel", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => discard() },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-river-50" contentContainerClassName="gap-5 p-6">
      <Text className="text-2xl font-extrabold text-river-900">Paddle finished 🎉</Text>

      <View className="flex-row flex-wrap gap-4 rounded-3xl bg-white p-5 shadow-sm">
        <Stat label="Distance" value={formatDistanceMi(machine.distanceM)} big />
        <Stat label="Elapsed" value={formatClock(machine.elapsedS)} big />
        <Stat label="Moving" value={formatClock(machine.movingS)} />
        <Stat label="Avg speed" value={formatSpeedMph(avgMph)} />
      </View>

      <View>
        <Text className="mb-1 text-xs font-bold uppercase tracking-widest text-river-500">
          Notes
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={3}
          maxLength={2000}
          placeholder="Conditions, who came along, anything to remember…"
          placeholderTextColor="#88cde2"
          className="min-h-16 rounded-2xl border border-river-200 bg-white px-3 py-2 text-sm text-river-900"
        />
      </View>

      {error ? (
        <Text className="text-center text-sm text-red-600">{error}</Text>
      ) : null}

      <Pressable
        onPress={() => void handleSave()}
        disabled={createPaddle.isPending}
        className="min-h-14 items-center justify-center rounded-2xl bg-sunset-500 disabled:opacity-60"
      >
        {createPaddle.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-lg font-bold text-white">Save paddle</Text>
        )}
      </Pressable>
      <Pressable
        onPress={handleDiscard}
        disabled={createPaddle.isPending}
        className="min-h-12 items-center justify-center rounded-2xl border border-river-300"
      >
        <Text className="font-semibold text-river-700">Discard</Text>
      </Pressable>
    </ScrollView>
  );
}

// --- small shared bits --------------------------------------------------------

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View className="min-w-[45%] flex-1">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-400">
        {label}
      </Text>
      <Text
        className={`font-extrabold tabular-nums text-river-900 ${
          big ? "text-4xl" : "text-2xl"
        }`}
      >
        {value}
      </Text>
    </View>
  );
}

function Chip({ label, tone }: { label: string; tone: "neutral" | "warning" | "danger" }) {
  const bg =
    tone === "warning" ? "bg-sunset-100" : tone === "danger" ? "bg-red-100" : "bg-river-100";
  const text =
    tone === "warning"
      ? "text-sunset-700"
      : tone === "danger"
        ? "text-red-700"
        : "text-river-700";
  return (
    <View className={`rounded-full px-2.5 py-1 ${bg}`}>
      <Text className={`text-xs font-bold ${text}`}>{label}</Text>
    </View>
  );
}
