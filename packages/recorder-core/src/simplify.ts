/**
 * Douglas-Peucker line simplification with a tolerance expressed in METRES.
 *
 * Why hand-rolled instead of `@turf/simplify`: turf's tolerance is in coordinate degrees (or needs
 * its slower high-quality mode), which is awkward and latitude-dependent. We want "~10 m" to mean
 * 10 m, and we want to carry each point's `{t, acc}` through untouched, so a small DP that measures
 * perpendicular distance in metres and keeps whole TrackPoints is both simpler and a better fit.
 */
import { nearestPointOnSegment } from "./geo";
import type { TrackPoint } from "./types";

export function simplifyTrack(
  points: TrackPoint[],
  toleranceM: number,
): TrackPoint[] {
  if (points.length <= 2) return points.slice();

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Iterative DP (explicit stack) to avoid recursion depth issues on long tracks.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    let maxDist = -1;
    let idx = -1;
    const a = points[start]!;
    const b = points[end]!;
    for (let i = start + 1; i < end; i++) {
      const d = nearestPointOnSegment(points[i]!, a, b).distM;
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }

    if (maxDist > toleranceM && idx !== -1) {
      keep[idx] = true;
      stack.push([start, idx], [idx, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}
