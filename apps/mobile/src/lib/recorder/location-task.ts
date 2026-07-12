/**
 * The background location task. This is the RN replacement for the web recorder's
 * `navigator.geolocation.watchPosition`: a single `expo-task-manager` task, defined at MODULE scope so
 * it survives the app being backgrounded or the JS context being restarted by the OS. `expo-location`
 * routes every batch of fixes (foreground AND background) through here.
 *
 * This file MUST NOT import the store or any UI: the OS may execute the task in a fresh JS context
 * where React never mounted. Instead the store registers plain callbacks via
 * `registerRecorderHandlers`, and the task forwards raw locations to them. When no handler is
 * registered (e.g. task fired after a cold restart with nothing recording) the fixes are simply
 * dropped.
 *
 * iOS delivers batched locations in the background and does not guarantee order, so we sort each batch
 * by timestamp ascending before forwarding -- the reducer's time-accounting and teleport gates assume
 * monotonically non-decreasing `t`.
 */
import * as TaskManager from "expo-task-manager";
import type { LocationObject } from "expo-location";

/** Name the background location task is registered under. Shared with the store's arm()/teardown(). */
export const RECORDER_TASK = "paddle-prints-recorder";

type FixHandler = (location: LocationObject) => void;
type ErrorHandler = (error: TaskManager.TaskManagerError) => void;

let fixHandler: FixHandler | null = null;
let errorHandler: ErrorHandler | null = null;

/**
 * The store calls this in arm() to receive fixes/errors, and again with `null`s in teardown() to
 * unhook. Keeping the wiring here (not in the store) means the module-scope task never imports the
 * store.
 */
export function registerRecorderHandlers(
  onFix: FixHandler | null,
  onError: ErrorHandler | null,
): void {
  fixHandler = onFix;
  errorHandler = onError;
}

interface LocationTaskData {
  locations: LocationObject[];
}

// The executor is declared async only because expo-task-manager's `TaskManagerTaskExecutor` type
// requires a `Promise<any>` return; the body itself is synchronous.
TaskManager.defineTask<LocationTaskData>(RECORDER_TASK, async ({ data, error }) => {
  if (error) {
    errorHandler?.(error);
    return;
  }
  const handler = fixHandler;
  if (!handler || !data?.locations?.length) return;

  // Process in timestamp order -- background batches from iOS are not guaranteed sorted.
  const ordered = [...data.locations].sort((a, b) => a.timestamp - b.timestamp);
  for (const loc of ordered) handler(loc);
});
