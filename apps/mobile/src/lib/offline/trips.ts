/**
 * Per-trip offline map management. A "downloaded trip" is a small `.pmtiles` archive covering just
 * the corridor around one route (carved server-side by GET /api/trips/[routeId]/tiles), stored on
 * the device so the nav map renders that route with zero network — the mobile analogue of web's
 * apps/web/src/lib/offline/download-trip.ts, but far simpler because the server does the tiling: the
 * client just downloads one file instead of enumerating and caching hundreds of z10-14 tiles.
 *
 * Storage:
 *   - the archive itself:  documentDirectory/trips/<routeId>.pmtiles
 *   - the index:           the `offline_trips` table in the shared offline-queue.db (see ./storage),
 *                          reusing the same SQLite handle the sync queue uses.
 *   - shared map assets:   documentDirectory/map/* (style/glyphs/sprite), ensured on every download
 *                          via ../map/offline-assets so the whole map — not just tiles — works offline.
 *
 * The download is authenticated with better-auth's cookie (the same header the tRPC links send), so
 * the route's owner-gated endpoint accepts it. expo-file-system's `File.downloadFileAsync` streams
 * the response straight to disk with progress + custom headers (verified against
 * node_modules/expo-file-system/build/File.d.ts and NetworkTasks.types.d.ts).
 */
import {
  Directory,
  File,
  Paths,
  type DownloadProgress,
} from "expo-file-system";

import { env } from "../../env";
import { authClient } from "../auth-client";
import { ensureOfflineMapAssets } from "../map/offline-assets";
import { getOfflineDb } from "./storage";

export type { DownloadProgress } from "expo-file-system";

/** A downloaded trip's index row, camel-cased for JS callers. */
export interface OfflineTrip {
  routeId: string;
  bytes: number;
  downloadedAt: number;
}

interface OfflineTripRow {
  route_id: string;
  bytes: number;
  downloaded_at: number;
}

/** The `documentDirectory/trips` directory (created on demand). */
function tripsDir(): Directory {
  return new Directory(Paths.document, "trips");
}

/** The `File` handle for a route's archive (may or may not exist on disk). */
function tripFile(routeId: string): File {
  return new File(tripsDir(), `${routeId}.pmtiles`);
}

/**
 * Download `routeId`'s corridor archive for offline use, ensure the shared style/glyph/sprite assets
 * are on device too, and record the index row. `onProgress` receives the raw `{ bytesWritten,
 * totalBytes }` (totalBytes is authoritative — the endpoint sends Content-Length). Overwrites any
 * previous copy (idempotent), so a re-download after a partial failure is safe.
 */
export async function downloadTrip(
  routeId: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<OfflineTrip> {
  tripsDir().create({ intermediates: true, idempotent: true });

  const cookie = authClient.getCookie();
  const url = `${env.EXPO_PUBLIC_API_URL}/api/trips/${routeId}/tiles`;

  const file = await File.downloadFileAsync(url, tripFile(routeId), {
    idempotent: true,
    headers: cookie ? { Cookie: cookie } : undefined,
    onProgress,
  });

  // The tiles are useless without the style/glyphs/sprite; ensure those are cached before we mark
  // the trip downloaded, so "downloaded" always means "renders fully offline".
  await ensureOfflineMapAssets();

  const downloadedAt = Date.now();
  const bytes = file.size;
  getOfflineDb().runSync(
    `INSERT OR REPLACE INTO offline_trips (route_id, bytes, downloaded_at)
     VALUES ($id, $bytes, $at);`,
    { $id: routeId, $bytes: bytes, $at: downloadedAt },
  );

  return { routeId, bytes, downloadedAt };
}

/** Remove a downloaded trip: delete its archive and index row. Shared map assets are left in place
 * (other downloaded trips still need them). */
export function deleteTrip(routeId: string): void {
  const file = tripFile(routeId);
  if (file.exists) file.delete();
  getOfflineDb().runSync(`DELETE FROM offline_trips WHERE route_id = $id;`, {
    $id: routeId,
  });
}

/** Every downloaded trip, newest first — for the routes list's "Downloaded" chips. */
export function getDownloadedTrips(): OfflineTrip[] {
  const rows = getOfflineDb().getAllSync<OfflineTripRow>(
    `SELECT route_id, bytes, downloaded_at FROM offline_trips
     ORDER BY downloaded_at DESC;`,
  );
  return rows.map((r) => ({
    routeId: r.route_id,
    bytes: r.bytes,
    downloadedAt: r.downloaded_at,
  }));
}

/** The index row for one route, or undefined if it isn't downloaded. */
export function getDownloadedTrip(routeId: string): OfflineTrip | undefined {
  const row = getOfflineDb().getFirstSync<OfflineTripRow>(
    `SELECT route_id, bytes, downloaded_at FROM offline_trips WHERE route_id = $id;`,
    { $id: routeId },
  );
  return row
    ? { routeId: row.route_id, bytes: row.bytes, downloadedAt: row.downloaded_at }
    : undefined;
}

/** Whether a route is downloaded AND its archive is still present on disk. */
export function isDownloaded(routeId: string): boolean {
  return getDownloadedTrip(routeId) !== undefined && tripFile(routeId).exists;
}

/**
 * The local `file://` URI of a downloaded trip's archive, or null if it isn't downloaded (or the
 * file has gone missing). Fed into the map style as `pmtiles://<uri>` for fully-offline rendering.
 */
export function getOfflineTripPath(routeId: string): string | null {
  if (getDownloadedTrip(routeId) === undefined) return null;
  const file = tripFile(routeId);
  return file.exists ? file.uri : null;
}
