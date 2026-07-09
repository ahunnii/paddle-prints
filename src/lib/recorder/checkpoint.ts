/**
 * Crash-recovery checkpointing. The recorder serialises its full state (plus the route context and
 * progress-match cursor) to localStorage every 15 s and on visibilitychange, so a phone that sleeps,
 * reloads, or gets backgrounded mid-paddle can offer to resume.
 *
 * The store is deliberately behind a narrow interface: Phase 6 swaps localStorage for Dexie/IndexedDB
 * and only `checkpointStore` changes.
 */
import type { MatchState } from "./progress";
import type { RecorderState, TripType } from "./types";

const KEY = "paddle-prints:recorder:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // a checkpoint older than a day is not a live paddle

export interface Checkpoint {
  version: 1;
  routeId: string | null;
  tripType: TripType;
  machine: RecorderState;
  progress: MatchState | null;
  savedAt: number;
}

export interface CheckpointStore {
  save(cp: Checkpoint): void;
  load(): Checkpoint | null;
  clear(): void;
}

/** localStorage-backed store. No-ops gracefully when localStorage is unavailable (SSR, private mode). */
export const checkpointStore: CheckpointStore = {
  save(cp) {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(cp));
    } catch {
      /* quota / unavailable -- a lost checkpoint is not fatal */
    }
  },
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      if (!raw) return null;
      const cp = JSON.parse(raw) as Checkpoint;
      if (cp?.version !== 1 || typeof cp.savedAt !== "number") return null;
      return cp;
    } catch {
      return null;
    }
  },
  clear() {
    try {
      globalThis.localStorage?.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

/** True if the checkpoint represents a paddle recent enough to resume (< 24 h old) and unfinished. */
export function isLiveCheckpoint(cp: Checkpoint | null, now = Date.now()): boolean {
  if (!cp) return false;
  if (now - cp.savedAt > MAX_AGE_MS) return false;
  return cp.machine.status !== "finished" && cp.machine.status !== "idle";
}
