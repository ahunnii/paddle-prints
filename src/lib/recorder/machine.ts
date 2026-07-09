/**
 * The recording state machine as a PURE reducer: `(state, event) -> state`, no timers, no IO. All
 * state transitions and stat accumulation live here so the whole thing is unit-testable by replaying
 * synthetic GPS traces (see scripts/test-recorder.mjs).
 *
 * States: idle -> acquiring -> recording <-> autoPaused <-> manualPaused -> finished
 *
 * Time-accounting choices (documented on purpose, they're easy to get wrong):
 *  - `elapsedS` is pure wall-clock from `startedAt`. It keeps counting through manualPaused and
 *    autoPaused -- elapsed is elapsed. START begins the clock, not the first fix, so the paddler
 *    sees the timer move the instant they tap START even while GPS is still acquiring.
 *  - `movingS` accrues ONLY while status === "recording" AND the moving detector reads "moving".
 *    So manualPaused time counts into elapsedS but NOT into movingS (deliberate: a lunch stop or a
 *    deliberate pause shouldn't inflate your moving average).
 */
import {
  ACC_DROUGHT_MS,
  ACC_MAX_M,
  ACC_MAX_RELAXED_M,
  AUTOPAUSE_MS,
  EMA_ALPHA,
  MAX_SPEED_MPS,
  MIN_DIST_M,
  MOVING_SPEED_MPS,
} from "./constants";
import { haversineM } from "./geo";
import type { RecorderEvent, RecorderState, TrackPoint } from "./types";

export function initialState(): RecorderState {
  return {
    status: "idle",
    startedAt: null,
    now: null,
    elapsedS: 0,
    movingS: 0,
    distanceM: 0,
    track: [],
    lastAccepted: null,
    lastAcceptedAt: null,
    speedEma: 0,
    isMoving: false,
    belowSince: null,
    lastAccrualAt: null,
  };
}

/** Accuracy ceiling for the given moment: relaxed once we've gone too long without a good fix. */
function accThreshold(state: RecorderState, now: number): number {
  const ref = state.lastAcceptedAt ?? state.startedAt ?? now;
  return now - ref >= ACC_DROUGHT_MS ? ACC_MAX_RELAXED_M : ACC_MAX_M;
}

/**
 * Advance the clock to `now`, accruing elapsed + moving time for the interval that just ended.
 * Uses the movement state that held DURING the interval, so callers accrue time *before* letting an
 * incoming fix change `isMoving`.
 */
function advanceTime(state: RecorderState, now: number): RecorderState {
  if (state.startedAt == null) return state;
  const last = state.lastAccrualAt ?? now;
  const dtMs = Math.max(0, now - last);
  const movingS =
    state.status === "recording" && state.isMoving
      ? state.movingS + dtMs / 1000
      : state.movingS;
  return {
    ...state,
    now,
    movingS,
    elapsedS: (now - state.startedAt) / 1000,
    lastAccrualAt: now,
  };
}

/** Apply an incoming GPS fix while recording/acquiring/autoPaused. `state` is already time-advanced. */
function applyFix(state: RecorderState, point: TrackPoint): RecorderState {
  const now = point.t;

  // Accuracy gate. A too-noisy fix tells us nothing reliable, so we drop it entirely (it does not
  // even feed the moving detector).
  if (point.acc > accThreshold(state, now)) return state;

  // First good fix while acquiring: seed the track and start recording.
  if (state.status === "acquiring") {
    return {
      ...state,
      status: "recording",
      track: [point],
      lastAccepted: point,
      lastAcceptedAt: now,
      speedEma: 0,
      isMoving: false,
      // Start the auto-pause clock: if the paddler never actually gets moving we'll auto-pause.
      belowSince: now,
    };
  }

  const last = state.lastAccepted;
  const lastAt = state.lastAcceptedAt;
  if (!last || lastAt == null) return state;

  const dist = haversineM(last, point);
  const dtS = (now - lastAt) / 1000;

  // Teleport gate: an implausibly fast jump is a GPS spike -- reject without feeding the detector.
  if (dtS > 0 && dist / dtS > MAX_SPEED_MPS) return state;

  // Feed the moving detector. This runs for BOTH accepted points and points rejected for the
  // min-distance rule below -- a stationary paddler jittering under 5 m must still be seen as
  // stopped so auto-pause can fire.
  const sample = dtS > 0 ? dist / dtS : 0;
  const speedEma = EMA_ALPHA * sample + (1 - EMA_ALPHA) * state.speedEma;
  const isMoving = speedEma > MOVING_SPEED_MPS;
  const belowSince = isMoving ? null : (state.belowSince ?? now);
  // Movement resumes an auto-pause; a manual pause is only ever cleared by an explicit RESUME.
  const status =
    state.status === "autoPaused" && isMoving ? "recording" : state.status;

  // Min-distance gate: too close to the last accepted point. Update the detector, but DO NOT append
  // or move `lastAccepted`/`lastAcceptedAt` -- keeping them fixed makes the implied speed of a
  // stationary cluster decay toward zero as time passes, which is what lets auto-pause trigger.
  if (dist < MIN_DIST_M) {
    return { ...state, speedEma, isMoving, belowSince, status };
  }

  return {
    ...state,
    status,
    track: [...state.track, point],
    distanceM: state.distanceM + dist,
    lastAccepted: point,
    lastAcceptedAt: now,
    speedEma,
    isMoving,
    belowSince,
  };
}

export function reducer(
  state: RecorderState,
  event: RecorderEvent,
): RecorderState {
  switch (event.type) {
    case "START": {
      if (state.status !== "idle") return state;
      return {
        ...initialState(),
        status: "acquiring",
        startedAt: event.now,
        now: event.now,
        lastAccrualAt: event.now,
      };
    }

    case "FIX": {
      // Only meaningful while actively recording or waiting for the first fix. Manual pause
      // deliberately ignores fixes (no distance while paused); idle/finished ignore them too.
      if (
        state.status !== "acquiring" &&
        state.status !== "recording" &&
        state.status !== "autoPaused"
      ) {
        return state;
      }
      const advanced = advanceTime(state, event.point.t);
      return applyFix(advanced, event.point);
    }

    case "TICK": {
      const advanced = advanceTime(state, event.now);
      if (
        advanced.status === "recording" &&
        advanced.belowSince != null &&
        event.now - advanced.belowSince >= AUTOPAUSE_MS
      ) {
        return { ...advanced, status: "autoPaused", isMoving: false };
      }
      return advanced;
    }

    case "PAUSE": {
      if (state.status !== "recording" && state.status !== "autoPaused") {
        return state;
      }
      const advanced = advanceTime(state, event.now);
      return {
        ...advanced,
        status: "manualPaused",
        isMoving: false,
        belowSince: null,
      };
    }

    case "RESUME": {
      if (state.status !== "manualPaused" && state.status !== "autoPaused") {
        return state;
      }
      const advanced = advanceTime(state, event.now);
      return {
        ...advanced,
        status: "recording",
        isMoving: false,
        belowSince: event.now,
      };
    }

    case "FINISH": {
      if (state.status === "finished" || state.status === "idle") return state;
      const advanced = advanceTime(state, event.now);
      return { ...advanced, status: "finished" };
    }

    case "RESTORE": {
      // A checkpoint is a complete RecorderState; restoring is a wholesale replace. Replaying events
      // afterwards is deterministic because `lastAccrualAt` travels inside the state.
      return event.state;
    }

    default:
      return state;
  }
}
