/**
 * Progress-polyline matching: given a route and a stream of accepted GPS fixes, report how far along
 * the route the paddler is, how much remains, and whether they've wandered off it.
 *
 * WHY A WINDOWED NEAREST-SEGMENT SEARCH (and not a global one):
 *  - Out-and-back routes are modelled as the outbound line followed by its reverse (total length 2L).
 *    The two legs are geometrically identical, so a *global* nearest-segment search on the return leg
 *    would snap right back onto the outbound half and the progress bar would collapse from ~1.5L to
 *    ~0.5L. Searching only a window (a little behind, well ahead of) the last matched vertex keeps us
 *    on the correct leg.
 *  - The same reasoning covers tight horseshoe bends on a one-way river, where the line doubles back
 *    close to itself: only the locally-correct segment is in the window.
 */
import { haversineM, nearestPointOnSegment, type LngLat } from "./geo";

/** How far behind / ahead of the last matched vertex the nearest-segment search looks. */
const WINDOW_BACK = 20;
const WINDOW_FWD = 60;
/** A match this much perpendicular from the route counts as off-route. */
const OFFROUTE_PERP_M = 75;
/** Ignore a candidate that would move progress backwards by more than this (GPS wobble tolerance). */
const BACKTRACK_TOLERANCE_M = 30;
/**
 * When two segments are within this many metres of being equally close, prefer the one that carries
 * progress FORWARD. On an out-and-back the return leg lies exactly on top of the outbound leg, so
 * the perpendicular distances tie; without a forward bias the search would lock onto the (earlier,
 * lower-indexed) outbound segment and progress would collapse at the turnaround. The window already
 * excludes twin segments once they're > WINDOW_BACK behind; this handles the ones still inside it.
 */
const PERP_TIE_M = 8;

export interface ProgressModel {
  /** Expanded polyline vertices (out-and-back is outbound + reversed). */
  pts: LngLat[];
  /** Cumulative distance to each vertex, metres. `cum[0] === 0`. */
  cum: number[];
  /** Total traversable length (2L for out-and-back), metres. */
  totalM: number;
}

export interface MatchState {
  /** Index of the segment the last accepted fix matched. */
  lastIndex: number;
  /** Running maximum progress, metres -- progress is reported monotonically from this. */
  maxProgressM: number;
}

export interface ProgressResult {
  progressM: number;
  remainingM: number;
  offRoute: boolean;
  /** Point on the route at the reported progress distance (for the snapped-progress marker). */
  snapped: LngLat;
  /** Perpendicular distance of the fix from the route, metres. */
  perpM: number;
}

/**
 * Build the progress model from a route's raw coordinates. For `out_and_back`, the return leg is the
 * outbound reversed (skipping the duplicated turnaround vertex) so total length is exactly 2L.
 */
export function buildProgressModel(
  coords: Array<[number, number]>,
  shape: "one_way" | "out_and_back",
): ProgressModel {
  const outbound: LngLat[] = coords.map(([lng, lat]) => ({ lng, lat }));
  const pts =
    shape === "out_and_back"
      ? [...outbound, ...outbound.slice(0, -1).reverse()]
      : outbound;

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1]! + haversineM(pts[i - 1]!, pts[i]!);
  }
  return { pts, cum, totalM: cum[cum.length - 1] ?? 0 };
}

export function createMatchState(): MatchState {
  return { lastIndex: 0, maxProgressM: 0 };
}

/** The point on the model at cumulative distance `d` (clamped to the route). */
export function pointAtDistance(model: ProgressModel, d: number): LngLat {
  const { pts, cum, totalM } = model;
  if (pts.length === 0) return { lng: 0, lat: 0 };
  const dist = Math.max(0, Math.min(totalM, d));
  // Linear scan is fine; cum is short and callers already do per-fix work.
  for (let i = 1; i < cum.length; i++) {
    if (dist <= cum[i]!) {
      const segLen = cum[i]! - cum[i - 1]!;
      const t = segLen > 0 ? (dist - cum[i - 1]!) / segLen : 0;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      return { lng: a.lng + t * (b.lng - a.lng), lat: a.lat + t * (b.lat - a.lat) };
    }
  }
  return pts[pts.length - 1]!;
}

/**
 * Match one accepted fix against the model. Pure: returns the result plus the next MatchState.
 */
export function matchProgress(
  model: ProgressModel,
  state: MatchState,
  point: LngLat,
): { result: ProgressResult; next: MatchState } {
  const segCount = model.pts.length - 1;
  const lo = Math.max(0, state.lastIndex - WINDOW_BACK);
  const hi = Math.min(segCount - 1, state.lastIndex + WINDOW_FWD);

  // Two-pass so overlapping geometry resolves toward forward progress: first find the minimum
  // perpendicular distance, then among all segments within PERP_TIE_M of it pick the greatest
  // progress (the most-forward interpretation of an ambiguous position).
  let bestPerp = Infinity;
  const cands: Array<{ index: number; perp: number; progress: number }> = [];
  for (let i = lo; i <= hi; i++) {
    const near = nearestPointOnSegment(point, model.pts[i]!, model.pts[i + 1]!);
    cands.push({ index: i, perp: near.distM, progress: model.cum[i]! + near.alongM });
    if (near.distM < bestPerp) bestPerp = near.distM;
  }

  let bestProgress = state.maxProgressM;
  let bestIndex = state.lastIndex;
  let chosen = false;
  for (const c of cands) {
    if (c.perp <= bestPerp + PERP_TIE_M && (!chosen || c.progress > bestProgress)) {
      bestProgress = c.progress;
      bestIndex = c.index;
      chosen = true;
    }
  }

  const offRoute = bestPerp > OFFROUTE_PERP_M;

  // Off-route OR a large backward jump (likely a mis-match): freeze progress at the running max and
  // hold the search window where it was, so we can re-acquire cleanly when the paddler returns.
  if (offRoute || bestProgress < state.maxProgressM - BACKTRACK_TOLERANCE_M) {
    const progressM = state.maxProgressM;
    return {
      result: {
        progressM,
        remainingM: model.totalM - progressM,
        offRoute,
        snapped: pointAtDistance(model, progressM),
        perpM: bestPerp,
      },
      next: state,
    };
  }

  // On-route: advance the window and report progress monotonically from the running max.
  const maxProgressM = Math.max(state.maxProgressM, bestProgress);
  return {
    result: {
      progressM: maxProgressM,
      remainingM: model.totalM - maxProgressM,
      offRoute: false,
      snapped: pointAtDistance(model, maxProgressM),
      perpM: bestPerp,
    },
    next: { lastIndex: bestIndex, maxProgressM },
  };
}
