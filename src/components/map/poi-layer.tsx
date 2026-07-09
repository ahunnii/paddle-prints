"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

import { createPoiMarkerEl } from "~/lib/map/poi-marker-el";
import { poiMeta } from "~/lib/pois";
import { api } from "~/trpc/react";

export interface PoiMapItem {
  id: string;
  category: string;
  note: string | null;
  lng: number;
  lat: number;
  creatorName: string;
  createdAt: string | Date;
}

interface PoiLayerProps {
  map: MapLibreMap | null;
  pois: PoiMapItem[];
  /** Called after a successful delete so the caller can drop it from its own state/refresh. */
  onDeleted?: (id: string) => void;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders POI markers on a maplibre map: a white category-emoji pill, tap for a popup with the
 * category label, note, creator, date, and a delete button. Shared by the community map, the route
 * detail map, and (implicitly, via the same category set) the nav banner.
 */
export function PoiLayer({ map, pois, onDeleted }: PoiLayerProps) {
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const del = api.pois.delete.useMutation();
  const delRef = useRef(del);
  delRef.current = del;
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  useEffect(() => {
    if (!map) return;

    const seen = new Set(pois.map((p) => p.id));
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const poi of pois) {
      const existing = markersRef.current.get(poi.id);
      if (existing) {
        existing.setLngLat([poi.lng, poi.lat]);
        continue;
      }

      const meta = poiMeta(poi.category);
      const el = createPoiMarkerEl(poi.category);
      const popup = new maplibregl.Popup({
        offset: 20,
        closeButton: true,
        maxWidth: "240px",
      }).setHTML(`
        <div class="min-w-[10rem] p-1">
          <p class="text-sm font-bold text-river-950">${meta.emoji} ${escapeHtml(meta.label)}</p>
          ${poi.note ? `<p class="mt-1 text-sm text-river-700">${escapeHtml(poi.note)}</p>` : ""}
          <p class="mt-1 text-xs text-river-400">${escapeHtml(poi.creatorName)} &middot; ${new Date(
            poi.createdAt,
          ).toLocaleDateString()}</p>
          <button type="button" data-delete-poi="${poi.id}" class="mt-2 min-h-9 w-full rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-600">Delete</button>
        </div>
      `);

      popup.on("open", () => {
        const btn = popup
          .getElement()
          ?.querySelector<HTMLButtonElement>(`[data-delete-poi="${poi.id}"]`);
        btn?.addEventListener("click", () => {
          if (!window.confirm("Delete this spot?")) return;
          delRef.current.mutate(
            { id: poi.id },
            {
              onSuccess: () => {
                popup.remove();
                onDeletedRef.current?.(poi.id);
              },
            },
          );
        });
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lng, poi.lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.set(poi.id, marker);
    }
    // Only re-run when the map instance or the POI list changes -- del/onDeleted are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pois]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const marker of markers.values()) marker.remove();
      markers.clear();
    };
  }, [map]);

  return null;
}
