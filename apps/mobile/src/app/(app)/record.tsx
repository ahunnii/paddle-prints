/**
 * The Record tab: a stats-first recording UI, with a nav map (../../components/map/nav-map.tsx) on top
 * of the stat tiles during the live phase, built on top of the recorder engine in
 * ../../lib/recorder/use-recorder.ts. Three phases driven entirely by `machine.status`:
 *   - idle, no live checkpoint            -> SetupScreen (route/free-paddle picker + Start)
 *   - idle, a live checkpoint exists       -> ResumePrompt (offered before any route picking)
 *   - acquiring/recording/*Paused          -> LiveScreen (nav map + compact stat tiles + controls)
 *   - finished                            -> FinishedScreen (summary + note + Save/Discard)
 *
 * The nav map is mounted only in LiveScreen -- SetupScreen and FinishedScreen are separate components
 * that never render it, so its native map surface is torn down the instant recording stops or the
 * paddle isn't started yet.
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
import { useLocalSearchParams, useRouter } from "expo-router";

import { nextPoiAhead, type CorridorPoi } from "@paddle-prints/recorder-core/next-poi";
import { simplifyTrack } from "@paddle-prints/recorder-core/simplify";
import type { TripType } from "@paddle-prints/recorder-core/types";

import { NavMap, type NavPoi } from "../../components/map/nav-map";
import { CrewPicker } from "../../components/record/crew-picker";
import {
  formatClock,
  formatDistanceMi,
  formatRouteDistance,
  formatSpeedMph,
  formatTimeOfDay,
} from "../../lib/format";
import { NAV_POI_CATEGORIES, poiMeta, truncateNote } from "../../lib/pois";
import type { Checkpoint } from "../../lib/recorder/checkpoint";
import { ensureRecorderPermissions } from "../../lib/recorder/permissions";
import { readLiveCheckpoint, useRecorder } from "../../lib/recorder/use-recorder";
import { trpcVanilla } from "../../lib/trpc-vanilla";
import { api, type RouterOutputs } from "../../lib/trpc";
import { queuePaddle, syncQueue } from "../../lib/offline/sync";
import {
  getRouteSnapshot,
  type RouteSnapshot,
} from "../../lib/offline/trips";
import { useOfflineTripPath } from "../../lib/offline/use-offline-trip-path";
import { getRandomUUID } from "../../lib/uuid";

/** The `routes.byId` output — the shape both the network path and the offline snapshot resolve to. */
type RecordingRoute = RouterOutputs["routes"]["byId"];

/**
 * Resolve the route a paddle is being recorded against, from the network when reachable and from the
 * downloaded snapshot (see lib/offline/trips) when it isn't. Wraps the same two queries the record
 * screen has always used (`routes.byId` for geometry/POIs, `routes.etaForUser` for pace) so that when
 * the network works the behavior is byte-identical — the snapshot is only ever read after BOTH
 * queries have errored, and never touched on the success path. Returns a unified view the callers
 * configure the recorder / render the nav map from without caring which source it came from.
 */
function useRouteForRecording(routeId: string | null | undefined): {
  route: RecordingRoute | null;
  etaSpeedMps: number | null;
  source: "network" | "snapshot";
  isPending: boolean;
  isError: boolean;
} {
  const enabled = !!routeId;
  const byIdQuery = api.routes.byId.useQuery(
    { id: routeId ?? "" },
    { enabled },
  );
  const etaQuery = api.routes.etaForUser.useQuery(
    { routeId: routeId ?? "" },
    { enabled },
  );

  const networkOk = byIdQuery.isSuccess && etaQuery.isSuccess;
  const networkFailed = byIdQuery.isError || etaQuery.isError;

  // The snapshot read, keyed by routeId so a stale result from a previously-selected route can never
  // leak through when the selection changes (the key mismatch invalidates it until the effect re-runs).
  const [snapState, setSnapState] = useState<{
    routeId: string;
    snapshot: RouteSnapshot | null;
  } | null>(null);

  useEffect(() => {
    if (!routeId || !networkFailed) return;
    if (snapState?.routeId === routeId) return; // already resolved for this route
    let cancelled = false;
    void getRouteSnapshot(routeId).then((snapshot) => {
      if (!cancelled) setSnapState({ routeId, snapshot });
    });
    return () => {
      cancelled = true;
    };
  }, [routeId, networkFailed, snapState]);

  if (!enabled) {
    return {
      route: null,
      etaSpeedMps: null,
      source: "network",
      isPending: false,
      isError: false,
    };
  }
  if (networkOk) {
    return {
      route: byIdQuery.data,
      etaSpeedMps: etaQuery.data.speedMps,
      source: "network",
      isPending: false,
      isError: false,
    };
  }
  if (networkFailed) {
    const tried = snapState?.routeId === routeId;
    if (!tried) {
      // network has failed but the snapshot read is still in flight
      return {
        route: null,
        etaSpeedMps: null,
        source: "network",
        isPending: true,
        isError: false,
      };
    }
    if (snapState.snapshot) {
      return {
        route: snapState.snapshot.route,
        etaSpeedMps: snapState.snapshot.eta.speedMps,
        source: "snapshot",
        isPending: false,
        isError: false,
      };
    }
    // both the network AND the snapshot failed — surface the normal error state
    return {
      route: null,
      etaSpeedMps: null,
      source: "network",
      isPending: false,
      isError: true,
    };
  }
  // both queries still loading
  return {
    route: null,
    etaSpeedMps: null,
    source: "network",
    isPending: true,
    isError: false,
  };
}

