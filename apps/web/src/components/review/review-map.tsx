"use client";

/**
 * The "Paddle in Review" overview map: every track in the current filter drawn as a white-cased
 * sunset-orange line, framed to whatever's on screen. When the filter narrows to a single track
 * (e.g. one paddle in a given year) the casing plus a zoom-interpolated line width and a tighter
 * fit make that lone track visible without the user having to manually zoom in, and a pair of
 * start/end circle markers pin down where it began and ended. Unlike PaddleMap/RouteMap this
 * otherwise never places start/end markers -- with dozens of overlapping tracks they'd just be
 * noise.
 */
import { useEffect, useState } from "react";
import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";

import { BaseMap } from "~/components/map/base-map";

export interface ReviewTrack {
  id: string;
  geom: LineString;
}

const TRACKS_SOURCE = "review-track-lines";
const TRACK_CASING_LAYER = "review-track-line-casing";
const TRACK_LINE_LAYER = "review-track-line";
const ENDPOINTS_SOURCE = "review-track-endpoints";
const ENDPOINTS_LAYER = "review-track-endpoint-markers";
const TRACK_COLOR = "#f97316"; // sunset-500
const TRACK_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  3,
  12,
  5,
  16,
  7,
];
// The white casing must stay ~3px wider than the colored line at every zoom, else it vanishes
// under the line -- which happened precisely in the single-track case (fitted at maxZoom 15, where
// the line is ~6.5px, a fixed 6px casing was fully covered).
const CASING_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  6,
  12,
  8,
  16,
  10,
];

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
        // Casing goes in first so the colored line renders on top of it.
        map.addLayer({
          id: TRACK_CASING_LAYER,
          type: "line",
          source: TRACKS_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": CASING_WIDTH, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: TRACK_LINE_LAYER,
          type: "line",
          source: TRACKS_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": TRACK_COLOR, "line-width": TRACK_WIDTH, "line-opacity": 0.95 },
        });
      }

      // Start/end markers only make sense when exactly one track is on screen. Always setData
      // (with an empty collection otherwise) rather than adding/removing the layer so re-renders
      // from the year filter can't leave stale markers behind.
      const single = tracks.length === 1 ? tracks[0] : undefined;
      const endpointFeatures: FeatureCollection<Point, { kind: "start" | "end" }>["features"] =
        [];
      if (single) {
        const coords = single.geom.coordinates as [number, number][];
        const startCoord = coords[0];
        const endCoord = coords[coords.length - 1];
        if (startCoord && endCoord) {
          endpointFeatures.push(
            {
              type: "Feature",
              properties: { kind: "start" },
              geometry: { type: "Point", coordinates: startCoord },
            },
            {
              type: "Feature",
              properties: { kind: "end" },
              geometry: { type: "Point", coordinates: endCoord },
            },
          );
        }
      }
      const endpointData: FeatureCollection<Point, { kind: "start" | "end" }> = {
        type: "FeatureCollection",
        features: endpointFeatures,
      };

      const endpointsSrc = map.getSource(ENDPOINTS_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (endpointsSrc) {
        endpointsSrc.setData(endpointData);
      } else {
        map.addSource(ENDPOINTS_SOURCE, { type: "geojson", data: endpointData });
        map.addLayer({
          id: ENDPOINTS_LAYER,
          type: "circle",
          source: ENDPOINTS_SOURCE,
          paint: {
            "circle-radius": 6,
            "circle-color": [
              "match",
              ["get", "kind"],
              "start",
              "#10b981",
              "end",
              "#ef4444",
              "#10b981",
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      }

      const allCoords = tracks.flatMap((t) => t.geom.coordinates as [number, number][]);
      const first = allCoords[0];
      if (!first) return; // No tracks -- leave the default Michigan-wide view, caller shows an overlay.

      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(first, first),
      );
      map.fitBounds(
        bounds,
        tracks.length === 1
          ? { padding: 48, maxZoom: 15, duration: 0 }
          : { padding: 32, maxZoom: 14, duration: 0 },
      );
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
