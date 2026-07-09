import { Protocol } from "pmtiles";
import maplibregl from "maplibre-gl";

import { env } from "~/env";

const DEV_TILES_URL = "http://localhost:8080/michigan.pmtiles";

let registered = false;

/**
 * Registers the pmtiles:// protocol with maplibre-gl. Safe to call multiple
 * times (e.g. across React strict-mode double-mounts) -- only registers once.
 */
export function registerPmtilesProtocol(): void {
  if (registered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  registered = true;
}

/**
 * Returns the URL of the PMTiles archive to load tiles from. Reads
 * NEXT_PUBLIC_TILES_URL, falling back to the local dev tile server started by
 * `pnpm tiles:serve`.
 */
export function getTilesUrl(): string {
  return env.NEXT_PUBLIC_TILES_URL ?? DEV_TILES_URL;
}
