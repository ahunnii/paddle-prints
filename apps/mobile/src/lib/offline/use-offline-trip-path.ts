/**
 * Resolve a route's downloaded offline-tiles path once, on mount. Returns the archive's `file://`
 * URI if the trip has been downloaded (and its file is present), else undefined. Reads are synchronous
 * (SQLite index + a filesystem existence check), so a lazy `useState` initializer resolves it without
 * an effect or a loading flash — the nav map either mounts offline-capable or it doesn't.
 */
import { useState } from "react";

import { getOfflineTripPath } from "./trips";

export function useOfflineTripPath(
  routeId: string | null | undefined,
): string | undefined {
  const [path] = useState<string | undefined>(() =>
    routeId ? (getOfflineTripPath(routeId) ?? undefined) : undefined,
  );
  return path;
}
