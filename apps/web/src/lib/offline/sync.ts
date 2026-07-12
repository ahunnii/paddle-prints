/**
 * Web platform binding for the outbound sync queue. The state machine itself lives in
 * `@paddle-prints/offline-core/sync` (platform-free, unit-tested); this module wires it to the two
 * Dexie tables, the vanilla tRPC client, and the browser's crypto.randomUUID, then re-exports the
 * bound functions so existing consumers import from "~/lib/offline/sync" unchanged.
 *
 * The server mutations are idempotent by client uuid, so a re-send after a dropped success response
 * can never duplicate -- syncQueue is safe to fire as often as we like.
 */
import {
  createSyncQueue,
  type QueueStore,
  type PendingRow,
} from "@paddle-prints/offline-core/sync";

import { db, type PaddleInput, type PoiInput } from "./db";
import { trpcVanilla } from "./trpc-vanilla";

export type { SyncDeps, SyncResult } from "@paddle-prints/offline-core/sync";

/** Wrap a Dexie pending-queue table as the generic QueueStore the core drains. db() is lazy. */
function dexieStore<TInput extends { id: string }>(
  table: () => {
    put(row: PendingRow<TInput>): Promise<unknown>;
    get(id: string): Promise<PendingRow<TInput> | undefined>;
    delete(id: string): Promise<unknown>;
    update(id: string, changes: { deadLetter: string }): Promise<unknown>;
    toArray(): Promise<PendingRow<TInput>[]>;
  },
): QueueStore<PendingRow<TInput>> {
  return {
    put: (row) => table().put(row),
    get: (id) => table().get(id),
    delete: (id) => table().delete(id),
    update: (id, changes) => table().update(id, changes),
    toArray: () => table().toArray(),
  };
}

const queue = createSyncQueue<PaddleInput, PoiInput>({
  storage: {
    pendingPaddles: dexieStore<PaddleInput>(() => db().pendingPaddles),
    pendingPois: dexieStore<PoiInput>(() => db().pendingPois),
  },
  deps: {
    sendPaddle: (input) => trpcVanilla.paddles.create.mutate(input),
    sendPoi: (input) => trpcVanilla.pois.create.mutate(input),
  },
  randomUUID: () => crypto.randomUUID(),
});

export const queuePaddle = queue.queuePaddle;
export const queuePoi = queue.queuePoi;
export const savePoiQueued = queue.savePoiQueued;
export const syncQueue = queue.syncQueue;
export const pendingCounts = queue.pendingCounts;
