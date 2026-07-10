"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl, {
  type LngLatLike,
  type Map as MapLibreMap,
} from "maplibre-gl";
import { skipToken } from "@tanstack/react-query";
import { length as turfLength } from "@turf/length";
import { lineString as turfLineString } from "@turf/helpers";

import { BaseMap } from "~/components/map/base-map";
import { FloatingHeader } from "~/components/layout/floating-header";
import { api } from "~/trpc/react";

type RouteShape = "one_way" | "out_and_back";
type BuilderMode = "river" | "waypoint";

interface Waypoint {
  lng: number;
  lat: number;
}

const METERS_PER_MILE = 1609.344;

// Huron River near Ann Arbor -- rivers are the primary use case, so we open on
// a paddleable stretch rather than the lake-oriented default.
const DEFAULT_CENTER: LngLatLike = [-83.74, 42.29];
const DEFAULT_ZOOM = 13;

const ROUTE_LINE_SOURCE = "route-builder-line";
const ROUTE_LINE_COLOR = "#1f7796"; // river-600

const EMPTY_LINE: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] },
};

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

/** Build a labelled, coloured circular pin element for the river put-in / take-out. */
function makeRiverPin(label: string, bgClass: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `flex h-9 w-9 cursor-grab items-center justify-center rounded-full border-2 border-white ${bgClass} text-[10px] font-bold uppercase text-white shadow-lg active:cursor-grabbing`;
  el.textContent = label;
  el.style.touchAction = "none";
  el.title = "Drag to move";
  return el;
}

