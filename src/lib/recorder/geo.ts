/**
 * Small, dependency-free geodesy helpers for the recorder core. Everything works in `[lng, lat]`
 * degrees and returns metres. For the short segments we deal with (a few metres to a few hundred),
 * a local equirectangular projection is more than accurate enough and far cheaper than repeated
 * great-circle maths.
 */

const EARTH_R = 6_371_008.8; // mean earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;

export interface LngLat {
  lng: number;
  lat: number;
}

/** Great-circle distance between two `[lng, lat]` points, in metres. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

interface XY {
  x: number;
  y: number;
}

/** Project a lng/lat to local metres about a reference latitude (equirectangular). */
function toXY(p: LngLat, refLatRad: number): XY {
  return {
    x: toRad(p.lng) * EARTH_R * Math.cos(refLatRad),
    y: toRad(p.lat) * EARTH_R,
  };
}

export interface NearestOnSegment {
  /** The closest point on segment [a,b] to p, as lng/lat. */
  point: LngLat;
  /** Perpendicular distance from p to that point, in metres. */
  distM: number;
  /** Parametric position along [a,b] in [0,1]. */
  t: number;
  /** Distance from `a` to the closest point along the segment, in metres. */
  alongM: number;
}

/**
 * Closest point on segment [a,b] to point p, plus the perpendicular distance and how far along the
 * segment the projection lands. Uses a local planar projection centred on the segment.
 */
export function nearestPointOnSegment(
  p: LngLat,
  a: LngLat,
  b: LngLat,
): NearestOnSegment {
  const refLatRad = toRad((a.lat + b.lat) / 2);
  const pa = toXY(a, refLatRad);
  const pb = toXY(b, refLatRad);
  const pp = toXY(p, refLatRad);

  const abx = pb.x - pa.x;
  const aby = pb.y - pa.y;
  const segLen2 = abx * abx + aby * aby;

  let t = 0;
  if (segLen2 > 0) {
    t = ((pp.x - pa.x) * abx + (pp.y - pa.y) * aby) / segLen2;
    t = Math.max(0, Math.min(1, t));
  }

  const cx = pa.x + t * abx;
  const cy = pa.y + t * aby;
  const dx = pp.x - cx;
  const dy = pp.y - cy;
  const distM = Math.sqrt(dx * dx + dy * dy);
  const segLen = Math.sqrt(segLen2);

  // Interpolate the closest point back to lng/lat (linear in degrees is fine at this scale).
  const point: LngLat = {
    lng: a.lng + t * (b.lng - a.lng),
    lat: a.lat + t * (b.lat - a.lat),
  };

  return { point, distM, t, alongM: t * segLen };
}
