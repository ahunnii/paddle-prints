/**
 * Sync triggers: the "when do we drain the queue?" side of the offline layer, the mobile analogue of
 * web's OfflineBootstrap (apps/web/src/components/offline/offline-layer.tsx), which drains on load /
 * "online" / visibilitychange. Here the three moments are:
 *   (a) app launch          -- registerSyncTriggers() kicks an immediate drain
 *   (b) foreground          -- AppState "change" -> "active"
 *   (c) network regain      -- expo-network addNetworkStateListener, when isConnected flips true
 *
 * Everything here is best-effort and MUST NOT crash the app: syncQueue rejections are swallowed, and
 * the whole registration is idempotent (a module-level guard) so re-mounting the provider can't stack
 * duplicate listeners. The core queue's own per-instance latch means overlapping triggers still send
 * each row exactly once.
 *
 * expo-network API verified against node_modules/expo-network types (v57):
 *   addNetworkStateListener((event: NetworkState) => void): EventSubscription  // event.isConnected
 */
import { AppState, type AppStateStatus } from "react-native";
import { addNetworkStateListener } from "expo-network";

import { syncQueue, type SyncResult } from "./sync";

let registered = false;
let onSynced: ((result: SyncResult) => void) | null = null;

/** Drain once; swallow every error so a failed sync never propagates to the app. Notifies on sent>0. */
async function drain(): Promise<void> {
  try {
    const result = await syncQueue();
    if (result.sent > 0) onSynced?.(result);
  } catch {
    // Network failures are the normal offline case -- the rows stay queued and retry on the next
    // trigger. Nothing to surface here.
  }
}

/**
 * Register the app-lifetime sync triggers exactly once and kick an immediate launch drain. Safe to
 * call from a provider effect on every mount: the guard makes repeat calls only refresh the
 * `onSynced` callback (so the latest QueryClient's invalidation is used) without re-adding listeners.
 * Returns an unregister fn for the effect's cleanup; the guard is intentionally NOT reset by it in
 * normal operation, but the returned teardown removes the native subscriptions if ever needed.
 */
export function registerSyncTriggers(opts?: {
  onSynced?: (result: SyncResult) => void;
}): () => void {
  onSynced = opts?.onSynced ?? null;

  if (registered) return () => undefined;
  registered = true;

  // (a) Launch: drain anything left from a previous session immediately.
  void drain();

  // (b) Foreground: a paddle finished offline then the phone reconnected in the user's pocket -- the
  // moment they reopen the app, flush.
  const appStateSub = AppState.addEventListener(
    "change",
    (state: AppStateStatus) => {
      if (state === "active") void drain();
    },
  );

  // (c) Network regain: fires the instant connectivity returns, even with the app already foregrounded.
  const netSub = addNetworkStateListener((event) => {
    if (event.isConnected) void drain();
  });

  return () => {
    appStateSub.remove();
    netSub.remove();
    registered = false;
  };
}
