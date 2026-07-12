/**
 * Location-permission gating for the recorder. Exposed as a single `ensureRecorderPermissions()` the
 * UI (a later screens task) calls before `useRecorder.start()`.
 *
 * WHAT THE INSTALLED expo-location REQUIRES (verified against node_modules, not guessed):
 *  - The JS `startLocationUpdatesAsync` only runs `_validate(taskName)` -- it asserts the task name is
 *    a non-empty string and warns in Expo Go. It performs NO permission check in JS; enforcement is
 *    entirely native.
 *  - Native background delivery on iOS is unlocked by the `UIBackgroundModes: ["location"]` entry that
 *    the `expo-location` config plugin adds when `isIosBackgroundLocationEnabled: true` -- which
 *    `apps/mobile/app.config.ts` already sets. With that background mode present, iOS keeps delivering
 *    updates to a running app under "When In Use" authorization; a separate "Always" (background)
 *    grant is NOT required to record. (On the iOS simulator we only ever grant When In Use, and that
 *    is sufficient.)
 *  - On Android, `isAndroidForegroundServiceEnabled: true` (also already set) plus the foreground
 *    service we start means `ACCESS_FINE_LOCATION` (a foreground grant) is enough;
 *    `ACCESS_BACKGROUND_LOCATION` is not needed while a foreground service is running.
 *
 * Conclusion: recording works with foreground/When-In-Use permission on both platforms with this
 * config, so we only request foreground here. `needsBackground` stays in the result union for a future
 * config that drops the background mode, but is never returned today.
 */
import * as Location from "expo-location";

export type RecorderPermissionResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "needsBackground" | "servicesDisabled" };

export async function ensureRecorderPermissions(): Promise<RecorderPermissionResult> {
  // Location services (the OS-level toggle) must be on -- otherwise even a granted permission yields
  // no fixes.
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return { ok: false, reason: "servicesDisabled" };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return { ok: false, reason: "denied" };

  return { ok: true };
}
