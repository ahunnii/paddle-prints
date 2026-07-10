"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import { useLiveQuery } from "dexie-react-hooks";

import { BaseMap } from "~/components/map/base-map";
import { PoiLayer, type PoiMapItem } from "~/components/map/poi-layer";
import { PoiPlacement } from "~/components/map/poi-placement";
import { toast } from "~/components/ui/toaster";
import { db } from "~/lib/offline/db";
import { savePoiQueued } from "~/lib/offline/sync";
import type { PoiCategory } from "~/lib/pois";
import { api } from "~/trpc/react";

const ROUTES_SOURCE = "community-route-lines";
const ROUTES_COLOR = "#4fb0cd"; // river-400 -- thin river-blue

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

function getBbox(map: MapLibreMap): Bbox {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}

/**
 * The interactive community map: saved route lines + POI markers loaded for the current viewport,
 * and a "+ Add spot" flow (crosshair-centered placement -> category chip row -> optional note).
 */
export function CommunityMapClient() {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [placing, setPlacing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poisQuery = api.pois.inBbox.useQuery(bbox ?? { west: 0, south: 0, east: 0, north: 0 }, {
    enabled: !!bbox,
  });
  const routesQuery = api.routes.listGeoms.useQuery();
  const utils = api.useUtils();

  // Queued-but-not-yet-synced spots, so an offline (or just-fired) add shows up on the map
  // immediately instead of waiting for the next `pois.inBbox` fetch. Popup Delete on one of these
  // still-pending ids will NOT_FOUND on the server (it isn't there yet) -- acceptable for now.
  const pendingPois = useLiveQuery(() => db().pendingPois.toArray(), []) ?? [];

  const updateBbox = useCallback((m: MapLibreMap) => {
    setBbox(getBbox(m));
  }, []);

  // Initial load + debounced reload on moveend.
  useEffect(() => {
    if (!map) return;
    const onMoveEnd = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => updateBbox(map), 300);
    };
    if (map.loaded()) updateBbox(map);
    else map.once("load", () => updateBbox(map));
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [map, updateBbox]);

  // All saved route lines, thin river-blue, tap for a name + link popup.
  useEffect(() => {
    if (!map || !routesQuery.data) return;

    const setup = () => {
      const data: FeatureCollection<LineString, { id: string; name: string }> = {
        type: "FeatureCollection",
        features: routesQuery.data.map((r) => ({
          type: "Feature",
          properties: { id: r.id, name: r.name },
          geometry: r.geom,
        })),
      };

      const src = map.getSource(ROUTES_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        return;
      }

      map.addSource(ROUTES_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: ROUTES_SOURCE,
        type: "line",
        source: ROUTES_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ROUTES_COLOR, "line-width": 2, "line-opacity": 0.85 },
      });
      map.on("click", ROUTES_SOURCE, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.properties?.id as string;
        const name = f.properties?.name as string;
        new maplibregl.Popup({ offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="p-1"><p class="text-sm font-bold text-river-950">${name}</p><a href="/routes/${id}" class="text-xs font-semibold text-river-600 underline">View route →</a></div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", ROUTES_SOURCE, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", ROUTES_SOURCE, () => {
        map.getCanvas().style.cursor = "";
      });
    };

    if (map.loaded()) setup();
    else map.once("load", setup);
  }, [map, routesQuery.data]);

  // Built-in "locate me" button (button -> geolocate -> marker -> ease), free from MapLibre.
  useEffect(() => {
    if (!map) return;
    const ctl = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
      showAccuracyCircle: true,
    });
    map.addControl(ctl, "top-right");
    return () => {
      map.removeControl(ctl);
    };
  }, [map]);

  const poiItems: PoiMapItem[] = (poisQuery.data ?? []).map((p) => ({
    id: p.id,
    category: p.category,
    note: p.note,
    lng: p.geom.coordinates[0]!,
    lat: p.geom.coordinates[1]!,
    creatorName: p.creatorName,
    createdAt: p.createdAt,
  }));
  const serverIds = new Set(poiItems.map((p) => p.id));
  const pendingItems: PoiMapItem[] = pendingPois
    .filter((p) => !serverIds.has(p.id))
    .map((p) => ({
      id: p.id,
      category: p.input.category,
      note: p.input.note ?? null,
      lng: p.input.point.lng,
      lat: p.input.point.lat,
      creatorName: "You",
      createdAt: new Date(p.createdAt),
    }));

  const openPlacement = () => {
    setSaveError(null);
    setPlacing(true);
  };

  const handleCancel = () => {
    setPlacing(false);
    setSaveError(null);
  };

  const handleSave = async (category: PoiCategory, note: string) => {
    if (!map) return;
    setSaving(true);
    setSaveError(null);
    try {
      const center = map.getCenter();
      const status = await savePoiQueued({
        category,
        note: note.trim().length > 0 ? note.trim() : undefined,
        point: { lng: center.lng, lat: center.lat },
      });
      toast(status === "synced" ? "Spot saved" : "Saved offline — will sync when online");
      void utils.pois.inBbox.invalidate();
      setPlacing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BaseMap onMap={setMap} className="h-full w-full" />
      <PoiLayer
        map={map}
        pois={[...poiItems, ...pendingItems]}
        onDeleted={() => void utils.pois.inBbox.invalidate()}
      />

      <PoiPlacement
        open={placing}
        saving={saving}
        error={saveError}
        onCancel={handleCancel}
        onSave={(category, note) => void handleSave(category, note)}
      />

      {!placing ? (
        <button
          type="button"
          onClick={openPlacement}
          className="absolute right-4 z-10 flex min-h-14 items-center gap-2 rounded-full bg-sunset-500 px-5 text-sm font-extrabold text-white shadow-2xl"
          style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          + Add spot
        </button>
      ) : null}
    </>
  );
}
