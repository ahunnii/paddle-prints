"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

import { createPoiMarkerEl } from "~/lib/map/poi-marker-el";
import { poiMeta, truncateNote } from "~/lib/pois";

export interface NavPoi {
  id: string;
  category: string;
  note: string | null;
  lng: number;
  lat: number;
  /** Not available for POIs embedded in an offline-downloaded route's corridor (that payload predates
   * this field) -- undefined there, so the card just omits the attribution line. */
  creatorName?: string;
  createdAt?: string | Date;
}

interface NavPoiLayerProps {
  map: MapLibreMap | null;
  pois: NavPoi[];
  /** True while the paddler is placing a new spot (crosshair mode) -- closes any open card so it
   * can't cover/compete with the crosshair, without disturbing the markers themselves. */
  suspended?: boolean;
}

// Small + slightly translucent so the markers stay glanceable on the dark nav basemap and don't
// compete with the route line / live position dot -- noticeably smaller than the community map's
// 34px pins.
const NAV_MARKER_SIZE = 24;
const NAV_MARKER_OPACITY = 0.85;

/**
 * Renders safety-relevant POI markers (hazard/portage/dock -- filtering happens upstream, in
 * whatever builds `pois`) on the nav map. Unlike the community map's `PoiLayer`, there's no
 * maplibre `Popup`/delete flow: tapping a marker opens a compact, dark-styled, read-only card
 * (emoji + category + note) tracked as local React state, so it renders as normal DOM instead of
 * a map-anchored popup. Tapping the basemap (a real map click, which marker taps never bubble
 * into) or the card's own close button dismisses it; `suspended` (crosshair placement) does too.
 */
export function NavPoiLayer({ map, pois, suspended = false }: NavPoiLayerProps) {
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const setSelectedIdRef = useRef(setSelectedId);
  setSelectedIdRef.current = setSelectedId;

  // Close the card whenever placement mode opens.
  useEffect(() => {
    if (suspended) setSelectedId(null);
  }, [suspended]);

  // A tap on the basemap itself (not a marker -- marker elements live outside the canvas, so their
  // clicks never reach this listener) closes any open card.
  useEffect(() => {
    if (!map) return;
    const onClick = () => setSelectedIdRef.current(null);
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    const seen = new Set(pois.map((p) => p.id));
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
    setSelectedIdRef.current((current) => (current && !seen.has(current) ? null : current));

    for (const poi of pois) {
      const existing = markersRef.current.get(poi.id);
      if (existing) {
        existing.setLngLat([poi.lng, poi.lat]);
        continue;
      }

      const el = createPoiMarkerEl(poi.category, NAV_MARKER_SIZE, NAV_MARKER_OPACITY);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedIdRef.current(poi.id);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lng, poi.lat])
        .addTo(map);
      markersRef.current.set(poi.id, marker);
    }
    // Only re-run when the map instance or the POI list changes.
  }, [map, pois]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const marker of markers.values()) marker.remove();
      markers.clear();
    };
  }, [map]);

  const selected = !suspended ? (pois.find((p) => p.id === selectedId) ?? null) : null;
  if (!selected) return null;

  const meta = poiMeta(selected.category);

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-16 z-20 flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-xs items-start gap-2 rounded-2xl border border-white/15 bg-black/90 px-4 py-3 shadow-2xl backdrop-blur">
        <span className="text-xl leading-none" aria-hidden>
          {meta.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">{meta.label}</p>
          {selected.note ? (
            <p className="mt-0.5 text-xs text-white/70">{truncateNote(selected.note, 140)}</p>
          ) : null}
          {selected.creatorName ? (
            <p className="mt-1 text-[11px] text-white/50">
              {selected.creatorName}
              {selected.createdAt
                ? ` · ${new Date(selected.createdAt).toLocaleDateString()}`
                : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setSelectedId(null)}
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white/50 active:bg-white/10"
        >
          ×
        </button>
      </div>
    </div>
  );
}
