/**
 * The shared MapLibre base map: loads the vendored style (via getMapStyle), frames Michigan, clamps
 * panning to a loose Great-Lakes bounding box, enables native attribution with the custom string,
 * and forwards arbitrary children (sources / layers / annotations). Kept deliberately generic so the
 * community map, the future nav map, and route-detail maps can all reuse it.
 *
 * MLRN v11 API notes (verified against node_modules/@maplibre/maplibre-react-native/src):
 *   - <Map mapStyle={StyleSpecification}>            -- accepts a raw style JSON object.
 *   - onRegionDidChange(e)                           -- fires after a pan/zoom settles;
 *                                                       e.nativeEvent.bounds is [west, south, east, north].
 *   - attribution / attributionPosition              -- the custom string comes from the style's
 *                                                       source `attribution` field (set in getMapStyle).
 *   - <Camera initialViewState maxBounds minZoom>    -- initial framing + pan clamp.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  Camera,
  Map,
  type CameraRef,
  type MapProps,
  type MapRef,
  type StyleSpecification,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import type { NativeSyntheticEvent } from "react-native";

import { getMapStyle, type MapStyleVariant } from "../../lib/map/style";

/** Michigan-wide default framing, mirrored from apps/web/src/components/map/base-map.tsx. */
const MICHIGAN_CENTER: [number, number] = [-84.9, 44.3];
const MICHIGAN_ZOOM = 6.5;
/** Loose bounding box around Michigan and the surrounding Great Lakes: [west, south, east, north]. */
const MICHIGAN_MAX_BOUNDS: [number, number, number, number] = [-91, 40.5, -79, 49];
const MIN_ZOOM = 5;

/** Viewport bbox in [west, south, east, north] order (matches the tRPC inBbox input fields). */
export type Bbox = [west: number, south: number, east: number, north: number];

export interface BaseMapProps {
  /** Which vendored style to load. Defaults to the primary community map style. */
  variant?: MapStyleVariant;
  /** Initial camera center. Defaults to a Michigan-wide view. */
  center?: [number, number];
  /** Initial camera zoom. Defaults to a Michigan-wide view. */
  zoom?: number;
  /** Debounced (300ms) viewport bbox, fired after the region settles. */
  onRegionChange?: (bbox: Bbox) => void;
  /** Map press handler (bubbles feature presses from child sources). */
  onPress?: MapProps["onPress"];
  /** Ref to the underlying Map (for getCenter / queryRenderedFeatures). */
  mapRef?: Ref<MapRef>;
  /** Ref to the Camera (for programmatic easeTo / fitBounds). */
  cameraRef?: Ref<CameraRef>;
  /** Sources / layers / annotations rendered inside the map. */
  children?: ReactNode;
}

export function BaseMap({
  variant = "default",
  center = MICHIGAN_CENTER,
  zoom = MICHIGAN_ZOOM,
  onRegionChange,
  onPress,
  mapRef,
  cameraRef,
  children,
}: BaseMapProps) {
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionChangeRef = useRef(onRegionChange);
  onRegionChangeRef.current = onRegionChange;

  useEffect(() => {
    let cancelled = false;
    getMapStyle(variant)
      .then((s) => {
        if (!cancelled) setStyle(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load the map");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [variant]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleRegionDidChange = (
    event: NativeSyntheticEvent<ViewStateChangeEvent>,
  ) => {
    if (!onRegionChangeRef.current) return;
    const bounds = event.nativeEvent.bounds;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onRegionChangeRef.current?.(bounds);
    }, 300);
  };

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-river-100 px-6">
        <Text className="text-center text-river-700">{error}</Text>
      </View>
    );
  }

  if (!style) {
    return (
      <View className="flex-1 items-center justify-center bg-river-100">
        <ActivityIndicator size="large" color="#1f7796" />
      </View>
    );
  }

  return (
    <Map
      ref={mapRef}
      mapStyle={style}
      style={{ flex: 1 }}
      onRegionDidChange={handleRegionDidChange}
      onPress={onPress}
      logo={false}
      attribution
      attributionPosition={{ bottom: 8, left: 8 }}
      compass
      compassPosition={{ top: 8, right: 8 }}
    >
      <Camera
        ref={cameraRef}
        initialViewState={{ center, zoom }}
        maxBounds={MICHIGAN_MAX_BOUNDS}
        minZoom={MIN_ZOOM}
      />
      {children}
    </Map>
  );
}
