/**
 * Shared types for the recording engine. These describe the PURE core (machine, progress, eta,
 * checkpoint) and are intentionally free of any browser/React types so the modules that use them
 * can be unit-tested under plain Node.
 */

/** A single GPS sample kept in the track. `t` is epoch milliseconds; `acc` is accuracy in metres. */
export interface TrackPoint {
  lng: number;
  lat: number;
  t: number;
  acc: number;
}

export type RecorderStatus =
  | "idle"
  | "acquiring"
  | "recording"
  | "autoPaused"
  | "manualPaused"
  | "finished";

/** Whether a recorded trip is a straight run or an out-and-back (mirrors `routeType`... actually `routeShape`). */
export type TripType = "river" | "waypoint";

/**
 * The full state of the recorder machine. This object is a pure value: the reducer maps
 * `(state, event) -> state` with no IO, and the whole object is what gets serialised to a
 * checkpoint, so it MUST hold everything needed to resume a recording deterministically.
 */
export interface RecorderState {
  status: RecorderStatus;
  /** Epoch ms when START was dispatched. Elapsed time is measured from here. */
  startedAt: number | null;
  /** Most recent timestamp the machine has seen (from a TICK or FIX). */
  now: number | null;
  /** Wall-clock seconds since `startedAt`. Counts paused time too (see machine.ts). */
  elapsedS: number;
  /** Seconds accrued only while actively moving. */
  movingS: number;
  /** Cumulative haversine distance over accepted points, in metres. */
  distanceM: number;
  /** Accepted GPS points, in order. */
  track: TrackPoint[];
  /** The last accepted point (min-distance/teleport gates measure against this). */
  lastAccepted: TrackPoint | null;
  /** Timestamp of the last accepted point (drought + speed timing). */
  lastAcceptedAt: number | null;
  /** Exponential moving average of speed, m/s. */
  speedEma: number;
  /** Whether the moving detector currently reads "moving". */
  isMoving: boolean;
  /** When speed first dropped below the moving threshold (drives auto-pause), else null. */
  belowSince: number | null;
  /** Last timestamp we accrued moving/elapsed time up to. */
  lastAccrualAt: number | null;
}

/** Events the reducer understands. */
export type RecorderEvent =
  | { type: "START"; now: number }
  | { type: "FIX"; point: TrackPoint }
  | { type: "TICK"; now: number }
  | { type: "PAUSE"; now: number }
  | { type: "RESUME"; now: number }
  | { type: "FINISH"; now: number }
  | { type: "RESTORE"; state: RecorderState };
