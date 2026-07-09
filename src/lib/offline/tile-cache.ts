/**
 * The tile cache logic layer: read-through caching, misc-tile LRU eviction, and downloaded-trip
 * refcounting, all expressed over the Dexie `tiles` store. Kept free of pmtiles/maplibre imports and
 * parameterised by an injected `fetchMiss` so the refcount + LRU state machine is unit-tested against
 * fake-indexeddb with a stub fetcher. The browser wiring (a real PMTiles source) lives in
 * pmtiles-source.ts / protocol.ts.
 */
import { db, type TileRecord } from "./db";

/** Beyond this many bytes of *misc* (un-refcounted, casually-browsed) tiles, evict LRU. */
export const MISC_BUDGET_BYTES = 50 * 1024 * 1024;

/** Fetch a tile's decompressed bytes from the network on a cache miss, or null if it doesn't exist. */
export type FetchMiss = (
  z: number,
  x: number,
  y: number,
) => Promise<ArrayBuffer | null>;

function parseKey(key: string): { z: number; x: number; y: number } {
  const [z, x, y] = key.split("/").map(Number) as [number, number, number];
  return { z, x, y };
}

/**
 * Read-through cache for the map protocol. Returns tile bytes for `key` ("z/x/y"):
 *  - cache hit -> bump lastAccess, return bytes (works fully offline);
 *  - miss + offline -> null (protocol renders a blank tile);
 *  - miss + online -> fetch, write-through as a *misc* tile (LRU-bounded), return bytes.
 * Downloaded-trip tiles never reach the miss path (they're always present), so write-through here is
 * always misc; misc storage is capped at MISC_BUDGET_BYTES.
 */
export async function readTile(
  key: string,
  fetchMiss: FetchMiss,
  online: boolean,
): Promise<Uint8Array | null> {
  const rec = await db().tiles.get(key);
  if (rec) {
    // Fire-and-forget touch so reads stay fast; a lost lastAccess bump only perturbs LRU order.
    void db().tiles.update(key, { lastAccess: Date.now() });
    return new Uint8Array(rec.bytes);
  }
  if (!online) return null;

  const { z, x, y } = parseKey(key);
  const data = await fetchMiss(z, x, y);
  if (!data) return null;

  await db().tiles.put({
    key,
    bytes: data,
    size: data.byteLength,
    routeIds: [],
    lastAccess: Date.now(),
  });
  await evictMiscToBudget();
  return new Uint8Array(data);
}

/**
 * Ensure the tile for `key` is cached and tagged as belonging to `routeId`. Returns the tile's size
 * in bytes (0 if the tile does not exist in the archive -- e.g. an all-water tile with no features).
 * Idempotent: re-downloading a trip, or two trips sharing a tile, just unions the routeId in.
 */
export async function downloadTile(
  key: string,
  fetchMiss: FetchMiss,
  routeId: string,
): Promise<number> {
  const rec = await db().tiles.get(key);
  if (rec) {
    if (!rec.routeIds.includes(routeId)) {
      await db().tiles.update(key, {
        routeIds: [...rec.routeIds, routeId],
        lastAccess: Date.now(),
      });
    }
    return rec.size;
  }

  const { z, x, y } = parseKey(key);
  const data = await fetchMiss(z, x, y);
  if (!data) return 0;

  await db().tiles.put({
    key,
    bytes: data,
    size: data.byteLength,
    routeIds: [routeId],
    lastAccess: Date.now(),
  });
  return data.byteLength;
}

/**
 * Release a downloaded trip's hold on its tiles: drop `routeId` from every tile's refcount, deleting
 * any tile that no trip needs any more. Misc tiles (never refcounted) are untouched.
 */
export async function releaseTrip(routeId: string): Promise<void> {
  const shared = await db().tiles.where("routeIds").equals(routeId).toArray();
  await db().transaction("rw", db().tiles, async () => {
    for (const t of shared) {
      const routeIds = t.routeIds.filter((r) => r !== routeId);
      if (routeIds.length === 0) {
        await db().tiles.delete(t.key);
      } else {
        await db().tiles.update(t.key, { routeIds });
      }
    }
  });
}

/** Total bytes currently held by misc (un-refcounted) tiles. */
export async function miscBytes(): Promise<number> {
  const misc = await miscTiles();
  return misc.reduce((sum, t) => sum + t.size, 0);
}

async function miscTiles(): Promise<TileRecord[]> {
  return db().tiles.filter((t) => t.routeIds.length === 0).toArray();
}

/** Evict least-recently-used misc tiles until misc storage is within MISC_BUDGET_BYTES. */
export async function evictMiscToBudget(
  budget = MISC_BUDGET_BYTES,
): Promise<void> {
  const misc = await miscTiles();
  let total = misc.reduce((sum, t) => sum + t.size, 0);
  if (total <= budget) return;
  misc.sort((a, b) => a.lastAccess - b.lastAccess); // oldest first
  for (const t of misc) {
    if (total <= budget) break;
    await db().tiles.delete(t.key);
    total -= t.size;
  }
}
