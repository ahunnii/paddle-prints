"use client";

import { useEffect, useState } from "react";
import type { LngLatLike } from "maplibre-gl";

import { MICHIGAN_CENTER } from "~/components/map/base-map";

/**
 * One-shot geolocation lookup for a map's initial view. Starts at the Michigan-wide default (the
 * same constant `BaseMap` itself falls back to) and, if the browser grants a fix, swaps to the
 * user's real position. `resolved` flips to `true` once the lookup has settled either way (fix,
 * denial, or timeout) so callers know it's safe to stop waiting.
 *
 * Deliberately returns only `{ center, resolved }`: on permission-denied/timeout `center` stays the
 * exact `MICHIGAN_CENTER` reference (never reassigned), so a caller that wants to distinguish "got a
 * real fix" from "fell back" can compare `center !== MICHIGAN_CENTER`.
 */
export function useInitialCenter(): { center: LngLatLike; resolved: boolean } {
  const [center, setCenter] = useState<LngLatLike>(MICHIGAN_CENTER);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setResolved(true);
      return;
    }

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setCenter([pos.coords.longitude, pos.coords.latitude]);
        setResolved(true);
      },
      () => {
        // Permission denied, position unavailable, or timed out -- fall back silently to Michigan.
        if (cancelled) return;
        setResolved(true);
      },
      { timeout: 3000, maximumAge: 300000 },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return { center, resolved };
}
