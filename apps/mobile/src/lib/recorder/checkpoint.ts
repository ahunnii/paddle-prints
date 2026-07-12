/**
 * Crash-recovery checkpointing for the native recorder. The recorder serialises its full state (plus
 * the route context and progress-match cursor) so a phone that sleeps, backgrounds, or gets killed
 * mid-paddle can offer to resume.
 *
 * Storage: `expo-sqlite/kv-store`. Unlike the web build (Dexie, async, so it kept a sync in-memory
 * shadow and hydrated on mount), kv-store exposes SYNCHRONOUS SQLite-backed methods
 * (`getItemSync`/`setItemSync`/`removeItemSync`). The recorder writes checkpoints synchronously from a
 * hot loop, so we read/write directly through those -- no shadow, no `hydrate()` step needed. The
 * value is stored as a JSON string under the single key "current".
 */
import Storage from "expo-sqlite/kv-store";

import type { MatchState } from "@paddle-prints/recorder-core/progress";
import type { RecorderState, TripType } from "@paddle-prints/recorder-core/types";

const KEY = "current";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // a checkpoint older than a day is not a live paddle

export interface Checkpoint {
  version: 1;
  routeId: string | null;
  tripType: TripType;
  machine: RecorderState;
  /** NOTE: named `progress` but holds the progress-MATCH cursor (MatchState), not a ProgressResult. */
  progress: MatchState | null;
  /** Free-text trip note. Optional so pre-`note` checkpoints still restore (hydrated as ""). */
  note?: string;
  savedAt: number;
}

export interface CheckpointStore {
  save(cp: Checkpoint): void;
  load(): Checkpoint | null;
  clear(): void;
}

export const checkpointStore: CheckpointStore = {
  save(cp) {
    try {
      Storage.setItemSync(KEY, JSON.stringify(cp));
    } catch {
      /* Storage unavailable (should not happen on device) -- a lost checkpoint just means no resume. */
    }
  },
  load() {
    try {
      const raw = Storage.getItemSync(KEY);
      return raw ? (JSON.parse(raw) as Checkpoint) : null;
    } catch {
      return null;
    }
  },
  clear() {
    try {
      Storage.removeItemSync(KEY);
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
