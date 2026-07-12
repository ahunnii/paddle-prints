/**
 * Pure helper for the nav-mode "next POI ahead" banner: given the corridor POIs for a route (as
 * returned by `routes.byId`, each with a `routeDistM` -- their position along the OUTBOUND line) and
 * the paddler's current progress, find the nearest POI ahead.
 *
 * WHY TWO CANDIDATE POSITIONS ON OUT-AND-BACK:
 *  The progress polyline for an out-and-back route is outbound + reversed (total length 2L; see
 *  progress.ts). A POI's real-world location therefore maps to TWO positions on that polyline: `d`
 *  on the outbound leg and `2L - d` on the return leg. Whichever of those hasn't been passed yet is
 *  the one that's "ahead" -- so a hazard flagged on the way out naturally becomes "ahead" again on
 *  the way back as the paddler approaches it a second time.
 */

export interface CorridorPoi {
  id: string;
  category: string;
  note: string | null;
  /** Position along the route's outbound line, metres from the start (0..distanceM). */
  routeDistM: number;
  /** Real-world coordinates, so the nav map can plot the same POI as a marker. */
  lng: number;
  lat: number;
}

export interface NextPoiAheadResult {
  poi: CorridorPoi;
  /** The candidate position (metres, in progress-polyline space) this result matched on. */
  positionM: number;
  /** Distance from current progress to that position, metres, clamped to >= 0 for display. */
  distanceAheadM: number;
}

/**
 * How far past a candidate position progress can advance before it stops counting as "current" --
 * keeps the banner showing the just-reached POI for a short window instead of vanishing the instant
 * progressM ticks past it, and is what lets an out-and-back POI's outbound position hand off to its
 * return position rather than both looking "passed" at once.
 */
const PASS_GRACE_M = 30;

function candidatePositions(
  poi: CorridorPoi,
  shape: "one_way" | "out_and_back",
  totalM: number,
): number[] {
  if (shape === "one_way") return [poi.routeDistM];
  const L = totalM / 2;
  return [poi.routeDistM, 2 * L - poi.routeDistM];
}

/**
 * The nearest-ahead POI, direction-aware. Returns null when nothing qualifies (every candidate
 * position has been passed by more than the grace window).
 */
export function nextPoiAhead(
  pois: CorridorPoi[],
  shape: "one_way" | "out_and_back",
  totalM: number,
  progressM: number,
): NextPoiAheadResult | null {
  let best: NextPoiAheadResult | null = null;
  for (const poi of pois) {
    for (const positionM of candidatePositions(poi, shape, totalM)) {
      if (positionM <= progressM - PASS_GRACE_M) continue;
      if (best && positionM >= best.positionM) continue;
      best = { poi, positionM, distanceAheadM: Math.max(0, positionM - progressM) };
    }
  }
  return best;
}
