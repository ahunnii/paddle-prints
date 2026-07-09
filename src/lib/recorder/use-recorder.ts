"use client";

/**
 * The impure shell around the pure recorder core: a zustand store that wires the reducer to the
 * browser. It owns `watchPosition`, the 1 Hz tick, the screen wake lock, checkpoint persistence, and
 * restore-on-mount. Everything correctness-critical still lives in machine.ts / progress.ts / eta.ts;
 * this file is just plumbing and is intentionally excluded from the unit tests.
 */
import { create } from "zustand";

import {
  checkpointStore,
  isLiveCheckpoint,
  type Checkpoint,
} from "./checkpoint";
import { DEFAULT_HISTORICAL_SPEED_MPS, METERS_PER_MILE } from "./constants";
import { computeEta, type EtaResult } from "./eta";
import { initialState, reducer } from "./machine";
import {
  buildProgressModel,
  createMatchState,
  matchProgress,
  pointAtDistance,
  type MatchState,
  type ProgressModel,
  type ProgressResult,
} from "./progress";
import type { RecorderEvent, RecorderState, TripType } from "./types";

/** Side-effecting handles that must NOT live in reactive state. */
interface Runtime {
  watchId: number | null;
  tick: ReturnType<typeof setInterval> | null;
  ckpt: ReturnType<typeof setInterval> | null;
  wakeLock: WakeLockSentinel | null;
  visibilityBound: boolean;
  /** Timestamp of the start of the current unbroken streak of coarse (>100m) fixes, or null if the
   * most recent fix was accurate. Detects a persistent-coarse-GPS drought (iOS "Precise Location"
   * toggled off) independent of the machine's own accept/reject gates -- this needs to see EVERY fix,
   * including ones the reducer drops. */
  coarseStreakStartedAt: number | null;
}
const runtime: Runtime = {
  watchId: null,
  tick: null,
  ckpt: null,
  wakeLock: null,
  visibilityBound: false,
  coarseStreakStartedAt: null,
};

/** Window over which we judge "persistently coarse" accuracy. */
const ACCURACY_HINT_WINDOW_MS = 30_000;
/** Above this, a fix is "coarse" (roughly what iOS reports with Precise Location off). */
const ACCURACY_HINT_THRESHOLD_M = 100;

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

  wakeLockOk: boolean;
  gpsAccuracyM: number | null;
  geoError: string | null;
  /** `GeolocationPositionError.code` for the current `geoError`, or null. 1 = PERMISSION_DENIED. */
  geoErrorCode: number | null;
  /** True once every fix for the last ~30s has been coarser than 100m -- likely Precise Location is
   * off, worth hinting at, distinct from an outright permission denial. */
  lowAccuracyHint: boolean;

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

  function saveCheckpoint() {
    const s = get();
    if (s.machine.status === "idle" || s.machine.status === "finished") return;
    checkpointStore.save({
      version: 1,
      routeId: s.routeId,
      tripType: s.tripType,
      machine: s.machine,
      progress: s.match,
      savedAt: Date.now(),
    });
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        runtime.wakeLock = await navigator.wakeLock.request("screen");
        runtime.wakeLock.addEventListener("release", () => {
          runtime.wakeLock = null;
        });
        set({ wakeLockOk: true });
      } else {
        set({ wakeLockOk: false });
      }
    } catch {
      set({ wakeLockOk: false });
    }
  }

  function onVisibility() {
    const status = get().machine.status;
    if (document.visibilityState === "visible") {
      if (
        (status === "recording" || status === "autoPaused") &&
        runtime.wakeLock == null
      ) {
        void requestWakeLock();
      }
      saveCheckpoint();
    } else {
      // Backgrounded: persist immediately in case the OS suspends us.
      saveCheckpoint();
    }
  }

  /** Start the browser side effects (GPS watch, tick, checkpoints, wake lock, visibility). */
  function arm() {
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      runtime.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const t = pos.timestamp || Date.now();
          const acc = pos.coords.accuracy;

          // Track every fix's accuracy (even ones the reducer will reject), independent of the
          // machine's own accept/reject gates. Any accurate fix resets the streak immediately.
          if (acc > ACCURACY_HINT_THRESHOLD_M) {
            runtime.coarseStreakStartedAt ??= t;
          } else {
            runtime.coarseStreakStartedAt = null;
          }
          const lowAccuracyHint =
            runtime.coarseStreakStartedAt != null &&
            t - runtime.coarseStreakStartedAt >= ACCURACY_HINT_WINDOW_MS;

          set({ geoError: null, geoErrorCode: null, lowAccuracyHint });
          dispatch({
            type: "FIX",
            point: {
              lng: pos.coords.longitude,
              lat: pos.coords.latitude,
              t,
              acc,
            },
          });
        },
        (err) => set({ geoError: err.message, geoErrorCode: err.code, lowAccuracyHint: false }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    } else {
      set({ geoError: "Location isn't available on this device.", geoErrorCode: null });
    }

    runtime.tick = setInterval(
      () => dispatch({ type: "TICK", now: Date.now() }),
      1000,
    );
    runtime.ckpt = setInterval(saveCheckpoint, 15_000);
    if (!runtime.visibilityBound) {
      document.addEventListener("visibilitychange", onVisibility);
      runtime.visibilityBound = true;
    }
    void requestWakeLock();
  }

  function teardown() {
    if (runtime.watchId != null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(runtime.watchId);
    }
    runtime.watchId = null;
    if (runtime.tick) clearInterval(runtime.tick);
    runtime.tick = null;
    if (runtime.ckpt) clearInterval(runtime.ckpt);
    runtime.ckpt = null;
    if (runtime.visibilityBound) {
      document.removeEventListener("visibilitychange", onVisibility);
      runtime.visibilityBound = false;
    }
    void runtime.wakeLock?.release().catch(() => undefined);
    runtime.wakeLock = null;
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
      if (runtime.wakeLock == null) void requestWakeLock();
    },

    finish() {
      dispatch({ type: "FINISH", now: Date.now() });
      // Persist a final checkpoint so a failed save can be retried after a reload, then stop the
      // hardware. The client clears the checkpoint only once the paddle is saved.
      saveCheckpoint();
      teardown();
    },

    async restoreFrom(cp) {
      const routeModel = get().routeModel;
      set({
        machine: reducer(initialState(), { type: "RESTORE", state: cp.machine }),
        match: cp.progress,
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
    },

    dispose() {
      teardown();
    },
  };
});

/**
 * Read any live checkpoint saved for a paddle. Async because the durable copy lives in IndexedDB
 * (Dexie): after a reload the in-memory shadow is empty until `hydrate()` pulls it back.
 */
export async function readLiveCheckpoint(): Promise<Checkpoint | null> {
  const cp = await checkpointStore.hydrate();
  return isLiveCheckpoint(cp) ? cp : null;
}

export function clearCheckpoint() {
  checkpointStore.clear();
}

export { METERS_PER_MILE };
