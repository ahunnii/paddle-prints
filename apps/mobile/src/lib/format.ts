/**
 * Shared formatting helpers for paddle stats. Mirrors the rounding/unit choices used on the web
 * app (apps/web/src/components/feed/feed-list.tsx and apps/web/src/components/me/me-client.tsx),
 * except duration, which the mobile feed renders as "1h 23m" / "23m" instead of "1:23" / "23 min".
 */

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

/** e.g. "3.4 mi" */
export function formatDistanceMi(distanceM: number): string {
  return `${(distanceM / METERS_PER_MILE).toFixed(1)} mi`;
}

/** e.g. "7.2 mph" */
export function formatSpeedMph(avgSpeedMps: number): string {
  return `${(avgSpeedMps * MPS_TO_MPH).toFixed(1)} mph`;
}

/** e.g. "1h 23m" or "23m" */
export function formatDuration(elapsedS: number): string {
  const s = Math.max(0, Math.floor(elapsedS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** e.g. "Jul 5, 3:41 PM" */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** e.g. "1:23:45" (h:mm:ss) once past an hour, else "23:45" (m:ss). Used for the live-recording
 * elapsed/moving clocks (record.tsx), which want a stopwatch look rather than formatDuration's
 * "1h 23m" unit-label style. */
export function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** e.g. "3:41 PM" -- used for the live ETA-arrival clock (record.tsx). */
export function formatTimeOfDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
