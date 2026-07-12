/**
 * Tuning constants for the GPS-fix pipeline and moving detector. Kept in one place so the tests and
 * the runtime share a single source of truth.
 */

/** Reject fixes whose reported accuracy is worse than this many metres. */
export const ACC_MAX_M = 30;
/** Relaxed accuracy ceiling used after an accepted-fix drought (see below). */
export const ACC_MAX_RELAXED_M = 50;
/** If no fix has been accepted for this long, relax the accuracy ceiling so we don't stall. */
export const ACC_DROUGHT_MS = 60_000;

/** Reject a fix whose implied speed from the last accepted point exceeds this (a GPS teleport). */
export const MAX_SPEED_MPS = 4.5;

/** Minimum distance from the last accepted point before a new point is appended to the track. */
export const MIN_DIST_M = 5;

/** Moving detector: "moving" once the smoothed speed rises above this. */
export const MOVING_SPEED_MPS = 0.45;
/** After the smoothed speed stays below the moving threshold this long, auto-pause. */
export const AUTOPAUSE_MS = 20_000;
/** Smoothing factor for the speed EMA (higher = more responsive, less smoothing). */
export const EMA_ALPHA = 0.3;

export const METERS_PER_MILE = 1609.344;

/** Default historical cruising speed used to seed the live ETA before we have session data. */
export const DEFAULT_HISTORICAL_SPEED_MPS = 1.34;
