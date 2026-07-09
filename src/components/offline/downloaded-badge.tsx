"use client";

import { useIsDownloaded } from "~/lib/offline/use-offline";

/** A small "Offline ✓" pill shown on a route card when that route is downloaded. */
export function DownloadedBadge({ routeId }: { routeId: string }) {
  const downloaded = useIsDownloaded(routeId);
  if (!downloaded) return null;
  return (
    <span className="rounded-full bg-river-100 px-2 py-0.5 text-xs font-bold text-river-700">
      ⤓ Offline
    </span>
  );
}
