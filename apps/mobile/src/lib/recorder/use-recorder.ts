/**
 * The impure shell around the pure recorder core: a zustand store that wires the reducer to the
 * native runtime. It owns the background-location task, the 1 Hz tick, the keep-awake lock, checkpoint
 * persistence, presence heartbeats, and restore-on-mount. Everything correctness-critical still lives
 * in machine.ts / progress.ts / eta.ts (reused wholesale from @paddle-prints/recorder-core); this file
 * is just plumbing.
 *
 * Ported from apps/web/src/lib/recorder/use-recorder.ts. The dispatch pipeline, timers, presence
 * gating, checkpoint cadence, and restore math are kept identical; the platform-specific differences
 * (background-location task instead of watchPosition, keep-awake instead of the screen wake lock,
 * AppState instead of visibilitychange, expo-location error shapes) are documented inline.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";
import * as Location from "expo-location";
import type { LocationObject } from "expo-location";
import { create } from "zustand";

import { useSettings } from "../settings/use-settings";
import { trpcVanilla } from "../trpc-vanilla";

import {
  checkpointStore,
  isLiveCheckpoint,
  type Checkpoint,
} from "./checkpoint";
import {
  RECORDER_TASK,
  registerRecorderHandlers,
} from "./location-task";
import {
  DEFAULT_HISTORICAL_SPEED_MPS,
  METERS_PER_MILE,
} from "@paddle-prints/recorder-core/constants";
import { computeEta, type EtaResult } from "@paddle-prints/recorder-core/eta";
import { initialState, reducer } from "@paddle-prints/recorder-core/machine";
import {
  buildProgressModel,
  createMatchState,
  matchProgress,
  pointAtDistance,
  type MatchState,
  type ProgressModel,
  type ProgressResult,
} from "@paddle-prints/recorder-core/progress";
import type {
  RecorderEvent,
  RecorderState,
  TripType,
} from "@paddle-prints/recorder-core/types";

/** The keep-awake tag; matched exactly by the deactivate call so we release only our own lock. */
const KEEP_AWAKE_TAG = "recorder";

/**
 * Options for the background location task. Every field is present in the installed
 * expo-location's `LocationTaskOptions` (verified against node_modules types):
 *  - `BestForNavigation` accuracy + `OtherNavigation` activity type: this is a paddling tracker.
 *  - `timeInterval` 1000 / `distanceInterval` 0: aim for ~1 Hz and let the reducer do all distance
 *    gating (no shell-side filtering, matching the web recorder).
 *  - `showsBackgroundLocationIndicator` (iOS) + `foregroundService` (Android) keep tracking alive and
 *    visible while backgrounded; `killServiceOnDestroy: false` keeps recording through an app swipe.
 *  - `pausesUpdatesAutomatically: false` so iOS never silently stops updates on us mid-paddle.
 */
const LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  activityType: Location.ActivityType.OtherNavigation,
  timeInterval: 1000,
  distanceInterval: 0,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: "Paddle Prints is recording",
    notificationBody: "Tracking your paddle",
    killServiceOnDestroy: false,
  },
};

/** Side-effecting handles that must NOT live in reactive state. */
interface Runtime {
  tick: ReturnType<typeof setInterval> | null;
  ckpt: ReturnType<typeof setInterval> | null;
  /** Recurring presence heartbeat, started in `arm()`. */
  presence: ReturnType<typeof setInterval> | null;
  /** One-shot early heartbeat kick so friends see you shortly after start. */
  presenceKick: ReturnType<typeof setTimeout> | null;
  /** AppState subscription (native replacement for the web `visibilitychange` listener). */
  appState: NativeEventSubscription | null;
  /** True once the background location task has been started, so teardown only stops what it started. */
  locationStarted: boolean;
  /** Timestamp of the start of the current unbroken streak of coarse (>100m) fixes, or null if the
   * most recent fix was accurate. Detects a persistent-coarse-GPS drought (iOS "Precise Location"
   * toggled off) independent of the machine's own accept/reject gates -- this needs to see EVERY fix,
   * including ones the reducer drops. */
  coarseStreakStartedAt: number | null;
}
const runtime: Runtime = {
  tick: null,
  ckpt: null,
  presence: null,
  presenceKick: null,
  appState: null,
  locationStarted: false,
  coarseStreakStartedAt: null,
};

/** How often to heartbeat the current position to the presence table while recording. */
const PRESENCE_INTERVAL_MS = 75_000;
/** One-shot delay before the first heartbeat, so friends see you shortly after start. */
const PRESENCE_KICK_MS = 5_000;

