/**
 * The PMTiles offline seam. `IdbSource` implements the pmtiles `Source` interface (the byte-range
 * abstraction the whole pmtiles lib reads through) by serving header + directory ranges from
 * IndexedDB and falling through to a plain `FetchSource` on a miss. Because every header/directory
 * read is a deterministic (offset,length) range, caching at this layer means a downloaded archive's
 * metadata is available with zero network -- so `getHeader()`/`getZxy()` work offline for any tile we
 * also cached in the `tiles` store.
 *
 * We persist ONLY metadata ranges (offset < tileDataOffset). Actual tile payloads are cached
 * per-{z,x,y} in the `tiles` store (see tile-cache.ts) so we get per-trip accounting + refcounting,
 * which a flat byte-range cache could not give us.
 */
import {
  PMTiles,
  FetchSource,
  bytesToHeader,
  type Source,
  type RangeResponse,
  type Header,
} from "pmtiles";

import { db } from "./db";

class IdbSource implements Source {
  private inner: FetchSource;
  /** Learned from the header read; ranges below it are header/directory metadata worth persisting. */
  private tileDataOffset: number | undefined;

  constructor(private readonly url: string) {
    this.inner = new FetchSource(url);
  }

  getKey(): string {
    return this.url;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const key = `${offset}-${length}`;
    const cached = await db().pmtilesMeta.get(key);
    if (cached) return { data: cached.data, etag: cached.etag };

    const resp = await this.inner.getBytes(offset, length, signal, etag);

    if (offset === 0 && this.tileDataOffset === undefined) {
      try {
        this.tileDataOffset = bytesToHeader(
          resp.data.slice(0, 127),
          resp.etag,
        ).tileDataOffset;
      } catch {
        /* not a header read after all; leave undefined */
      }
    }

    // Persist header (offset 0, before we know the boundary) and any directory range below the tile
    // data section. Tile payloads (offset >= tileDataOffset) are cached elsewhere, per {z,x,y}.
    const isMetadata =
      this.tileDataOffset === undefined || offset < this.tileDataOffset;
    if (isMetadata) {
      await db().pmtilesMeta.put({ key, data: resp.data, etag: resp.etag });
    }
    return resp;
  }
}

const instances = new Map<string, PMTiles>();

/** One shared PMTiles instance per archive URL, backed by the IDB-caching source. */
export function getPmtiles(url: string): PMTiles {
  let p = instances.get(url);
  if (!p) {
    p = new PMTiles(new IdbSource(url));
    instances.set(url, p);
  }
  return p;
}

/** Header of an archive (min/max zoom, bounds). Served from IDB metadata cache when offline. */
export function getPmtilesHeader(url: string): Promise<Header> {
  return getPmtiles(url).getHeader();
}

/** Decompressed bytes for one tile from the network (via cached directories), or null if absent. */
export async function fetchTileBytes(
  url: string,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  const resp = await getPmtiles(url).getZxy(z, x, y, signal);
  return resp ? resp.data : null;
}
