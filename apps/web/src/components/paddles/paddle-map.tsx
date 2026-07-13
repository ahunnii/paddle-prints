"use client";

import { useEffect, useMemo, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { LineString } from "geojson";

import { BaseMap } from "~/components/map/base-map";
import { FlowArrowLayer, type FlowLeg } from "~/components/map/flow-arrow-layer";
import { PoiLayer, type PoiMapItem } from "~/components/map/poi-layer";
import { addGeolocateControl } from "~/lib/map/geolocate-control";
import { api } from "~/trpc/react";

interface PaddleMapProps {
  /** The route the paddle followed, drawn underneath in river blue. */
  routeCoords: Array<[number, number]> | null;
  /** Per-leg flow directions of that route, over metre ranges of `routeCoords`. */
  routeFlowLegs?: FlowLeg[] | null;
  /** The actual recorded track, drawn on top in sunset orange. */
  trackCoords: Array<[number, number]> | null;
  className?: string;
}

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const ROUTE_SRC = "paddle-route-line";
const TRACK_SRC = "paddle-track-line";
const ROUTE_COLOR = "#1f7796"; // river-600
const TRACK_COLOR = "#f97316"; // sunset-500

/** Summary map: the recorded track over the planned route, framed to the track. */
export function PaddleMap({
  routeCoords,
  routeFlowLegs = null,
  trackCoords,
  className,
}: PaddleMapProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  // This map is fitted-once-and-static (no pan/zoom-driven `moveend` like the community map), so
  // POIs are fetched a single time for whatever bbox `fitBounds` settles on below -- not refetched.
  const [bbox, setBbox] = useState<Bbox | null>(null);

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

        // Read back the bbox `fitBounds` actually settled on (post-padding) for the one-shot POI
        // fetch below.
        const b = map.getBounds();
        setBbox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      }
    };

    if (map.loaded()) setup();
    else map.once("load", setup);
  }, [map, routeCoords, trackCoords]);

  useEffect(() => {
    if (!map) return;
    return addGeolocateControl(map);
  }, [map]);

  const poisQuery = api.pois.inBbox.useQuery(bbox ?? { west: 0, south: 0, east: 0, north: 0 }, {
    enabled: !!bbox,
  });
  const poiItems: PoiMapItem[] = (poisQuery.data ?? []).map((p) => ({
    id: p.id,
    category: p.category,
    note: p.note,
    lng: p.geom.coordinates[0]!,
    lat: p.geom.coordinates[1]!,
    creatorName: p.creatorName,
    createdAt: p.createdAt,
  }));

  // Flow arrows follow the planned route line (river routes only).
  const flowGeometry = useMemo<LineString | null>(
    () =>
      routeCoords && routeCoords.length >= 2
        ? { type: "LineString", coordinates: routeCoords }
        : null,
    [routeCoords],
  );

  return (
    <>
      <BaseMap onMap={setMap} className={className ?? "h-full w-full"} />
      <FlowArrowLayer map={map} geometry={flowGeometry} legs={routeFlowLegs} />
      <PoiLayer map={map} pois={poiItems} />
    </>
  );
}