/** Window over which we judge "persistently coarse" accuracy. */
const ACCURACY_HINT_WINDOW_MS = 30_000;
/** Above this, a fix is "coarse" (roughly what iOS reports with Precise Location off). */
const ACCURACY_HINT_THRESHOLD_M = 100;

/** Sentinel accuracy for a fix that reports `null` accuracy (only on web; native always fills it). A
 * null reading is treated as clearly coarse: the reducer's accuracy gate rejects it and it counts
 * toward the low-accuracy hint. */
const UNKNOWN_ACCURACY_M = 9999;

export interface RecorderConfig {
  routeId: string | null;
  tripType: TripType;
  /** Route coordinates ([lng,lat]) if this paddle is tied to a route, else null (free paddle). */
  routeCoords: Array<[number, number]> | null;
  routeShape: "one_way" | "out_and_back";
  historicalSpeedMps?: number;
}

interface RecorderStore {
  configured: boolean;
  routeId: string | null;
  tripType: TripType;
  routeModel: ProgressModel | null;
  historicalSpeedMps: number;

  machine: RecorderState;
  match: MatchState | null;
  progress: ProgressResult | null;
  eta: EtaResult | null;

  /** True while the keep-awake lock is held. Native keep-awake essentially always succeeds; kept for
   * API parity with the web store's `wakeLockOk` so screens can render the same states. */
  wakeLockOk: boolean;
  gpsAccuracyM: number | null;
  geoError: string | null;
  /** expo-location/TaskManager error `code` for the current `geoError` (string or number), or null.
   * Web used the numeric `GeolocationPositionError.code`; RN error codes are opaque strings/numbers,
   * so this is widened. Permission state is surfaced separately via `permissions.ts`, not here. */
  geoErrorCode: string | number | null;
  /** True once every fix for the last ~30s has been coarser than 100m -- likely Precise Location is
   * off, worth hinting at, distinct from an outright permission denial. */
  lowAccuracyHint: boolean;

  /** Free-text trip note, editable before START and while recording. Lives in the store so it
   * survives the pre-start -> nav transition and is captured into the checkpoint. */
  note: string;
  setNote: (note: string) => void;
  /** Last finite compass heading (degrees) from the GPS stream; null until one arrives. iOS reports
   * null/NaN when stationary and -1 for an invalid heading, so we keep the last good value. */
  headingDeg: number | null;

  configure: (cfg: RecorderConfig) => void;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  finish: () => void;
  restoreFrom: (cp: Checkpoint) => Promise<void>;
  discard: () => void;
  dispose: () => void;
}

