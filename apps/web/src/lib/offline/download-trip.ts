/**
 * Trip download orchestration. `downloadTrip` pulls a route + its corridor POIs from the server,
 * stores them for offline rendering, then fetches every z10-14 tile intersecting a 1.5 km corridor
 * through the protocol tile cache (concurrency 6, one retry, abortable), tagging each tile with the
 * routeId so shared tiles are refcounted. `deleteTrip` releases that hold.
 */
import { getTilesUrl } from "~/lib/map/protocol";

import {
  db,
  type StoredPoi,
  type StoredRoute,
  type TripRecord,
} from "./db";
import { enumerateTiles, tileKey } from "./tile-enum";
import { downloadTile, releaseTrip } from "./tile-cache";
import { fetchTileBytes } from "./pmtiles-source";
import { trpcVanilla } from "./trpc-vanilla";

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

const CONCURRENCY = 6;

/** Download `routeId` for offline use. Rejects (and rolls back) if aborted via `signal`. */
export async function downloadTrip(
  routeId: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<TripRecord> {
  const url = getTilesUrl();
  const route = await trpcVanilla.routes.byId.query({ id: routeId });

  const storedRoute: StoredRoute = {
    id: route.id,
    name: route.name,
    type: route.type,
    shape: route.shape,
    distanceM: route.distanceM,
    coords: route.geom.coordinates.map((c) => [c[0]!, c[1]!] as [number, number]),
  };

  const pois: StoredPoi[] = route.pois.map((p) => ({
    id: p.id,
    category: p.category,
    note: p.note,
    lng: p.geom.coordinates[0]!,
    lat: p.geom.coordinates[1]!,
    routeDistM: p.routeDistM,
    creatorName: p.creatorName,
    createdAt:
      p.createdAt instanceof Date
        ? p.createdAt.toISOString()
        : String(p.createdAt),
  }));

  const tiles = enumerateTiles(storedRoute.coords);
  const total = tiles.length;

  // Persist route + POIs up front so route detail / nav render offline even mid-download.
  await db().trips.put({
    routeId,
    route: storedRoute,
    pois,
    downloadedAt: Date.now(),
    tileCount: 0,
    bytes: 0,
  });

  let done = 0;
  let bytes = 0;
  onProgress?.({ done, total, bytes });

  const queue = [...tiles];
  const fetchMiss = (z: number, x: number, y: number) =>
    fetchTileBytes(url, z, x, y, signal);

  async function worker(): Promise<void> {
    for (;;) {
      const tile = queue.pop();
      if (!tile) return;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const key = tileKey(tile);

      let size = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          size = await downloadTile(key, fetchMiss, routeId);
          break;
        } catch (err) {
          if (attempt === 1 || signal?.aborted) throw err;
        }
      }
      done++;
      bytes += size;
      onProgress?.({ done, total, bytes });
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total || 1) }, worker),
    );
  } catch (err) {
    // Roll back a partial/aborted download so it never lingers as a "downloaded" trip.
    await releaseTrip(routeId);
    await db().trips.delete(routeId);
    throw err;
  }

  const record: TripRecord = {
    routeId,
    route: storedRoute,
    pois,
    downloadedAt: Date.now(),
    tileCount: done,
    bytes,
  };
  await db().trips.put(record);
  onProgress?.({ done, total, bytes });
  return record;
}

/** Remove a downloaded trip and release its tiles (deleting any no other trip still needs). */
export async function deleteTrip(routeId: string): Promise<void> {
  await releaseTrip(routeId);
  await db().trips.delete(routeId);
}

/** The stored trip for a route, or undefined if it isn't downloaded. */
export function getTrip(routeId: string): Promise<TripRecord | undefined> {
  return db().trips.get(routeId);
}

export interface TripStorageSummary {
  routeId: string;
  name: string;
  bytes: number;
  tileCount: number;
  downloadedAt: number;
}

/** Per-trip sizes + total, for the storage manager UI. */
export async function getTripStorageSummary(): Promise<{
  trips: TripStorageSummary[];
  totalBytes: number;
}> {
  const trips = await db().trips.toArray();
  const summaries = trips
    .map((t) => ({
      routeId: t.routeId,
      name: t.route.name,
      bytes: t.bytes,
      tileCount: t.tileCount,
      downloadedAt: t.downloadedAt,
    }))
    .sort((a, b) => b.downloadedAt - a.downloadedAt);
  const totalBytes = summaries.reduce((s, t) => s + t.bytes, 0);
  return { trips: summaries, totalBytes };
}
