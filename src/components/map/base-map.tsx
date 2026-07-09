"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  type LngLatBoundsLike,
  type LngLatLike,
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { getTilesUrl, registerPmtilesProtocol } from "~/lib/map/protocol";

const MICHIGAN_CENTER: LngLatLike = [-84.9, 44.3];
const MICHIGAN_ZOOM = 6.5;

// Loose bounding box around Michigan and the surrounding Great Lakes.
const MICHIGAN_BOUNDS: LngLatBoundsLike = [
  [-91, 40.5],
  [-79, 49],
];

interface BaseMapProps {
  /** Which vendored style to load. Defaults to the primary map style. */
  styleUrl?: string;
  className?: string;
  /** Called once the map instance has been created. */
  onMap?: (map: MapLibreMap) => void;
  /** Initial map center. Defaults to a Michigan-wide view. */
  center?: LngLatLike;
  /** Initial map zoom. Defaults to a Michigan-wide view. */
  zoom?: number;
}

export function BaseMap({
  styleUrl = "/map/style.json",
  className,
  onMap,
  center = MICHIGAN_CENTER,
  zoom = MICHIGAN_ZOOM,
}: BaseMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onMapRef = useRef(onMap);
  onMapRef.current = onMap;
  // Captured once at mount time via refs -- changing `center`/`zoom` on a re-render should not
  // recreate or re-fly the map (same pattern as `onMapRef` above).
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    registerPmtilesProtocol();

    let cancelled = false;
    let map: MapLibreMap | null = null;

    void (async () => {
      const res = await fetch(styleUrl);
      const style = (await res.json()) as StyleSpecification;

      const source = style.sources.openmaptiles;
      if (source && source.type === "vector" && "url" in source) {
        source.url = `pmtiles://${getTilesUrl()}`;
      }

      // maplibre-gl requires sprite/glyphs URLs to be fully absolute; the
      // vendored style.json intentionally ships root-relative paths so it
      // stays portable. Resolve them against the current origin with plain
      // string concatenation (not the URL constructor, which would percent
      // -encode the `{fontstack}`/`{range}` template placeholders in the
      // glyphs URL).
      if (typeof style.sprite === "string" && style.sprite.startsWith("/")) {
        style.sprite = window.location.origin + style.sprite;
      }
      if (style.glyphs?.startsWith("/")) {
        style.glyphs = window.location.origin + style.glyphs;
      }

      if (cancelled) return;

      map = new maplibregl.Map({
        container,
        style,
        center: centerRef.current,
        zoom: zoomRef.current,
        maxBounds: MICHIGAN_BOUNDS,
        attributionControl: false,
      });

      map.addControl(
        new maplibregl.AttributionControl({
          customAttribution:
            "© OpenStreetMap contributors © OpenMapTiles",
        }),
      );
      map.addControl(new maplibregl.NavigationControl(), "top-right");

      if (cancelled) {
        map.remove();
        return;
      }

      onMapRef.current?.(map);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [styleUrl]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
}
