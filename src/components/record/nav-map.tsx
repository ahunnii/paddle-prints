"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

import { BaseMap } from "~/components/map/base-map";

interface NavMapProps {
  /** Route line to follow ([lng,lat] pairs), or null for a free paddle. */
  routeCoords: Array<[number, number]> | null;
  /** Latest GPS position. */
  livePos: { lng: number; lat: number } | null;
  /** Snapped-progress point along the route. */
  snapped: { lng: number; lat: number } | null;
  /**
   * When true, follow mode is held off regardless of `follow` -- used while the paddler is placing a
   * POI (the crosshair needs the map to stay put under manual panning). Flipping this back to false
   * does NOT auto-resume follow; the recenter button is there for that.
   */
  followSuspended?: boolean;
  /** Called with the map instance once it exists, so the parent can read `getCenter()`. */
  onMap?: (map: MapLibreMap) => void;
  className?: string;
}

const ROUTE_SOURCE = "nav-route-line";
const ROUTE_COLOR = "#4fb0cd"; // river-400 -- readable on the near-black nav basemap

/** The map shown in nav mode: the route line, a live position dot, and the snapped-progress dot. */
export function NavMap({
  routeCoords,
  livePos,
  snapped,
  followSuspended = false,
  onMap,
  className,
}: NavMapProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  // Follow mode keeps the map centred on live GPS; a user pan/pinch breaks it until they recenter.
  const [follow, setFollow] = useState(true);
  const liveMarker = useRef<maplibregl.Marker | null>(null);
  const snapMarker = useRef<maplibregl.Marker | null>(null);
  const centeredOnce = useRef(false);

  const handleMap = (m: MapLibreMap) => {
    setMap(m);
    onMap?.(m);
  };

  useEffect(() => {
    if (!map) return;
    if (map.loaded()) setReady(true);
    else map.once("load", () => setReady(true));
  }, [map]);

  // A user gesture (pan/pinch) breaks follow mode. Programmatic easeTo carries no `originalEvent`,
  // so only real interactions drop us out of follow.
  useEffect(() => {
    if (!map) return;
    const onMoveStart = (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      if (e.originalEvent) setFollow(false);
    };
    map.on("movestart", onMoveStart);
    return () => {
      map.off("movestart", onMoveStart);
    };
  }, [map]);

  // Draw the route line once the style is ready.
  useEffect(() => {
    if (!map || !ready || !routeCoords || routeCoords.length < 2) return;
    if (!map.getSource(ROUTE_SOURCE)) {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: routeCoords },
        },
      });
      map.addLayer({
        id: ROUTE_SOURCE,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ROUTE_COLOR, "line-width": 4, "line-opacity": 0.9 },
      });
    }
  }, [map, ready, routeCoords]);

  // Live position dot + keep it centred (only while following and not suspended).
  useEffect(() => {
    if (!map || !livePos) return;
    if (!liveMarker.current) {
      const el = document.createElement("div");
      el.className =
        "h-5 w-5 rounded-full border-2 border-white bg-sunset-500 shadow-[0_0_0_6px_rgba(249,115,22,0.25)]";
      liveMarker.current = new maplibregl.Marker({ element: el });
    }
    liveMarker.current.setLngLat([livePos.lng, livePos.lat]).addTo(map);
    if (!centeredOnce.current) {
      map.easeTo({ center: [livePos.lng, livePos.lat], zoom: 15, duration: 0 });
      centeredOnce.current = true;
    } else if (follow && !followSuspended) {
      map.easeTo({ center: [livePos.lng, livePos.lat], duration: 600 });
    }
  }, [map, livePos, follow, followSuspended]);

  // Snapped-progress marker (route paddles only).
  useEffect(() => {
    if (!map || !snapped) return;
    if (!snapMarker.current) {
      const el = document.createElement("div");
      el.className = "h-3 w-3 rounded-full border border-white bg-river-300";
      snapMarker.current = new maplibregl.Marker({ element: el });
    }
    snapMarker.current.setLngLat([snapped.lng, snapped.lat]).addTo(map);
  }, [map, snapped]);

  return (
    <div className="relative h-full w-full">
      <BaseMap
        styleUrl="/map/style-nav.json"
        onMap={handleMap}
        className={className ?? "h-full w-full"}
      />

      {!follow && !followSuspended && livePos ? (
        <button
          type="button"
          aria-label="Recenter on my position"
          onClick={() => {
            if (!map) return;
            map.easeTo({ center: [livePos.lng, livePos.lat], duration: 500 });
            setFollow(true);
          }}
          className="absolute bottom-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-xl text-river-950 shadow-lg"
        >
          <span aria-hidden>◎</span>
        </button>
      ) : null}
    </div>
  );
}
