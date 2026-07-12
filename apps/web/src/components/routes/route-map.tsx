"use client";

import { useEffect, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { LineString } from "geojson";

import { BaseMap } from "~/components/map/base-map";
import { PoiLayer, type PoiMapItem } from "~/components/map/poi-layer";

interface RouteMapProps {
  geometry: LineString;
  shape: "one_way" | "out_and_back";
  pois?: PoiMapItem[];
  className?: string;
}

const ROUTE_LINE_SOURCE = "route-detail-line";
const ROUTE_LINE_COLOR = "#1f7796"; // river-600

export function RouteMap({ geometry, shape, pois, className }: RouteMapProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);

  useEffect(() => {
    if (!map) return;

    const setup = () => {
      if (!map.getSource(ROUTE_LINE_SOURCE)) {
        map.addSource(ROUTE_LINE_SOURCE, {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry },
        });
        map.addLayer({
          id: ROUTE_LINE_SOURCE,
          type: "line",
          source: ROUTE_LINE_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ROUTE_LINE_COLOR, "line-width": 4 },
        });
      }

      const coords = geometry.coordinates as [number, number][];
      const first = coords[0];
      if (!first) return;

      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(first, first),
      );
      map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 0 });

      new maplibregl.Marker({ color: "#f97316" }) // sunset-500 -- start
        .setLngLat(first)
        .addTo(map);

      const last = coords[coords.length - 1];
      if (last && coords.length > 1) {
        new maplibregl.Marker({ color: "#1e6079" }) // river-800 -- end / turnaround
          .setLngLat(last)
          .addTo(map);
      }
    };

    if (map.loaded()) setup();
    else map.once("load", setup);
  }, [map, geometry, shape]);

  return (
    <>
      <BaseMap onMap={setMap} className={className ?? "h-full w-full"} />
      <PoiLayer map={map} pois={pois ?? []} />
    </>
  );
}
