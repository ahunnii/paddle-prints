/**
 * The offline data layer (Phase 6). A single IndexedDB database, "paddle-prints", holding everything
 * a phone needs to survive a coverage-free river: downloaded trips + their map tiles, the recorder's
 * crash checkpoint, and the outbound queue of paddles/POIs waiting to reach the server.
 *
 * Everything correctness-critical about the offline layer is built on these stores. The stores are
 * deliberately dumb (plain records keyed by natural keys); the interesting logic lives in
 * tile-cache.ts (refcounting/LRU), download-trip.ts (enumeration) and sync.ts (the send state
 * machine), all of which are unit-tested against fake-indexeddb.
 */
import Dexie, { type Table } from "dexie";

import type { RouterInputs } from "~/trpc/react";
import type { Checkpoint } from "~/lib/recorder/checkpoint";

/** The exact, validated input tRPC expects -- we queue this verbatim so the sync is a pure replay. */
export type PaddleInput = RouterInputs["paddles"]["create"];
export type PoiInput = RouterInputs["pois"]["create"];

/** A POI stored with a downloaded trip: enough to draw + order it along the corridor offline. */
export interface StoredPoi {
  id: string;
  category: string;
  note: string | null;
  lng: number;
  lat: number;
  routeDistM: number;
  creatorName: string | null;
  createdAt: string; // ISO -- Dexie/structured-clone keeps Dates, but ISO is safe across reloads
}

/** The full route JSON captured at download time so route detail + nav render with zero network. */
export interface StoredRoute {
  id: string;
  name: string;
  type: "river" | "waypoint";
  shape: "one_way" | "out_and_back";
  distanceM: number;
  /** Outbound line, [lng,lat] pairs. */
  coords: Array<[number, number]>;
}

/** One downloaded trip: its route, corridor POIs, and tile-set accounting. Keyed by routeId. */
export interface TripRecord {
  routeId: string;
  route: StoredRoute;
  pois: StoredPoi[];
  downloadedAt: number;
  tileCount: number;
  bytes: number;
}

/** One cached vector tile. `routeIds` refcounts which downloaded trips need it (empty = misc/LRU). */
export interface TileRecord {
  /** "z/x/y" */
  key: string;
  bytes: ArrayBuffer;
  size: number;
  routeIds: string[];
  lastAccess: number;
}

/** A cached PMTiles byte-range (header / directory), keyed by "offset-length". Enables offline reads. */
export interface PmtilesMetaRecord {
  key: string;
  data: ArrayBuffer;
  etag?: string;
}

/** A paddle waiting to reach the server. `deadLetter` is set on a permanent (4xx) failure. */
export interface PendingPaddle {
  id: string;
  input: PaddleInput;
  createdAt: number;
  deadLetter?: string;
}

export interface PendingPoi {
  id: string;
  input: PoiInput;
  createdAt: number;
  deadLetter?: string;
}

/** The live recorder checkpoint, keyed by the sentinel "current". */
export interface ActiveSessionRecord {
  key: "current";
  checkpoint: Checkpoint;
}

export class PaddlePrintsDB extends Dexie {
  trips!: Table<TripRecord, string>;
  tiles!: Table<TileRecord, string>;
  pmtilesMeta!: Table<PmtilesMetaRecord, string>;
  pendingPaddles!: Table<PendingPaddle, string>;
  pendingPois!: Table<PendingPoi, string>;
  activeSession!: Table<ActiveSessionRecord, string>;

  constructor() {
    super("paddle-prints");
    this.version(1).stores({
      // Only indexed fields are listed. `bytes`/`data`/`input` blobs live in the record, un-indexed.
      trips: "routeId, downloadedAt",
      tiles: "key, lastAccess, *routeIds",
      pmtilesMeta: "key",
      pendingPaddles: "id, createdAt",
      pendingPois: "id, createdAt",
      activeSession: "key",
    });
  }
}

let _db: PaddlePrintsDB | null = null;

/**
 * The shared DB handle. Lazily constructed so that importing this module (e.g. in a server component
 * bundle or a test that hasn't installed fake-indexeddb yet) never touches indexedDB at import time.
 */
export function db(): PaddlePrintsDB {
  _db ??= new PaddlePrintsDB();
  return _db;
}

/** Test seam: drop the cached handle so a fresh fake-indexeddb can be wired up between test cases. */
export function __resetDbForTests(): void {
  _db = null;
}
