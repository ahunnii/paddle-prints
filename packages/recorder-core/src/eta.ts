/**
 * Live ETA for the remaining distance on a route.
 *
 * The naive `remaining / sessionAverage` is jittery and useless in the first minutes, when the
 * session average swings wildly (or is undefined). So for the first 5 minutes of *moving* time we
 * blend the session's own average with a provided historical cruising speed, ramping the session
 * weight from 0 to 1 over those 5 minutes.
 */
import { DEFAULT_HISTORICAL_SPEED_MPS } from "./constants";

const BLEND_WINDOW_S = 300;
const MIN_SPEED_MPS = 0.1; // floor so ETA never divides by ~0

export interface EtaInput {
  remainingM: number;
  /** Seconds spent moving this session. */
  movingS: number;
  /** Distance covered this session, metres (used with movingS for the session average). */
  sessionDistanceM: number;
  /** Historical average moving speed for this paddler/route, m/s. */
  historicalSpeedMps?: number;
}

export interface EtaResult {
  /** Estimated seconds until the route end. `Infinity` if there's effectively no speed. */
  etaSeconds: number;
  /** The blended speed used, m/s. */
  speedMps: number;
}

export function computeEta(input: EtaInput): EtaResult {
  const historical = input.historicalSpeedMps ?? DEFAULT_HISTORICAL_SPEED_MPS;
  const sessionAvg =
    input.movingS > 0 ? input.sessionDistanceM / input.movingS : 0;

  const w = Math.min(input.movingS / BLEND_WINDOW_S, 1);
  const blended = w * sessionAvg + (1 - w) * historical;
  const speedMps = Math.max(blended, MIN_SPEED_MPS);

  const etaSeconds = input.remainingM <= 0 ? 0 : input.remainingM / speedMps;
  return { etaSeconds, speedMps };
}
