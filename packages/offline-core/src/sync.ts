/**
 * The outbound sync queue -- platform-free core. Finished paddles and quick-add POIs are written to a
 * durable queue first (queuePaddle/queuePoi) and drained to the server by syncQueue() whenever
 * connectivity allows. The server mutations are idempotent by client uuid, so a re-send after a
 * dropped success response can never duplicate -- syncQueue is safe to fire as often as we like.
 *
 * The send loop is a small, testable state machine:
 *   success        -> delete the row (done)
 *   network/5xx    -> leave the row (retry next time)
 *   4xx validation -> flag the row dead-lettered (stop retrying; surface the count in the UI)
 * A per-instance promise latch guarantees only one drain runs at a time.
 *
 * This module is generic over the paddle/POI input payloads and platform-agnostic: storage (the two
 * queues), the network deps, and the uuid source are all injected via createSyncQueue. The web and
 * mobile apps bind their own IndexedDB / SQLite queues and tRPC clients on top of it. It must NOT
 * import any platform or app package -- generics only.
 */

/** A queued row awaiting delivery. `deadLetter` is set on a permanent (4xx) failure. */
export interface PendingRow<TInput> {
  id: string;
  input: TInput;
  createdAt: number;
  deadLetter?: string;
}

/**
 * The five storage operations the drain needs from each queue. `update` is only ever called with
 * `{ deadLetter }`. A platform binds this over its own durable store (Dexie table, SQLite, ...).
 */
export interface QueueStore<Row> {
  put(row: Row): Promise<unknown>;
  get(id: string): Promise<Row | undefined>;
  delete(id: string): Promise<unknown>;
  update(id: string, changes: { deadLetter: string }): Promise<unknown>;
  toArray(): Promise<Row[]>;
}

/** The two durable queues the sync engine drains, in drain order (paddles then pois). */
export interface SyncStorage<TPaddleInput, TPoiInput> {
  pendingPaddles: QueueStore<PendingRow<TPaddleInput>>;
  pendingPois: QueueStore<PendingRow<TPoiInput>>;
}

/** The network seam: how a row's input reaches the server. Idempotent on the client uuid. */
export interface SyncDeps<TPaddleInput, TPoiInput> {
  sendPaddle: (input: TPaddleInput) => Promise<unknown>;
  sendPoi: (input: TPoiInput) => Promise<unknown>;
}

export interface SyncResult {
  sent: number;
  retained: number;
  deadLettered: number;
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

/** The public surface of one bound sync queue instance. */
export interface SyncQueue<TPaddleInput, TPoiInput> {
  queuePaddle: (input: TPaddleInput) => Promise<void>;
  queuePoi: (input: TPoiInput) => Promise<void>;
  savePoiQueued: (input: Omit<TPoiInput, "id">) => Promise<"synced" | "queued">;
  syncQueue: (deps?: SyncDeps<TPaddleInput, TPoiInput>) => Promise<SyncResult>;
  pendingCounts: () => Promise<{ paddles: number; pois: number; deadLettered: number }>;
}

/**
 * Build a sync queue bound to a platform's storage, network deps, and uuid source. The concurrency
 * latch lives per returned instance, so each app has exactly one in-flight drain shared across its
 * overlapping callers (app-start + "online" + visibilitychange).
 */
export function createSyncQueue<
  TPaddleInput extends { id: string },
  TPoiInput extends { id: string },
>(config: {
  storage: SyncStorage<TPaddleInput, TPoiInput>;
  deps: SyncDeps<TPaddleInput, TPoiInput>;
  randomUUID: () => string;
}): SyncQueue<TPaddleInput, TPoiInput> {
  const { storage, deps: defaultDeps, randomUUID } = config;

  /** Enqueue a finished paddle for delivery. Idempotent on the client uuid. */
  async function queuePaddle(input: TPaddleInput): Promise<void> {
    await storage.pendingPaddles.put({ id: input.id, input, createdAt: Date.now() });
  }

  /** Enqueue a POI for delivery. Idempotent on the client uuid. */
  async function queuePoi(input: TPoiInput): Promise<void> {
    await storage.pendingPois.put({ id: input.id, input, createdAt: Date.now() });
  }

  /**
   * Queue a new POI and immediately try to drain it, so the "Add spot" flow can pick the right toast
   * copy ("Spot saved" vs "Saved offline"). Shared by the community map and the nav map -- one queue
   * path, offline-capable everywhere; the server already dedupes by client uuid so a retried send
   * after a dropped success response can never duplicate.
   */
  async function savePoiQueued(input: Omit<TPoiInput, "id">): Promise<"synced" | "queued"> {
    const id = randomUUID();
    await queuePoi({ id, ...input } as TPoiInput);
    await syncQueue();
    return (await storage.pendingPois.get(id)) ? "queued" : "synced";
  }

  let running: Promise<SyncResult> | null = null;

  /**
   * Drain the pending queues to the server. Concurrency-safe: overlapping callers share the one
   * in-flight drain (the latch), so app-start + "online" + visibilitychange firing together still
   * sends each row exactly once.
   */
  function syncQueue(deps: SyncDeps<TPaddleInput, TPoiInput> = defaultDeps): Promise<SyncResult> {
    running ??= drain(deps).finally(() => {
      running = null;
    });
    return running;
  }

  async function drain(deps: SyncDeps<TPaddleInput, TPoiInput>): Promise<SyncResult> {
    const result: SyncResult = { sent: 0, retained: 0, deadLettered: 0 };

    const paddleRows = await storage.pendingPaddles.toArray();
    for (const row of paddleRows) {
      if (row.deadLetter) continue;
      try {
        await deps.sendPaddle(row.input);
        await storage.pendingPaddles.delete(row.id);
        result.sent++;
      } catch (err) {
        if (isPermanent(err)) {
          await storage.pendingPaddles.update(row.id, { deadLetter: message(err) });
          result.deadLettered++;
        } else {
          result.retained++;
        }
      }
    }

    const poiRows = await storage.pendingPois.toArray();
    for (const row of poiRows) {
      if (row.deadLetter) continue;
      try {
        await deps.sendPoi(row.input);
        await storage.pendingPois.delete(row.id);
        result.sent++;
      } catch (err) {
        if (isPermanent(err)) {
          await storage.pendingPois.update(row.id, { deadLetter: message(err) });
          result.deadLettered++;
        } else {
          result.retained++;
        }
      }
    }

    return result;
  }

  /** Snapshot of what's still queued -- for one-off reads (the reactive version is useLiveQuery). */
  async function pendingCounts(): Promise<{
    paddles: number;
    pois: number;
    deadLettered: number;
  }> {
    const [paddles, pois] = await Promise.all([
      storage.pendingPaddles.toArray(),
      storage.pendingPois.toArray(),
    ]);
    const deadLettered =
      paddles.filter((p) => p.deadLetter).length +
      pois.filter((p) => p.deadLetter).length;
    return { paddles: paddles.length, pois: pois.length, deadLettered };
  }

  return { queuePaddle, queuePoi, savePoiQueued, syncQueue, pendingCounts };
}