export const useRecorder = create<RecorderStore>((set, get) => {
  /** Apply one event, then recompute progress (on newly-accepted points) and ETA. */
  function dispatch(event: RecorderEvent) {
    set((state) => {
      const machine = reducer(state.machine, event);

      let match = state.match;
      let progress = state.progress;
      const grew = machine.track.length > state.machine.track.length;
      if (state.routeModel && grew) {
        const p = machine.track[machine.track.length - 1]!;
        const r = matchProgress(state.routeModel, match ?? createMatchState(), p);
        match = r.next;
        progress = r.result;
      }

      let eta = state.eta;
      if (state.routeModel && progress) {
        eta = computeEta({
          remainingM: progress.remainingM,
          movingS: machine.movingS,
          sessionDistanceM: machine.distanceM,
          historicalSpeedMps: state.historicalSpeedMps,
        });
      }

      const last = machine.track[machine.track.length - 1];
      return {
        machine,
        match,
        progress,
        eta,
        gpsAccuracyM: last ? last.acc : state.gpsAccuracyM,
      };
    });
  }

  /** Handle one raw location from the background task: track coarse-accuracy streak + heading (both
   * independent of the reducer), then feed it in as a FIX with no shell-side filtering. */
  function onFix(loc: LocationObject) {
    const t = loc.timestamp || Date.now();
    const acc = loc.coords.accuracy ?? UNKNOWN_ACCURACY_M;

    // Track every fix's accuracy (even ones the reducer will reject), independent of the machine's own
    // accept/reject gates. Any accurate fix resets the streak immediately.
    if (acc > ACCURACY_HINT_THRESHOLD_M) {
      runtime.coarseStreakStartedAt ??= t;
    } else {
      runtime.coarseStreakStartedAt = null;
    }
    const lowAccuracyHint =
      runtime.coarseStreakStartedAt != null &&
      t - runtime.coarseStreakStartedAt >= ACCURACY_HINT_WINDOW_MS;

    set({ geoError: null, geoErrorCode: null, lowAccuracyHint });

    // Heading is often null/NaN when stationary and -1 when invalid on iOS; keep the last finite,
    // non-negative value so the board marker doesn't snap back to north between good fixes.
    const h = loc.coords.heading;
    if (h != null && Number.isFinite(h) && h >= 0) set({ headingDeg: h });

    dispatch({
      type: "FIX",
      point: {
        lng: loc.coords.longitude,
        lat: loc.coords.latitude,
        t,
        acc,
      },
    });
  }

  function onLocationError(error: { code: string | number; message: string }) {
    set({ geoError: error.message, geoErrorCode: error.code, lowAccuracyHint: false });
  }

  function saveCheckpoint() {
    const s = get();
    if (s.machine.status === "idle" || s.machine.status === "finished") return;
    checkpointStore.save({
      version: 1,
      routeId: s.routeId,
      tripType: s.tripType,
      machine: s.machine,
      progress: s.match,
      note: s.note,
      savedAt: Date.now(),
    });
  }

  /** Best-effort heartbeat of the current position, gated so it never disturbs a recording. */
  async function sendPresence() {
    // Gate on the user's "share live location" opt-in, read imperatively via getState() (matching the
    // web recorder's `useSettings.getState().sharePresence`). When off, skip the heartbeat entirely --
    // but finish()/discard() still call `presence.clear` regardless, since clearing your dot is
    // privacy-positive; that mirrors the web recorder, which likewise only gates the heartbeat here.
    if (!useSettings.getState().sharePresence) return;
    // (Web additionally skips when `navigator.onLine` is false; RN has no equivalent signal on this
    // path and all errors are swallowed below, so we simply attempt the call.)
    const s = get();
    const last = s.machine.track[s.machine.track.length - 1];
    const live =
      s.machine.status === "recording" ||
      s.machine.status === "autoPaused" ||
      s.machine.status === "manualPaused";
    if (!last || !live) return;

    try {
      await trpcVanilla.presence.heartbeat.mutate({
        point: { lng: last.lng, lat: last.lat },
        tripType: s.tripType,
      });
    } catch {
      // Never disturb the recording over a presence hiccup.
    }
  }

  async function acquireKeepAwake() {
    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      set({ wakeLockOk: true });
    } catch {
      set({ wakeLockOk: false });
    }
  }

  /** Start (or resume) delivery of background location updates. Idempotent-ish: guarded by
   * `runtime.locationStarted` and a native started-check. Errors surface as `geoError`. */
  async function startLocation() {
    try {
      registerRecorderHandlers(onFix, onLocationError);
      const already = await Location.hasStartedLocationUpdatesAsync(RECORDER_TASK);
      if (!already) {
        await Location.startLocationUpdatesAsync(RECORDER_TASK, LOCATION_OPTIONS);
      }
      runtime.locationStarted = true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't start location updates.";
      set({ geoError: message, geoErrorCode: null });
    }
  }

  async function stopLocation() {
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(RECORDER_TASK);
      if (started) await Location.stopLocationUpdatesAsync(RECORDER_TASK);
    } catch {
      /* best-effort */
    } finally {
      runtime.locationStarted = false;
      registerRecorderHandlers(null, null);
    }
  }

  /** Native replacement for the web `onVisibility` handler. On returning to the foreground we
   * re-dispatch a TICK so `elapsedS`/auto-pause accrual catches up any time the JS timers were
   * throttled while backgrounded (the background LOCATION task keeps running regardless), then persist.
   * Keep-awake does not need re-acquisition -- the lock persists across background/foreground -- so,
   * unlike the web wake lock, there is nothing to re-request here. */
  function onAppStateChange(next: AppStateStatus) {
    if (next === "active") {
      dispatch({ type: "TICK", now: Date.now() });
      saveCheckpoint();
    } else {
      // Backgrounded/inactive: persist immediately in case the OS suspends us.
      saveCheckpoint();
    }
  }

  /** Start the native side effects (background GPS, tick, checkpoints, presence, keep-awake, AppState). */
  function arm() {
    void startLocation();

    runtime.tick = setInterval(
      () => dispatch({ type: "TICK", now: Date.now() }),
      1000,
    );
    runtime.ckpt = setInterval(saveCheckpoint, 15_000);
    runtime.presence = setInterval(() => void sendPresence(), PRESENCE_INTERVAL_MS);
    runtime.presenceKick = setTimeout(() => void sendPresence(), PRESENCE_KICK_MS);
    if (!runtime.appState) {
      runtime.appState = AppState.addEventListener("change", onAppStateChange);
    }
    void acquireKeepAwake();
  }

  function teardown() {
    void stopLocation();
    if (runtime.tick) clearInterval(runtime.tick);
    runtime.tick = null;
    if (runtime.ckpt) clearInterval(runtime.ckpt);
    runtime.ckpt = null;
    if (runtime.presence) clearInterval(runtime.presence);
    runtime.presence = null;
    if (runtime.presenceKick) clearTimeout(runtime.presenceKick);
    runtime.presenceKick = null;
    if (runtime.appState) {
      runtime.appState.remove();
      runtime.appState = null;
    }
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    runtime.coarseStreakStartedAt = null;
  }

  return {
    configured: false,
    routeId: null,
    tripType: "river",
    routeModel: null,
    historicalSpeedMps: DEFAULT_HISTORICAL_SPEED_MPS,

    machine: initialState(),
    match: null,
    progress: null,
    eta: null,

    wakeLockOk: false,
    gpsAccuracyM: null,
    geoError: null,
    geoErrorCode: null,
    lowAccuracyHint: false,

    note: "",
    setNote(note) {
      set({ note });
    },
    headingDeg: null,

    configure(cfg) {
      const routeModel =
        cfg.routeCoords && cfg.routeCoords.length >= 2
          ? buildProgressModel(cfg.routeCoords, cfg.routeShape)
          : null;
      set({
        configured: true,
        routeId: cfg.routeId,
        tripType: cfg.tripType,
        routeModel,
        historicalSpeedMps:
          cfg.historicalSpeedMps ?? DEFAULT_HISTORICAL_SPEED_MPS,
        machine: initialState(),
        match: routeModel ? createMatchState() : null,
        progress: null,
        eta: null,
        gpsAccuracyM: null,
        geoError: null,
        geoErrorCode: null,
        lowAccuracyHint: false,
        note: "",
        headingDeg: null,
      });
    },

    async start() {
      if (get().machine.status !== "idle") return;
      dispatch({ type: "START", now: Date.now() });
      arm();
    },

    pause() {
      dispatch({ type: "PAUSE", now: Date.now() });
      saveCheckpoint();
    },

    resume() {
      dispatch({ type: "RESUME", now: Date.now() });
      // Keep-awake persists across a pause, but re-assert defensively in case the tag was released.
      if (!get().wakeLockOk) void acquireKeepAwake();
    },

    finish() {
      dispatch({ type: "FINISH", now: Date.now() });
      // Persist a final checkpoint so a failed save can be retried after a reload, then stop the
      // hardware. The client clears the checkpoint only once the paddle is saved.
      saveCheckpoint();
      teardown();
      // Best-effort: the 5-minute staleness filter is the real cleanup.
      void trpcVanilla.presence.clear.mutate().catch(() => undefined);
    },

    async restoreFrom(cp) {
      const routeModel = get().routeModel;
      set({
        machine: reducer(initialState(), { type: "RESTORE", state: cp.machine }),
        match: cp.progress,
        note: cp.note ?? "",
      });
      // Recompute the display progress/eta from the restored cursor.
      if (routeModel && cp.progress) {
        const progressM = cp.progress.maxProgressM;
        const progress: ProgressResult = {
          progressM,
          remainingM: routeModel.totalM - progressM,
          offRoute: false,
          snapped: pointAtDistance(routeModel, progressM),
          perpM: 0,
        };
        const machine = get().machine;
        set({
          progress,
          eta: computeEta({
            remainingM: progress.remainingM,
            movingS: machine.movingS,
            sessionDistanceM: machine.distanceM,
            historicalSpeedMps: get().historicalSpeedMps,
          }),
        });
      }
      arm();
    },

    discard() {
      teardown();
      checkpointStore.clear();
      const model = get().routeModel;
      set({
        machine: initialState(),
        match: model ? createMatchState() : null,
        progress: null,
        eta: null,
        gpsAccuracyM: null,
      });
      // Best-effort: the 5-minute staleness filter is the real cleanup.
      void trpcVanilla.presence.clear.mutate().catch(() => undefined);
    },

    dispose() {
      teardown();
    },
  };
});

/**
 * Read any live checkpoint saved for a paddle. Synchronous because kv-store reads SQLite directly (no
 * async hydrate step, unlike the web build's Dexie shadow). Returns null when there is no checkpoint
 * or it's stale/finished.
 */
export function readLiveCheckpoint(): Checkpoint | null {
  const cp = checkpointStore.load();
  return isLiveCheckpoint(cp) ? cp : null;
}

export function clearCheckpoint() {
  checkpointStore.clear();
}

export { METERS_PER_MILE };
