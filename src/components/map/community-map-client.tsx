"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";

import { BaseMap } from "~/components/map/base-map";
import { PoiLayer, type PoiMapItem } from "~/components/map/poi-layer";
import { POI_CATEGORIES, type PoiCategory } from "~/lib/pois";
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
  const [category, setCategory] = useState<PoiCategory>("hazard");
  const [note, setNote] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poisQuery = api.pois.inBbox.useQuery(bbox ?? { west: 0, south: 0, east: 0, north: 0 }, {
    enabled: !!bbox,
  });
  const routesQuery = api.routes.listGeoms.useQuery();
  const utils = api.useUtils();
  const create = api.pois.create.useMutation({
    onSuccess: () => {
      setPlacing(false);
      setNote("");
      void utils.pois.inBbox.invalidate();
    },
  });

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

  const poiItems: PoiMapItem[] = (poisQuery.data ?? []).map((p) => ({
    id: p.id,
    category: p.category,
    note: p.note,
    lng: p.geom.coordinates[0]!,
    lat: p.geom.coordinates[1]!,
    creatorName: p.creatorName,
    createdAt: p.createdAt,
  }));

  const handleSave = () => {
    if (!map) return;
    const center = map.getCenter();
    create.mutate({
      id: crypto.randomUUID(),
      category,
      note: note.trim().length > 0 ? note.trim() : undefined,
      point: { lng: center.lng, lat: center.lat },
    });
  };

  return (
    <>
      <BaseMap onMap={setMap} className="h-full w-full" />
      <PoiLayer
        map={map}
        pois={poiItems}
        onDeleted={() => void utils.pois.inBbox.invalidate()}
      />

      {placing ? (
        <>
          {/* fixed center crosshair -- the map pans underneath it */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <div className="h-8 w-8 rounded-full border-2 border-sunset-500 bg-sunset-500/20" />
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sunset-500" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white/95 p-4 shadow-2xl backdrop-blur">
              <p className="text-river-950 text-sm font-bold">Add a spot</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {POI_CATEGORIES.map((c) => (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => setCategory(c.category)}
                    className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${
                      category === c.category
                        ? "bg-river-600 text-white"
                        : "bg-river-50 text-river-700"
                    }`}
                  >
                    <span>{c.emoji}</span>
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 280))}
                placeholder="Optional note"
                className="min-h-11 rounded-xl border border-river-200 px-3 text-sm"
              />
              {create.isError ? (
                <p className="text-xs text-red-600">Couldn&apos;t save. Try again.</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlacing(false);
                    setNote("");
                  }}
                  className="min-h-11 flex-1 rounded-xl border border-river-200 text-sm font-semibold text-river-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={create.isPending}
                  className="min-h-11 flex-1 rounded-xl bg-sunset-500 text-sm font-bold text-white disabled:opacity-60"
                >
                  {create.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setPlacing(true)}
          className="absolute right-4 z-10 flex min-h-14 items-center gap-2 rounded-full bg-sunset-500 px-5 text-sm font-extrabold text-white shadow-2xl"
          style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          + Add spot
        </button>
      )}
    </>
  );
}
