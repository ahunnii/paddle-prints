/**
 * Mobile platform binding for the outbound sync queue. The send state machine itself lives in
 * `@paddle-prints/offline-core/sync` (platform-free, unit-tested); this module wires it to the
 * SQLite-backed queue store (./storage), the vanilla tRPC client, and expo-crypto's randomUUID, then
 * re-exports the bound functions -- the direct analogue of apps/web/src/lib/offline/sync.ts.
 *
 * The server mutations are idempotent by client uuid, so a re-send after a dropped success response
 * can never duplicate -- syncQueue is safe to fire as often as we like (app launch, foreground,
 * network regain all call it).
 */
import { createSyncQueue } from "@paddle-prints/offline-core/sync";

import type { RouterInputs } from "../trpc";
import { trpcVanilla } from "../trpc-vanilla";
import { getRandomUUID } from "../uuid";
import { sqliteStore } from "./storage";

export type { SyncDeps, SyncResult, PendingRow } from "@paddle-prints/offline-core/sync";

/** The exact, validated inputs tRPC expects -- we queue these verbatim so a sync is a pure replay. */
export type PaddleInput = RouterInputs["paddles"]["create"];
export type PoiInput = RouterInputs["pois"]["create"];

/**
 * The two durable queue stores, exported so screens can read them directly (feed pending-merge, map
 * pending-merge, the /me dead-letter list + discard) exactly like web reads `db().pendingPaddles`.
 */
export const pendingPaddleStore = sqliteStore<PaddleInput>("paddle");
export const pendingPoiStore = sqliteStore<PoiInput>("poi");

const queue = createSyncQueue<PaddleInput, PoiInput>({
  storage: {
    pendingPaddles: pendingPaddleStore,
    pendingPois: pendingPoiStore,
  },
  deps: {
    sendPaddle: (input) => trpcVanilla.paddles.create.mutate(input),
    sendPoi: (input) => trpcVanilla.pois.create.mutate(input),
  },
  randomUUID: getRandomUUID,
});

export const queuePaddle = queue.queuePaddle;
export const queuePoi = queue.queuePoi;
export const savePoiQueued = queue.savePoiQueued;
export const syncQueue = queue.syncQueue;
export const pendingCounts = queue.pendingCounts;
