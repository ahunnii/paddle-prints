/**
 * Small geometry helpers shared by screens that frame a MapLibre camera to a set of coordinates.
 * Extracted from (app)/paddles/[id].tsx so (app)/routes/[id].tsx can reuse the same bbox math.
 */
import type { Bbox } from "../components/map/base-map";

/** Bounding box of a coordinate list, in the [west, south, east, north] order every camera call
 * expects (matches `Bbox` / MLRN's flat `LngLatBounds` tuple). Callers only invoke this with a
 * non-empty array. */
export function boundsOf(coords: Array<[number, number]>): Bbox {
  let west = coords[0]![0]!;
  let east = west;
  let south = coords[0]![1]!;
  let north = south;
  for (const [lng, lat] of coords) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}
