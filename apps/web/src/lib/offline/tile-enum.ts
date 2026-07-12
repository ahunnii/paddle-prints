/**
 * Pure tile-set enumeration for trip downloads. Given a route line, buffer it into a corridor and
 * list every {z,x,y} slippy tile (z10-14) that intersects the corridor. No browser, no network --
 * unit-tested directly against a known small route.
 */
import buffer from "@turf/buffer";
import { lineString } from "@turf/helpers";
// tiles(geom, limits) => [x,y,z][]; typed via src/types/mapbox__tile-cover.d.ts
import { tiles as coverTiles } from "@mapbox/tile-cover";

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Zoom range we pull for offline use: z10 gives regional context, z14 gives paddling-close detail. */
export const OFFLINE_MIN_ZOOM = 10;
export const OFFLINE_MAX_ZOOM = 14;

/** How far either side of the route line we consider "the corridor", in kilometres. */
export const CORRIDOR_KM = 1.5;

/** Buffer a route line by CORRIDOR_KM and return its polygon geometry (Polygon or MultiPolygon). */
export function corridorPolygon(
  coords: Array<[number, number]>,
  km = CORRIDOR_KM,
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const line = lineString(coords);
  const buffered = buffer(line, km, { units: "kilometers" });
  if (!buffered) throw new Error("Failed to buffer route corridor");
  return buffered.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/**
 * The full tile set covering a route's corridor across [minZoom, maxZoom].
 *
 * tile-cover only returns a tile when the polygon covers (roughly) the tile's centre. For a 1.5 km
 * corridor that means low zooms come back EMPTY -- a z10 tile is ~30 km across, far larger than the
 * corridor, so no z10 centre falls inside it and zooming out offline would go blank. So we take the
 * accurate fine-zoom coverage (which follows the line) and walk each fine tile UP the pyramid,
 * unioning in its ancestor at every zoom. An ancestor tile contains its descendant, so it provably
 * intersects the corridor -- guaranteeing continuous coverage at every zoom, with the tile count
 * shrinking naturally toward lower zooms.
 */
export function enumerateTiles(
  coords: Array<[number, number]>,
  minZoom = OFFLINE_MIN_ZOOM,
  maxZoom = OFFLINE_MAX_ZOOM,
  km = CORRIDOR_KM,
): Tile[] {
  const geom = corridorPolygon(coords, km);
  const seen = new Set<string>();
  const out: Tile[] = [];
  const add = (z: number, x: number, y: number) => {
    const key = `${z}/${x}/${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ z, x, y });
  };

  // Accurate line-following coverage at the finest zoom, plus whatever tile-cover finds across the
  // range (fills mid-zoom detail; a no-op at zooms where it returns nothing).
  const finest = coverTiles(geom, { min_zoom: maxZoom, max_zoom: maxZoom });
  for (const [x, y, z] of coverTiles(geom, {
    min_zoom: minZoom,
    max_zoom: maxZoom,
  })) {
    add(z, x, y);
  }

  // Roll each finest tile up to minZoom, adding the containing ancestor at each level.
  for (const [x0, y0] of finest) {
    let x = x0;
    let y = y0;
    for (let z = maxZoom; z >= minZoom; z--) {
      add(z, x, y);
      x = x >> 1;
      y = y >> 1;
    }
  }

  return out;
}

/** Canonical cache key for a tile. */
export function tileKey(t: Tile): string {
  return `${t.z}/${t.x}/${t.y}`;
}
