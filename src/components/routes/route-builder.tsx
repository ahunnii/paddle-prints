"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl, {
  type LngLatLike,
  type Map as MapLibreMap,
} from "maplibre-gl";
import { length as turfLength } from "@turf/length";
import { lineString as turfLineString } from "@turf/helpers";
import Link from "next/link";

import { BaseMap } from "~/components/map/base-map";
import { api } from "~/trpc/react";

type RouteShape = "one_way" | "out_and_back";

interface Waypoint {
  lng: number;
  lat: number;
}

// Higgins Lake, MI -- a reasonable default for building a "lake / open water" route.
const DEFAULT_CENTER: LngLatLike = [-84.68, 44.48];
const DEFAULT_ZOOM = 12;

const ROUTE_LINE_SOURCE = "route-builder-line";
const ROUTE_LINE_COLOR = "#1f7796"; // river-600

function toLineFeature(waypoints: Waypoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: waypoints.map((wp) => [wp.lng, wp.lat]),
    },
  };
}

export function RouteBuilder() {
  const router = useRouter();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [shape, setShape] = useState<RouteShape>("one_way");
  const [name, setName] = useState("");

  const createRoute = api.routes.create.useMutation({
    onSuccess: (route) => {
      router.push(`/routes/${route.id}`);
    },
  });

  const removeWaypoint = useCallback((index: number) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateWaypoint = useCallback((index: number, coord: Waypoint) => {
    setWaypoints((prev) => prev.map((wp, i) => (i === index ? coord : wp)));
  }, []);

  // Wait for the style to finish loading before touching sources/layers.
  useEffect(() => {
    if (!map) return;
    if (map.loaded()) {
      setMapReady(true);
      return;
    }
    map.once("load", () => setMapReady(true));
  }, [map]);

  // Tap the map to append a waypoint.
  useEffect(() => {
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      setWaypoints((prev) => [
        ...prev,
        { lng: e.lngLat.lng, lat: e.lngLat.lat },
      ]);
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map]);

  // Create the route line source/layer once the style is ready.
  useEffect(() => {
    if (!map || !mapReady) return;

    if (!map.getSource(ROUTE_LINE_SOURCE)) {
      map.addSource(ROUTE_LINE_SOURCE, {
        type: "geojson",
        data: toLineFeature([]),
      });
      map.addLayer({
        id: ROUTE_LINE_SOURCE,
        type: "line",
        source: ROUTE_LINE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ROUTE_LINE_COLOR, "line-width": 4 },
      });
    }

    return () => {
      if (map.getLayer(ROUTE_LINE_SOURCE)) map.removeLayer(ROUTE_LINE_SOURCE);
      if (map.getSource(ROUTE_LINE_SOURCE)) map.removeSource(ROUTE_LINE_SOURCE);
    };
  }, [map, mapReady]);

  // Keep the line in sync with the waypoint list.
  useEffect(() => {
    if (!map || !mapReady) return;
    const source = map.getSource(ROUTE_LINE_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(toLineFeature(waypoints));
  }, [map, mapReady, waypoints]);

  // Rebuild numbered, draggable/removable pin markers whenever the waypoint list changes.
  useEffect(() => {
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    waypoints.forEach((wp, index) => {
      const el = document.createElement("div");
      el.className =
        "flex h-8 w-8 cursor-grab items-center justify-center rounded-full border-2 border-white bg-sunset-500 text-sm font-bold text-white shadow-lg active:cursor-grabbing";
      el.textContent = String(index + 1);
      el.style.touchAction = "none";
      el.title = "Drag to move, tap to remove";

      let dragged = false;

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([wp.lng, wp.lat])
        .addTo(map);

      marker.on("drag", () => {
        dragged = true;
      });

      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        updateWaypoint(index, { lng: lngLat.lng, lat: lngLat.lat });
      });

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dragged) {
          dragged = false;
          return;
        }
        removeWaypoint(index);
      });

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [map, waypoints, removeWaypoint, updateWaypoint]);

  const distanceMiles = useMemo(() => {
    if (waypoints.length < 2) return 0;
    const line = turfLineString(waypoints.map((wp) => [wp.lng, wp.lat]));
    const oneWayMiles = turfLength(line, { units: "miles" });
    return shape === "out_and_back" ? oneWayMiles * 2 : oneWayMiles;
  }, [waypoints, shape]);

  const canSave = waypoints.length >= 2 && name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    createRoute.mutate({
      name: name.trim(),
      type: "waypoint",
      shape,
      geometry: {
        type: "LineString",
        coordinates: waypoints.map((wp) => [wp.lng, wp.lat]),
      },
    });
  };

  return (
    <main className="relative h-dvh w-dvw">
      <BaseMap
        className="h-full w-full"
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        onMap={setMap}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 shadow-lg backdrop-blur">
          <Link
            href="/routes"
            className="text-river-700 hover:text-river-900 text-sm font-semibold"
          >
            ← Back
          </Link>
          <span className="text-river-200">|</span>
          <span className="text-river-900 text-sm font-medium">
            New route
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center p-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            disabled
            title="Coming soon"
            className="min-h-11 cursor-not-allowed rounded-full px-4 text-sm font-semibold text-river-300"
          >
            River
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full bg-river-600 px-4 text-sm font-semibold text-white"
          >
            Lake / open water
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <p className="text-river-900 text-sm font-medium">
              {waypoints.length === 0
                ? "Tap the map to drop your first point"
                : `${waypoints.length} point${waypoints.length === 1 ? "" : "s"}`}
            </p>
            <p className="text-river-700 text-lg font-bold tabular-nums">
              {distanceMiles.toFixed(1)} mi
              {shape === "out_and_back" && waypoints.length >= 2
                ? " (round trip)"
                : ""}
            </p>
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this route"
            maxLength={80}
            className="border-river-200 focus:border-sunset-400 focus:ring-sunset-200 min-h-11 rounded-xl border px-4 py-2 outline-none focus:ring-2"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShape("one_way")}
              className={`min-h-11 flex-1 rounded-xl text-sm font-semibold transition-colors ${
                shape === "one_way"
                  ? "bg-river-600 text-white"
                  : "bg-river-50 text-river-700"
              }`}
            >
              One-way
            </button>
            <button
              type="button"
              onClick={() => setShape("out_and_back")}
              className={`min-h-11 flex-1 rounded-xl text-sm font-semibold transition-colors ${
                shape === "out_and_back"
                  ? "bg-river-600 text-white"
                  : "bg-river-50 text-river-700"
              }`}
            >
              Out & back
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWaypoints((prev) => prev.slice(0, -1))}
              disabled={waypoints.length === 0}
              className="text-river-700 min-h-11 flex-1 rounded-xl bg-river-50 text-sm font-semibold disabled:opacity-40"
            >
              Undo last pin
            </button>
            <button
              type="button"
              onClick={() => setWaypoints([])}
              disabled={waypoints.length === 0}
              className="text-river-700 min-h-11 flex-1 rounded-xl bg-river-50 text-sm font-semibold disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          {createRoute.error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {createRoute.error.message}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || createRoute.isPending}
            className="bg-sunset-500 hover:bg-sunset-600 min-h-11 rounded-xl font-semibold text-white shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createRoute.isPending ? "Saving..." : "Save route"}
          </button>
        </div>
      </div>
    </main>
  );
}
