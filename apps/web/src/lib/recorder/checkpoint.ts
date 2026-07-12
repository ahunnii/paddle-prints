/**
 * Crash-recovery checkpointing. The recorder serialises its full state (plus the route context and
 * progress-match cursor) so a phone that sleeps, reloads, or gets backgrounded mid-paddle can offer
 * to resume.
 *
 * Phase 6: the durable store moved from localStorage to the Dexie `activeSession` store (survives the
 * same reloads, but lives alongside the rest of the offline data and isn't at risk of a 5 MB
 * localStorage cap). Dexie is async while the recorder writes checkpoints synchronously from a hot
 * loop, so this keeps a synchronous in-memory shadow: `save`/`clear` update the shadow immediately
 * and write to IndexedDB fire-and-forget; `load` reads the shadow; and the async `hydrate()` (called
 * once on mount) pulls the last persisted checkpoint back into the shadow after a reload.
 */
import { db } from "../offline/db";
import type { MatchState } from "@paddle-prints/recorder-core/progress";
import type { RecorderState, TripType } from "@paddle-prints/recorder-core/types";

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // a checkpoint older than a day is not a live paddle

export interface Checkpoint {
  version: 1;
  routeId: string | null;
  tripType: TripType;
  machine: RecorderState;
  progress: MatchState | null;
  /** Free-text trip note. Optional so pre-`note` checkpoints still restore (hydrated as ""). */
  note?: string;
  savedAt: number;
}

export interface CheckpointStore {
  save(cp: Checkpoint): void;
  load(): Checkpoint | null;
  clear(): void;
  /** Async: reload the persisted checkpoint from IndexedDB into the sync shadow. Call once on mount. */
  hydrate(): Promise<Checkpoint | null>;
}

/** Synchronous view of the current checkpoint; the durable copy lives in Dexie `activeSession`. */
let shadow: Checkpoint | null = null;

export const checkpointStore: CheckpointStore = {
  save(cp) {
    shadow = cp;
    try {
      void db()
        .activeSession.put({ key: "current", checkpoint: cp })
        .catch(() => undefined);
    } catch {
      /* IndexedDB unavailable (SSR / tests) -- the shadow still round-trips this session */
    }
  },
  load() {
    return shadow;
  },
  clear() {
    shadow = null;
    try {
      void db().activeSession.delete("current").catch(() => undefined);
    } catch {
      /* ignore */
    }
  },
  async hydrate() {
    try {
      const row = await db().activeSession.get("current");
      shadow = row?.checkpoint ?? null;
    } catch {
      shadow = null;
    }
    return shadow;
  },
};

/** True if the checkpoint represents a paddle recent enough to resume (< 24 h old) and unfinished. */
export function isLiveCheckpoint(cp: Checkpoint | null, now = Date.now()): boolean {
  if (!cp) return false;
  if (now - cp.savedAt > MAX_AGE_MS) return false;
  return cp.machine.status !== "finished" && cp.machine.status !== "idle";
}
