"use client";

/**
 * The "Paddle in Review" overview map: every track in the current filter drawn as one thin
 * sunset-orange line layer, framed to whatever's on screen. Unlike PaddleMap/RouteMap this never
 * places start/end markers -- with dozens of overlapping tracks they'd just be noise.
 */
import { useEffect, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";

import { BaseMap } from "~/components/map/base-map";

export interface ReviewTrack {
  id: string;
  geom: LineString;
}

const TRACKS_SOURCE = "review-track-lines";
const TRACK_COLOR = "#f97316"; // sunset-500

interface ReviewMapProps {
  tracks: ReviewTrack[];
  className?: string;
  onMap?: (map: MapLibreMap) => void;
}

export function ReviewMap({ tracks, className, onMap }: ReviewMapProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);

  // Draw (or update) the track lines and fit the viewport to whatever's currently loaded. Runs
  // again whenever the year filter changes `tracks`.
  useEffect(() => {
    if (!map) return;

    const setup = () => {
      const data: FeatureCollection<LineString, { id: string }> = {
        type: "FeatureCollection",
        features: tracks.map((t) => ({
          type: "Feature",
          properties: { id: t.id },
          geometry: t.geom,
        })),
      };

      const src = map.getSource(TRACKS_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        map.addSource(TRACKS_SOURCE, { type: "geojson", data });
        map.addLayer({
          id: TRACKS_SOURCE,
          type: "line",
          source: TRACKS_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": TRACK_COLOR, "line-width": 2, "line-opacity": 0.75 },
        });
      }

      const allCoords = tracks.flatMap((t) => t.geom.coordinates as [number, number][]);
      const first = allCoords[0];
      if (!first) return; // No tracks -- leave the default Michigan-wide view, caller shows an overlay.

      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(first, first),
      );
      map.fitBounds(bounds, { padding: 32, maxZoom: 14, duration: 0 });
    };

    if (map.loaded()) setup();
    else map.once("load", setup);
  }, [map, tracks]);

  return (
    <BaseMap
      onMap={(m) => {
        setMap(m);
        onMap?.(m);
      }}
      className={className ?? "h-full w-full"}
    />
  );
}
