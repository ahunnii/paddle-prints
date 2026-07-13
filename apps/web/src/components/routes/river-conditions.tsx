"use client";

/**
 * Live USGS gauge conditions for a route's river, shown inside the Flow card on route detail
 * (apps/web/src/app/routes/[id]/page.tsx). Renders nothing while there's genuinely nothing to show:
 * `rivers.conditions` resolves `null` for a lake/waypoint route, a river with no nearby gauge, AND a
 * failed upstream USGS fetch alike -- there's no way (and no need) to tell those apart here. Mirrors
 * the mobile equivalent inlined in apps/mobile/src/app/(app)/routes/[id].tsx (RiverConditionsLine).
 */
import { api } from "~/trpc/react";

/** e.g. "5 min ago", "2 hr ago", "3 days ago". */
function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function RiverConditions({ routeId }: { routeId: string }) {
  const { data, isPending } = api.rivers.conditions.useQuery(
    { routeId },
    { staleTime: 10 * 60_000 },
  );

  if (isPending) {
    return <div className="bg-river-100 h-4 w-2/3 animate-pulse rounded" />;
  }

  if (!data) return null;

  return (
    <p className="text-river-600 text-xs">
      🌊 {data.siteName} ·{" "}
      {data.dischargeCfs != null ? `${data.dischargeCfs} cfs` : "cfs —"} ·{" "}
      {data.gaugeHeightFt != null ? `${data.gaugeHeightFt} ft` : "ft —"} · as of{" "}
      {formatRelativeTime(data.observedAt)} · gauge {data.distanceKm.toFixed(1)} km away
    </p>
  );
}
