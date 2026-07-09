import maplibregl, { type RequestParameters } from "maplibre-gl";

import { env } from "~/env";
import { readTile } from "~/lib/offline/tile-cache";
import { fetchTileBytes, getPmtilesHeader } from "~/lib/offline/pmtiles-source";

const DEV_TILES_URL = "http://localhost:8080/michigan.pmtiles";
const PMTILES_PREFIX = "pmtiles://";

let registered = false;

/** Are we currently online? Server-side (no navigator) assume yes; browsers honour navigator.onLine. */
function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * maplibre protocol handler for `pmtiles://<archiveUrl>[/{z}/{x}/{y}]`, routed through the offline
 * tile cache:
 *  - a `json` request builds the source's TileJSON from the (IDB-cached) PMTiles header, so the map
 *    can initialise a downloaded archive fully offline;
 *  - a tile request is served from IndexedDB, or fetched-and-cached online, or returned as a blank
 *    tile when offline + uncached (maplibre renders blanks gracefully -- an error would break the map).
 */
async function pmtilesProtocol(
  params: RequestParameters,
  abortController: AbortController,
): Promise<{ data: unknown }> {
  const { url } = params;

  if (params.type === "json") {
    const archive = url.substring(PMTILES_PREFIX.length);
    const header = await getPmtilesHeader(archive);
    return {
      data: {
        tiles: [`${url}/{z}/{x}/{y}`],
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      },
    };
  }

  const match = url.match(/pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) throw new Error(`Invalid PMTiles protocol URL: ${url}`);
  const archive = match[1]!;
  const z = +match[2]!;
  const x = +match[3]!;
  const y = +match[4]!;

  const bytes = await readTile(
    `${z}/${x}/${y}`,
    (tz, tx, ty) => fetchTileBytes(archive, tz, tx, ty, abortController.signal),
    isOnline(),
  );
  // Blank tile (empty buffer) on an offline miss -- never throw, or maplibre drops the whole layer.
  return { data: bytes ?? new Uint8Array() };
}

/**
 * Registers the pmtiles:// protocol with maplibre-gl. Safe to call multiple times (e.g. across React
 * strict-mode double-mounts) -- only registers once.
 */
export function registerPmtilesProtocol(): void {
  if (registered) return;
  maplibregl.addProtocol("pmtiles", pmtilesProtocol);
  registered = true;
}

/**
 * Returns the URL of the PMTiles archive to load tiles from. Reads NEXT_PUBLIC_TILES_URL, falling
 * back to the local dev tile server started by `pnpm tiles:serve`.
 */
export function getTilesUrl(): string {
  return env.NEXT_PUBLIC_TILES_URL ?? DEV_TILES_URL;
}
