"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

import { createBoardMarkerEl } from "~/lib/map/board-marker-el";
import { api } from "~/trpc/react";

interface PresenceLayerProps {
  map: MapLibreMap | null;
  /** The signed-in user's own id, so their own heartbeat row never renders a marker for them. */
  selfId: string;
}

/**
 * Renders everyone else's live position (heartbeat within the last 5 minutes, per the server
 * query) as a board-icon marker with a name pill. No popups for v1 -- just presence at a glance.
 */
export function PresenceLayer({ map, selfId }: PresenceLayerProps) {
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const { data } = api.presence.list.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!map) return;

    const rows = (data ?? []).filter((row) => row.userId !== selfId);

    const seen = new Set(rows.map((row) => row.userId));
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const row of rows) {
      const lng = row.geom.coordinates[0]!;
      const lat = row.geom.coordinates[1]!;
      const existing = markersRef.current.get(row.userId);
      if (existing) {
        existing.setLngLat([lng, lat]);
        continue;
      }

      const el = createBoardMarkerEl({ label: row.name });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.set(row.userId, marker);
    }
  }, [map, data, selfId]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const marker of markers.values()) marker.remove();
      markers.clear();
    };
  }, [map]);

  return null;
}
