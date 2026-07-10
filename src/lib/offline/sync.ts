/**
 * The outbound sync queue. Finished paddles and quick-add POIs are written to IndexedDB first
 * (queuePaddle/queuePoi) and drained to the server by syncQueue() whenever connectivity allows. The
 * server mutations are idempotent by client uuid, so a re-send after a dropped success response can
 * never duplicate -- syncQueue is safe to fire as often as we like.
 *
 * The send loop is a small, testable state machine:
 *   success        -> delete the row (done)
 *   network/5xx    -> leave the row (retry next time)
 *   4xx validation -> flag the row dead-lettered (stop retrying; surface the count in the UI)
 * A module-level promise latch guarantees only one drain runs at a time.
 */
import { db, type PaddleInput, type PoiInput } from "./db";
import { trpcVanilla } from "./trpc-vanilla";

export interface SyncDeps {
  sendPaddle: (input: PaddleInput) => Promise<unknown>;
  sendPoi: (input: PoiInput) => Promise<unknown>;
}

export interface SyncResult {
  sent: number;
  retained: number;
  deadLettered: number;
}

const defaultDeps: SyncDeps = {
  sendPaddle: (input) => trpcVanilla.paddles.create.mutate(input),
  sendPoi: (input) => trpcVanilla.pois.create.mutate(input),
};

/** Enqueue a finished paddle for delivery. Idempotent on the client uuid. */
export async function queuePaddle(input: PaddleInput): Promise<void> {
  await db().pendingPaddles.put({ id: input.id, input, createdAt: Date.now() });
}

/** Enqueue a POI for delivery. Idempotent on the client uuid. */
export async function queuePoi(input: PoiInput): Promise<void> {
  await db().pendingPois.put({ id: input.id, input, createdAt: Date.now() });
}

/**
 * Queue a new POI and immediately try to drain it, so the "Add spot" flow can pick the right toast
 * copy ("Spot saved" vs "Saved offline"). Shared by the community map and the nav map -- one queue
 * path, offline-capable everywhere; the server already dedupes by client uuid so a retried send
 * after a dropped success response can never duplicate.
 */
export async function savePoiQueued(input: Omit<PoiInput, "id">): Promise<"synced" | "queued"> {
  const id = crypto.randomUUID();
  await queuePoi({ id, ...input });
  await syncQueue();
  return (await db().pendingPois.get(id)) ? "queued" : "synced";
}

/** Extract an HTTP status from a tRPC client error, if it carried one. */
function httpStatus(err: unknown): number | undefined {
  const data = (err as { data?: { httpStatus?: number } })?.data;
  return typeof data?.httpStatus === "number" ? data.httpStatus : undefined;
}

/** A 4xx is a permanent validation/authorization failure -- retrying will never succeed. */
function isPermanent(err: unknown): boolean {
  const s = httpStatus(err);
  return s !== undefined && s >= 400 && s < 500;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let running: Promise<SyncResult> | null = null;

/**
 * Drain the pending queues to the server. Concurrency-safe: overlapping callers share the one
 * in-flight drain (the latch), so app-start + "online" + visibilitychange firing together still
 * sends each row exactly once.
 */
export function syncQueue(deps: SyncDeps = defaultDeps): Promise<SyncResult> {
  running ??= drain(deps).finally(() => {
    running = null;
  });
  return running;
}

async function drain(deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, retained: 0, deadLettered: 0 };

  const paddleRows = await db().pendingPaddles.toArray();
  for (const row of paddleRows) {
    if (row.deadLetter) continue;
    try {
      await deps.sendPaddle(row.input);
      await db().pendingPaddles.delete(row.id);
      result.sent++;
    } catch (err) {
      if (isPermanent(err)) {
        await db().pendingPaddles.update(row.id, { deadLetter: message(err) });
        result.deadLettered++;
      } else {
        result.retained++;
      }
    }
  }

  const poiRows = await db().pendingPois.toArray();
  for (const row of poiRows) {
    if (row.deadLetter) continue;
    try {
      await deps.sendPoi(row.input);
      await db().pendingPois.delete(row.id);
      result.sent++;
    } catch (err) {
      if (isPermanent(err)) {
        await db().pendingPois.update(row.id, { deadLetter: message(err) });
        result.deadLettered++;
      } else {
        result.retained++;
      }
    }
  }

  return result;
}

/** Snapshot of what's still queued -- for one-off reads (the reactive version is useLiveQuery). */
export async function pendingCounts(): Promise<{
  paddles: number;
  pois: number;
  deadLettered: number;
}> {
  const [paddles, pois] = await Promise.all([
    db().pendingPaddles.toArray(),
    db().pendingPois.toArray(),
  ]);
  const deadLettered =
    paddles.filter((p) => p.deadLetter).length +
    pois.filter((p) => p.deadLetter).length;
  return { paddles: paddles.length, pois: pois.length, deadLettered };
}