/**
 * Resolve a *previously saved paddle* as a retraceable route, for the "Paddle this" deep link from
 * pinned paddles (pinned-section.tsx) and the crew feed. Deliberately mirrors
 * `useRouteForRecording`'s return shape EXACTLY (`route`/`etaSpeedMps`/`source`/`isPending`/`isError`)
 * so SetupScreen can drive its confirm UI and `configure()` call off either hook without a second code
 * path -- the two are read through the same variables below. Differences from a real route:
 *  - `route.id` here is the PADDLE's id, not a `routes` table row -- callers must NOT feed it back
 *    into `configure({ routeId })` (that would try to save the new paddle against a non-existent
 *    route). `routeId: null` is always passed to `configure()` for this path.
 *  - No offline snapshot exists for a single paddle (unlike routes), so `source` is always "network";
 *    a network failure surfaces directly as `isError`.
 *  - `pois`/`paddles` are always empty -- a retraced paddle carries no corridor POIs or history of its
 *    own.
 *  - A track with fewer than 2 points can't be retraced (mirrors the `trackGeometry`/`lineString`
 *    Zod minimum server-side): `route` resolves to `null` with no error, and the caller falls back to
 *    a free paddle.
 */
function usePaddleForRecording(paddleId: string | null | undefined): {
  route: RecordingRoute | null;
  etaSpeedMps: number | null;
  source: "network" | "snapshot";
  isPending: boolean;
  isError: boolean;
} {
  const enabled = !!paddleId;
  const byIdQuery = api.paddles.byId.useQuery(
    { id: paddleId ?? "" },
    { enabled },
  );

  if (!enabled) {
    return {
      route: null,
      etaSpeedMps: null,
      source: "network",
      isPending: false,
      isError: false,
    };
  }
  if (byIdQuery.isPending) {
    return {
      route: null,
      etaSpeedMps: null,
      source: "network",
      isPending: true,
      isError: false,
    };
  }
  if (byIdQuery.isError) {
    return {
      route: null,
      etaSpeedMps: null,
      source: "network",
      isPending: false,
      isError: true,
    };
  }

  const paddle = byIdQuery.data;
  const coords = paddle.trackGeom?.coordinates;
  if (!coords || coords.length < 2) {
    // Not enough GPS data to retrace -- caller treats this as a free paddle.
    return {
      route: null,
      etaSpeedMps: null,
      source: "network",
      isPending: false,
      isError: false,
    };
  }

  const route: RecordingRoute = {
    id: paddle.id,
    name: `Retracing ${paddle.userName}'s paddle`,
    type: paddle.tripType,
    shape: "one_way",
    geom: { type: "LineString", coordinates: coords },
    distanceM: paddle.distanceM,
    description: null,
    difficulty: null,
    createdBy: paddle.userId,
    createdAt: paddle.startedAt,
    creatorName: paddle.userName,
    pois: [],
    paddles: [],
  };

  return {
    route,
    etaSpeedMps: paddle.avgSpeedMps ?? null,
    source: "network",
    isPending: false,
    isError: false,
  };
}

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
      // Crash-recovery is data-safety critical and can happen mid-offline-paddle: if the network is
      // unreachable, fall back to the downloaded route snapshot (lib/offline/trips) and only surface
      // the error when BOTH the fetch and the snapshot are unavailable.
      if (checkpoint.routeId) {
        let route: RecordingRoute;
        try {
          route = await trpcVanilla.routes.byId.query({ id: checkpoint.routeId });
        } catch (netErr) {
          const snapshot = await getRouteSnapshot(checkpoint.routeId);
          if (!snapshot) throw netErr;
          route = snapshot.route;
        }
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

type Selection =
  | { type: "route"; id: string }
  | { type: "paddle"; id: string }
  | { type: "free" };

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

  // The route-detail screen's "Start paddle" button pushes here with `?route=<id>`, and a pinned
  // paddle's "Paddle this" (pinned-section.tsx) pushes with `?paddle=<id>` when the pin has no
  // saved route -- pick either up as an initial selection so the user lands straight in the confirm
  // step instead of the picker list. SetupScreen only ever mounts when the machine is idle and no
  // resume-checkpoint prompt is showing (see RecordScreen above), so no extra status check is needed
  // here; each ref just guards against re-applying the same param value again (e.g. after the user
  // manually backs out to the picker).
  const { route: routeParam, paddle: paddleParam } = useLocalSearchParams<{
    route?: string;
    paddle?: string;
  }>();
  const lastAppliedRouteParam = useRef<string | null>(null);
  const lastAppliedPaddleParam = useRef<string | null>(null);
  useEffect(() => {
    if (!routeParam || lastAppliedRouteParam.current === routeParam) return;
    lastAppliedRouteParam.current = routeParam;
    setSelection({ type: "route", id: routeParam });
  }, [routeParam]);
  useEffect(() => {
    if (!paddleParam || lastAppliedPaddleParam.current === paddleParam) return;
    lastAppliedPaddleParam.current = paddleParam;
    setSelection({ type: "paddle", id: paddleParam });
  }, [paddleParam]);

  const routesQuery = api.routes.list.useQuery(undefined, {
    enabled: selection === null,
  });

  const selectedRouteId = selection?.type === "route" ? selection.id : undefined;
  const selectedPaddleId = selection?.type === "paddle" ? selection.id : undefined;
  // Network-first with a downloaded-snapshot fallback, so a downloaded route can be recorded offline.
  const routeForRecording = useRouteForRecording(selectedRouteId);
  // Retracing a pinned/past paddle -- see usePaddleForRecording's doc comment for how its shape
  // mirrors routeForRecording above.
  const paddleForRecording = usePaddleForRecording(selectedPaddleId);
  const { route: resolvedRoute, etaSpeedMps } = routeForRecording;
  const { route: resolvedPaddleRoute, etaSpeedMps: paddleEtaSpeedMps } = paddleForRecording;

  // A "paddle" selection that resolves with no track to retrace (too few points, see
  // usePaddleForRecording) silently falls back to a free paddle, reusing the "free" branch of both
  // this effect and the config effect below rather than adding a third render path.
  useEffect(() => {
    if (selection?.type !== "paddle") return;
    if (paddleForRecording.isPending || paddleForRecording.isError) return;
    if (!resolvedPaddleRoute) setSelection({ type: "free" });
  }, [selection, paddleForRecording.isPending, paddleForRecording.isError, resolvedPaddleRoute]);

  // Configure the recorder as soon as we know enough: once for a free paddle (the toggle is
  // deliberately NOT a dependency here -- it's read straight from `freeTripType` at save time
  // instead, same as web's buildInput -- so flipping it doesn't reset the store's `note`), once the
  // route + personal ETA have both resolved (from the network, or the snapshot offline), or once a
  // retraceable paddle has resolved.
  useEffect(() => {
    if (!selection) return;
    if (selection.type === "free") {
      configure({ routeId: null, tripType: "river", routeCoords: null, routeShape: "one_way" });
      return;
    }
    if (selection.type === "paddle") {
      // routeId is always null here: this paddle isn't a `routes` table row, so the new paddle
      // must save with no route link (retracing carries no persistent association).
      if (resolvedPaddleRoute) {
        configure({
          routeId: null,
          tripType: resolvedPaddleRoute.type,
          routeCoords: resolvedPaddleRoute.geom.coordinates.map(
            (c) => [c[0], c[1]] as [number, number],
          ),
          routeShape: resolvedPaddleRoute.shape,
          ...(paddleEtaSpeedMps != null
            ? { historicalSpeedMps: paddleEtaSpeedMps }
            : {}),
        });
      }
      return;
    }
    if (resolvedRoute && etaSpeedMps != null) {
      configure({
        routeId: resolvedRoute.id,
        tripType: resolvedRoute.type,
        routeCoords: resolvedRoute.geom.coordinates.map(
          (c) => [c[0], c[1]] as [number, number],
        ),
        routeShape: resolvedRoute.shape,
        historicalSpeedMps: etaSpeedMps,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, resolvedRoute, etaSpeedMps, resolvedPaddleRoute, paddleEtaSpeedMps]);

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
    selection.type === "route" && routeForRecording.isPending;
  const routeErrored = selection.type === "route" && routeForRecording.isError;
  const loadingPaddle =
    selection.type === "paddle" && paddleForRecording.isPending;
  const paddleErrored =
    selection.type === "paddle" && paddleForRecording.isError;
  const route =
    selection.type === "route"
      ? resolvedRoute
      : selection.type === "paddle"
        ? resolvedPaddleRoute
        : null;
  const usingSnapshot =
    selection.type === "route" && routeForRecording.source === "snapshot";

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
            <Text className="text-2xl font-extrabold text-river-900">Quick Start Paddle</Text>
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
        ) : loadingRoute || loadingPaddle ? (
          <ActivityIndicator color="#1f7796" />
        ) : routeErrored ? (
          <Text className="text-center text-sm text-red-600">
            Couldn&apos;t load that route.
          </Text>
        ) : paddleErrored ? (
          <Text className="text-center text-sm text-red-600">
            Couldn&apos;t load that paddle.
          </Text>
        ) : route ? (
          <View className="items-center gap-1">
            <Text className="text-center text-2xl font-extrabold text-river-900">
              {route.name}
            </Text>
            <Text className="text-sm text-river-600">
              {formatRouteDistance(route.distanceM, route.shape)} ·{" "}
              {route.type === "river" ? "River" : "Flat water"}
            </Text>
            {usingSnapshot ? (
              <Text className="mt-1 text-xs font-semibold text-river-500">
                Offline — using downloaded route
              </Text>
            ) : null}
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
        disabled={
          starting || loadingRoute || routeErrored || loadingPaddle || paddleErrored
        }
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
                <Text className="font-semibold text-river-900">Quick Start Paddle</Text>
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
                {formatRouteDistance(item.distanceM, item.shape)} · {item.creatorName}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <Text className="mt-2 text-center text-sm text-river-400">
              No saved routes yet — start a quick paddle instead.
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
  const headingDeg = useRecorder((s) => s.headingDeg);
  const pause = useRecorder((s) => s.pause);
  const resume = useRecorder((s) => s.resume);
  const finish = useRecorder((s) => s.finish);

  // Re-resolves the route this paddle is tied to purely for its corridor POIs (for the next-POI-ahead
  // banner + nav-map markers) and its line -- the recorder store only keeps the progress-matching
  // geometry, not POI metadata. Same queries as SetupScreen, so online this is a cache hit, not an
  // extra round trip; offline it falls back to the downloaded route snapshot so the banner/markers
  // still render on a downloaded route with no signal.
  const routeData = useRouteForRecording(routeId).route;

  const status = machine.status;
  const isAcquiring = status === "acquiring";
  const isAutoPaused = status === "autoPaused";
  const isPaused = status === "manualPaused";

  const nextPoi = useMemo(() => {
    if (!routeModel || !progress || progress.offRoute || !routeData) return null;
    const pois: CorridorPoi[] = routeData.pois.map((p) => ({
      id: p.id,
      category: p.category,
      note: p.note,
      routeDistM: p.routeDistM,
      lng: p.geom.coordinates[0]!,
      lat: p.geom.coordinates[1]!,
    }));
    return nextPoiAhead(pois, routeData.shape, routeModel.totalM, progress.progressM);
  }, [routeModel, progress, routeData]);

  // Nav map inputs: last accepted fix (the live puck), the route line, the on-route snapped-progress
  // dot, and safety-relevant corridor POIs. Kept mounted only in this LiveScreen (unmounted entirely
  // in setup/finished) so the map's native surface isn't paid for outside the live phase.
  const lastPoint = machine.track[machine.track.length - 1];
  const livePos = lastPoint ? { lng: lastPoint.lng, lat: lastPoint.lat } : null;
  const routeCoords = routeData?.geom.coordinates.map(
    (c) => [c[0], c[1]] as [number, number],
  ) ?? null;
  const snappedPos = progress && !progress.offRoute ? progress.snapped : null;
  // If this route's tiles were downloaded for offline use, render the nav map from the local
  // archive (zero network). Resolved once on mount -- a free paddle (no routeId) is always online.
  const offlineTripPath = useOfflineTripPath(routeId);
  const navPois = useMemo<NavPoi[]>(() => {
    if (!routeData) return [];
    return routeData.pois
      .filter((p) => (NAV_POI_CATEGORIES as string[]).includes(p.category))
      .map((p) => ({
        id: p.id,
        category: p.category,
        lng: p.geom.coordinates[0]!,
        lat: p.geom.coordinates[1]!,
      }));
  }, [routeData]);

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
      <View className="h-[45%]">
        <NavMap
          routeCoords={routeCoords}
          livePos={livePos}
          headingDeg={headingDeg}
          snapped={snappedPos}
          pois={navPois}
          offlineTripPath={offlineTripPath}
        />
      </View>

      <ScrollView
        className="flex-1"
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

        <View className="rounded-2xl bg-white p-4 shadow-sm">
          <View className="flex-row flex-wrap gap-x-4 gap-y-3">
            <Stat label="Distance" value={formatDistanceMi(machine.distanceM)} big compact />
            {progress ? (
              <Stat
                label="Remaining"
                value={formatDistanceMi(progress.remainingM)}
                big
                compact
              />
            ) : null}
            <Stat label="Elapsed" value={formatClock(machine.elapsedS)} compact />
            <Stat label="Moving" value={formatClock(machine.movingS)} compact />
            <Stat label="Avg speed" value={formatSpeedMph(avgMph)} compact />
            {progressPct != null ? (
              <Stat label="Progress" value={`${Math.round(progressPct)}%`} compact />
            ) : null}
            {etaClock ? <Stat label="ETA" value={etaClock} compact /> : null}
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

  const utils = api.useUtils();
  const paddleId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [crewUserIds, setCrewUserIds] = useState<string[]>([]);
  const [guestNames, setGuestNames] = useState<string[]>([]);

  const avgMph = machine.movingS > 0 ? machine.distanceM / machine.movingS : 0;

  async function handleSave() {
    setError(null);
    setSaving(true);
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
      // Phase 3 social fields, from the crew picker below. `queuePaddle` writes this same object
      // verbatim to the durable SQLite queue, so these ride along on both the online-first send AND
      // any later offline replay -- there's only the one input object / one save path.
      crewUserIds,
      guestNames,
    };

    try {
      // Queue-first: write the paddle to the durable SQLite queue BEFORE anything else. Once this
      // resolves the trip is safe on the device even with no signal, so leaving the screen can never
      // lose it -- exactly web's record-client.tsx submit() semantics. Only a queue-write failure
      // (nearly impossible -- a local SQLite insert) surfaces the error state now; network errors no
      // longer block the user on this screen.
      await queuePaddle(input);
      // Now that the paddle is durably queued, it's safe to clear the checkpoint and reset the
      // recorder to idle. discard() already clears the checkpoint and tears down.
      discard();
      // Fire a background drain (best-effort; the triggers also cover launch/foreground/reconnect).
      void syncQueue();
      // Reflect the pending paddle immediately, then navigate to the feed.
      await utils.paddles.feed.invalidate();
      router.replace("/");
    } catch (err) {
      // Queueing failed (should be near-impossible) -- keep the checkpoint so the trip isn't lost.
      setSaving(false);
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

      <CrewPicker
        selectedUserIds={crewUserIds}
        onSelectedUserIdsChange={setCrewUserIds}
        guestNames={guestNames}
        onGuestNamesChange={setGuestNames}
      />

      {error ? (
        <Text className="text-center text-sm text-red-600">{error}</Text>
      ) : null}

      <Pressable
        onPress={() => void handleSave()}
        disabled={saving}
        className="min-h-14 items-center justify-center rounded-2xl bg-sunset-500 disabled:opacity-60"
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-lg font-bold text-white">Save paddle</Text>
        )}
      </Pressable>
      <Pressable
        onPress={handleDiscard}
        disabled={saving}
        className="min-h-12 items-center justify-center rounded-2xl border border-river-300"
      >
        <Text className="font-semibold text-river-700">Discard</Text>
      </Pressable>
    </ScrollView>
  );
}

// --- small shared bits --------------------------------------------------------

function Stat({
  label,
  value,
  big,
  compact,
}: {
  label: string;
  value: string;
  big?: boolean;
  /** Smaller type scale -- used in the live phase, where the nav map above eats vertical space. */
  compact?: boolean;
}) {
  return (
    <View className="min-w-[45%] flex-1">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-400">
        {label}
      </Text>
      <Text
        className={`font-extrabold tabular-nums text-river-900 ${
          big ? (compact ? "text-3xl" : "text-4xl") : compact ? "text-xl" : "text-2xl"
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
