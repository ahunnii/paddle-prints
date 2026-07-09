"use client";

import { useEffect, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

import { BaseMap } from "~/components/map/base-map";

interface PaddleMapProps {
  /** The route the paddle followed, drawn underneath in river blue. */
  routeCoords: Array<[number, number]> | null;
  /** The actual recorded track, drawn on top in sunset orange. */
  trackCoords: Array<[number, number]> | null;
  className?: string;
}

const ROUTE_SRC = "paddle-route-line";
const TRACK_SRC = "paddle-track-line";
const ROUTE_COLOR = "#1f7796"; // river-600
const TRACK_COLOR = "#f97316"; // sunset-500

/** Summary map: the recorded track over the planned route, framed to the track. */
export function PaddleMap({ routeCoords, trackCoords, className }: PaddleMapProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);

  useEffect(() => {
    if (!map) return;

    const setup = () => {
      if (routeCoords && routeCoords.length >= 2 && !map.getSource(ROUTE_SRC)) {
        map.addSource(ROUTE_SRC, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: routeCoords },
          },
        });
        map.addLayer({
          id: ROUTE_SRC,
          type: "line",
          source: ROUTE_SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ROUTE_COLOR, "line-width": 4, "line-opacity": 0.6 },
        });
      }

      if (trackCoords && trackCoords.length >= 2 && !map.getSource(TRACK_SRC)) {
        map.addSource(TRACK_SRC, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: trackCoords },
          },
        });
        map.addLayer({
          id: TRACK_SRC,
          type: "line",
          source: TRACK_SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": TRACK_COLOR, "line-width": 4 },
        });
      }

      const frame = trackCoords ?? routeCoords;
      const first = frame?.[0];
      if (frame && first) {
        const bounds = frame.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(first, first),
        );
        map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
        new maplibregl.Marker({ color: "#f97316" }).setLngLat(first).addTo(map);
        const last = frame[frame.length - 1];
        if (last && frame.length > 1) {
          new maplibregl.Marker({ color: "#1e6079" }).setLngLat(last).addTo(map);
        }
      }
    };

    if (map.loaded()) setup();
    else map.once("load", setup);
  }, [map, routeCoords, trackCoords]);

  return <BaseMap onMap={setMap} className={className ?? "h-full w-full"} />;
}