export function RouteBuilder() {
  const router = useRouter();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const riverMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Rivers are the primary use case, so river mode is the default.
  const [mode, setMode] = useState<BuilderMode>("river");
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [putIn, setPutIn] = useState<Waypoint | null>(null);
  const [takeOut, setTakeOut] = useState<Waypoint | null>(null);
  const [shape, setShape] = useState<RouteShape>("one_way");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Refs so the once-registered map click handler always sees current values.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const putInRef = useRef(putIn);
  putInRef.current = putIn;

  // --- river routing query -------------------------------------------------
  const riverQuery = api.rivers.route.useQuery(
    mode === "river" && putIn && takeOut ? { a: putIn, b: takeOut } : skipToken,
    { retry: false },
  );
  const riverData = riverQuery.data;
  const riverErrorCode = riverQuery.error?.message ?? null;

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

  const clearAll = useCallback(() => {
    setWaypoints([]);
    setPutIn(null);
    setTakeOut(null);
  }, []);

  // Switch build mode. Clears the in-progress route (confirming first if any
  // pins exist, so a stray tap doesn't wipe real work).
  const switchMode = useCallback(
    (target: BuilderMode) => {
      setMode((current) => {
        if (target === current) return current;
        const hasState =
          current === "river"
            ? putInRef.current !== null || takeOut !== null
            : waypoints.length > 0;
        if (
          hasState &&
          !window.confirm("Switch modes? This clears your current route.")
        ) {
          return current;
        }
        clearAll();
        return target;
      });
    },
    [waypoints.length, takeOut, clearAll],
  );

  // NO_PATH fallback: keep both tapped points as the first two waypoints of a
  // lake/open-water route so the paddler doesn't have to re-tap.
  const switchToWaypointFallback = useCallback(() => {
    const pts = [putIn, takeOut].filter((p): p is Waypoint => p !== null);
    clearAll();
    setWaypoints(pts);
    setMode("waypoint");
  }, [putIn, takeOut, clearAll]);

  // Wait for the style to finish loading before touching sources/layers.
  useEffect(() => {
    if (!map) return;
    if (map.loaded()) {
      setMapReady(true);
      return;
    }
    map.once("load", () => setMapReady(true));
  }, [map]);

  // Tap the map. River mode: first tap = put-in, any later tap sets/replaces the
  // take-out (keeping the put-in). Waypoint mode: append a waypoint.
  useEffect(() => {
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const coord = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      if (modeRef.current === "river") {
        if (!putInRef.current) setPutIn(coord);
        else setTakeOut(coord);
      } else {
        setWaypoints((prev) => [...prev, coord]);
      }
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
        data: EMPTY_LINE,
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

  // Keep the drawn line in sync: waypoint polyline, or the server-returned river path.
  useEffect(() => {
    if (!map || !mapReady) return;
    const source = map.getSource(ROUTE_LINE_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    if (mode === "waypoint") {
      source.setData(toLineFeature(waypoints));
    } else if (riverData) {
      source.setData({
        type: "Feature",
        properties: {},
        geometry: riverData.geometry,
      });
    } else {
      source.setData(EMPTY_LINE);
    }
  }, [map, mapReady, mode, waypoints, riverData]);

  // Waypoint-mode pins: numbered, draggable, tap-to-remove.
  useEffect(() => {
    if (!map || mode !== "waypoint") return;

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
  }, [map, mode, waypoints, removeWaypoint, updateWaypoint]);

  // River-mode pins: put-in / take-out shown at their SNAPPED positions once the
  // route resolves (raw tap position until then). Dragging re-runs the query.
  useEffect(() => {
    if (!map || mode !== "river") return;

    riverMarkersRef.current.forEach((marker) => marker.remove());
    riverMarkersRef.current = [];

    const putInPos = riverData?.snappedA ?? putIn;
    const takeOutPos = riverData?.snappedB ?? takeOut;

    const addPin = (
      pos: Waypoint,
      label: string,
      bgClass: string,
      onMove: (c: Waypoint) => void,
    ) => {
      const marker = new maplibregl.Marker({
        element: makeRiverPin(label, bgClass),
        draggable: true,
      })
        .setLngLat([pos.lng, pos.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        onMove({ lng: lngLat.lng, lat: lngLat.lat });
      });
      riverMarkersRef.current.push(marker);
    };

    if (putInPos) addPin(putInPos, "In", "bg-sunset-500", setPutIn);
    if (takeOutPos) addPin(takeOutPos, "Out", "bg-river-800", setTakeOut);

    return () => {
      riverMarkersRef.current.forEach((marker) => marker.remove());
      riverMarkersRef.current = [];
    };
  }, [map, mode, putIn, takeOut, riverData]);

  const waypointMiles = useMemo(() => {
    if (waypoints.length < 2) return 0;
    const line = turfLineString(waypoints.map((wp) => [wp.lng, wp.lat]));
    const oneWayMiles = turfLength(line, { units: "miles" });
    return shape === "out_and_back" ? oneWayMiles * 2 : oneWayMiles;
  }, [waypoints, shape]);

  const riverMiles = useMemo(() => {
    if (!riverData) return 0;
    const oneWayMiles = riverData.distanceM / METERS_PER_MILE;
    return shape === "out_and_back" ? oneWayMiles * 2 : oneWayMiles;
  }, [riverData, shape]);

  const distanceMiles = mode === "river" ? riverMiles : waypointMiles;

  const canSave =
    name.trim().length > 0 &&
    (mode === "river" ? !!riverData : waypoints.length >= 2);

  const handleSave = () => {
    if (!canSave) return;
    if (mode === "river") {
      if (!riverData) return;
      createRoute.mutate({
        name: name.trim(),
        type: "river",
        shape,
        description: description.trim() || undefined,
        geometry: {
          type: "LineString",
          coordinates: riverData.geometry.coordinates.map(
            (c) => [c[0], c[1]] as [number, number],
          ),
        },
      });
    } else {
      createRoute.mutate({
        name: name.trim(),
        type: "waypoint",
        shape,
        description: description.trim() || undefined,
        geometry: {
          type: "LineString",
          coordinates: waypoints.map((wp) => [wp.lng, wp.lat]),
        },
      });
    }
  };

  // River-mode status line + error banner content.
  const riverHint = !putIn
    ? "Tap the map at your put-in"
    : !takeOut
      ? "Tap again at your take-out"
      : riverQuery.isFetching
        ? "Finding the river path…"
        : riverData
          ? "River path ready — drag pins to fine-tune"
          : "";

  return (
    <main className="relative h-dvh w-dvw">
      <BaseMap
        className="h-full w-full"
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        onMap={setMap}
      />

      {mode === "river" && riverQuery.isFetching ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-river-800 shadow-lg backdrop-blur">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-river-300 border-t-river-700" />
            Routing…
          </div>
        </div>
      ) : null}

      <FloatingHeader backHref="/routes" title="New route" />

      <div className="pointer-events-none absolute inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] flex justify-center p-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => switchMode("river")}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
              mode === "river"
                ? "bg-river-600 text-white"
                : "text-river-700 hover:text-river-900"
            }`}
          >
            River
          </button>
          <button
            type="button"
            onClick={() => switchMode("waypoint")}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
              mode === "waypoint"
                ? "bg-river-600 text-white"
                : "text-river-700 hover:text-river-900"
            }`}
          >
            Lake / open water
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <p className="text-river-900 text-sm font-medium">
              {mode === "river"
                ? riverHint
                : waypoints.length === 0
                  ? "Tap the map to drop your first point"
                  : `${waypoints.length} point${waypoints.length === 1 ? "" : "s"}`}
            </p>
            <p className="text-river-700 text-lg font-bold tabular-nums">
              {distanceMiles.toFixed(1)} mi
              {shape === "out_and_back" && distanceMiles > 0
                ? " (round trip)"
                : ""}
            </p>
          </div>

          {mode === "river" && riverErrorCode ? (
            <div className="flex flex-col gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {riverErrorCode === "SNAP_TOO_FAR" ? (
                <p>
                  That point isn&apos;t near a river — tap closer to the water
                  (within ~300&nbsp;m).
                </p>
              ) : riverErrorCode === "NO_PATH" ? (
                <>
                  <p>Couldn&apos;t connect these along the river.</p>
                  <button
                    type="button"
                    onClick={switchToWaypointFallback}
                    className="min-h-11 rounded-lg bg-river-600 px-3 text-sm font-semibold text-white"
                  >
                    Switch to Lake/open-water mode
                  </button>
                </>
              ) : riverErrorCode === "TOO_LONG" ? (
                <p>That&apos;s over 90 miles of river — split it up.</p>
              ) : (
                <p>Something went wrong routing that. Try different points.</p>
              )}
            </div>
          ) : null}

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this route"
            maxLength={80}
            className="border-river-200 focus:border-sunset-400 focus:ring-sunset-200 min-h-11 rounded-xl border px-4 py-2 outline-none focus:ring-2"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe this route (optional)"
            maxLength={2000}
            rows={2}
            className="border-river-200 focus:border-sunset-400 focus:ring-sunset-200 rounded-xl border px-4 py-2 outline-none focus:ring-2 resize-none"
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

          {mode === "river" ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPutIn(takeOut);
                  setTakeOut(putIn);
                }}
                disabled={!putIn || !takeOut}
                className="text-river-700 min-h-11 flex-1 rounded-xl bg-river-50 text-sm font-semibold disabled:opacity-40"
              >
                Swap direction
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={!putIn && !takeOut}
                className="text-river-700 min-h-11 flex-1 rounded-xl bg-river-50 text-sm font-semibold disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          ) : (
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
          )}

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
