"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Position } from "geojson";

import type { FlowLeg } from "~/components/routes/flow-narration";

// Re-export so surfaces can import the leg type straight from the overlay if they prefer.
export type { FlowLeg };

const SOURCE_ID = "flow-arrows";
const ARROW_LAYER_ID = "flow-arrows-symbols";
const LINE_LAYER_ID = "flow-arrows-line";

// Same palette as the flow narration: downstream is river blue (primary), upstream is sunset
// orange (accent), unknown is a muted slate.
const DOWNSTREAM_COLOR = "#1f7796"; // river-600
const UPSTREAM_COLOR = "#f97316"; // sunset-500
const UNKNOWN_COLOR = "#94a3b8"; // slate-400

// Mean Earth radius in metres -- matches turf's default so the slice metres line up with the
// server-computed leg ranges (`rivers.route` / `routes.flowLegs`).
const EARTH_RADIUS_M = 6371008.8;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function haversineM(a: Position, b: Position): number {
  const lat1 = (a[1] ?? 0) * (Math.PI / 180);
  const lat2 = (b[1] ?? 0) * (Math.PI / 180);
  const dLat = lat2 - lat1;
  const dLng = ((b[0] ?? 0) - (a[0] ?? 0)) * (Math.PI / 180);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

function interp(a: Position, b: Position, t: number): Position {
  return [
    (a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * t,
    (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * t,
  ];
}

/**
 * Cut the sub-line of `coords` spanning the metre range [startM, endM], walking cumulative
 * geodesic distance along the vertices (a manual `lineSliceAlong` so we don't pull in another turf
 * dep). Returns fewer than 2 points when the range doesn't intersect the line.
 */
function sliceAlong(coords: Position[], startM: number, endM: number): Position[] {
  const out: Position[] = [];
  if (coords.length < 2 || endM <= startM) return out;

  let acc = 0;
  let started = false;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const segLen = haversineM(a, b);
    const segStart = acc;
    const segEnd = acc + segLen;
    acc = segEnd;

    if (segEnd <= startM) continue; // segment ends before the slice begins
    if (segStart >= endM) break; // segment starts after the slice ends

    if (!started) {
      const t = segLen > 0 ? (startM - segStart) / segLen : 0;
      out.push(interp(a, b, clamp01(t)));
      started = true;
    }

    if (segEnd >= endM) {
      const t = segLen > 0 ? (endM - segStart) / segLen : 1;
      out.push(interp(a, b, clamp01(t)));
      break;
    }
    out.push(b);
  }

  return out;
}

/** One sub-line feature per leg, each tagged with its flow `direction`. */
function buildFeatureCollection(
  geometry: LineString | null,
  legs: FlowLeg[] | null | undefined,
): FeatureCollection<LineString, { direction: FlowLeg["direction"] }> {
  const features: Feature<LineString, { direction: FlowLeg["direction"] }>[] = [];
  if (geometry && legs) {
    const coords = geometry.coordinates;
    for (const leg of legs) {
      const sliced = sliceAlong(coords, leg.startM, leg.endM);
      if (sliced.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { direction: leg.direction },
        geometry: { type: "LineString", coordinates: sliced },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

interface FlowArrowLayerProps {
  map: MapLibreMap | null;
  /** The oriented route line the legs are measured against (route order from its start). */
  geometry: LineString | null;
  /** Per-leg flow directions over metre ranges of `geometry`. Only river routes have these. */
  legs: FlowLeg[] | null | undefined;
}

/**
 * An imperative maplibre overlay (mirrors `PoiLayer`'s contract) that draws flow-direction arrows
 * along a river route: each `FlowLeg` is sliced out of `geometry` by its metre range and rendered
 * with line-following arrow glyphs. Downstream arrows follow the line; upstream legs rotate 180° so
 * the arrowhead points back against the path; unknown legs are dimmed. A faint tinted line under the
 * arrows reinforces the direction colour (downstream blue, upstream orange). Renders nothing itself.
 */
export function FlowArrowLayer({ map, geometry, legs }: FlowArrowLayerProps) {
  // Add-once / update-via-setData, gated on the style being ready. Re-runs when the geometry or
  // legs change; the source is only created on the first pass and patched thereafter.
  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    // Lift our tint + arrow layers to the very top. Host maps add their own route/track line
    // AFTER this overlay (React runs child effects before parent effects), and may re-add it later
    // (HMR, style reloads), so without this the arrows paint underneath the opaque route line and
    // are invisible. Idempotent + guarded: it no-ops once the arrow layer is already topmost, so the
    // persistent `idle` listener below settles immediately without a repaint loop.
    const raise = () => {
      if (cancelled) return;
      const layers = map.getStyle().layers;
      if (layers[layers.length - 1]?.id === ARROW_LAYER_ID) return; // already on top
      if (map.getLayer(LINE_LAYER_ID)) map.moveLayer(LINE_LAYER_ID);
      if (map.getLayer(ARROW_LAYER_ID)) map.moveLayer(ARROW_LAYER_ID);
    };

    const apply = () => {
      if (cancelled) return;
      const data = buildFeatureCollection(geometry, legs);

      const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        raise();
        return;
      }

      map.addSource(SOURCE_ID, { type: "geojson", data });

      // Thin translucent tint UNDER the arrows, coloured per direction.
      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 6,
          "line-opacity": [
            "match",
            ["get", "direction"],
            "unknown",
            0.12,
            0.22,
          ],
          "line-color": [
            "match",
            ["get", "direction"],
            "upstream",
            UPSTREAM_COLOR,
            "unknown",
            UNKNOWN_COLOR,
            DOWNSTREAM_COLOR,
          ],
        },
      });

      // Arrow glyphs following the line. The sprite arrow points along the line for downstream;
      // upstream legs flip 180°. Colour can't be applied to the non-SDF sprite icon, so DIRECTION
      // (not tint) carries the meaning -- the tinted line above supplies the colour cue.
      map.addLayer({
        id: ARROW_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "symbol-placement": "line",
          "icon-image": "arrow",
          "symbol-spacing": 60,
          "icon-allow-overlap": true,
          "icon-rotate": ["match", ["get", "direction"], "upstream", 180, 0],
          "icon-size": 1.4,
        },
        paint: {
          "icon-opacity": [
            "match",
            ["get", "direction"],
            "unknown",
            0.35,
            0.9,
          ],
        },
      });
    };

    // A ready source can be patched (setData) at any time; only the initial add needs the style
    // ready. Gating a source-update behind "load" (which fires once) would silently drop leg/geometry
    // changes that arrive later -- realistic in the route builder, where legs change per river query.
    if (map.getSource(SOURCE_ID) || map.isStyleLoaded()) apply();
    else map.once("load", apply);
    // Keep the arrows on top even if the host re-adds its route line later. `raise` no-ops once
    // they're topmost, so this listener settles without churning.
    map.on("idle", raise);

    return () => {
      cancelled = true;
      map.off("load", apply);
      map.off("idle", raise);
    };
  }, [map, geometry, legs]);

  // Tear down the source + layers on unmount (or when the map instance changes). Guarded because a
  // parent unmount may have already destroyed the map's style.
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        if (map.getLayer(ARROW_LAYER_ID)) map.removeLayer(ARROW_LAYER_ID);
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // Map/style already gone -- nothing to clean up.
      }
    };
  }, [map]);

  return null;
}
