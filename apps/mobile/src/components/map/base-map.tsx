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
 *   - <Camera ref>.easeTo/jumpTo/flyTo/fitBounds/zoomTo -- imperative CameraRef methods (all via a
 *                                                       shared native `setStop`); `fitBounds(bounds,
 *                                                       { padding, duration })` takes the same flat
 *                                                       [w,s,e,n] tuple as `Bbox` below.
 *   - onRegionWillChange(e)                          -- fires before a region change starts;
 *                                                       `e.nativeEvent.userInteraction` is true only
 *                                                       for a real pan/pinch/rotate gesture, false for
 *                                                       a programmatic camera move -- the only
 *                                                       supported way to detect "the user grabbed the
 *                                                       map" (there is no separate onDrag event).
 *
 * `onStyleLoaded` is this file's own addition (not an MLRN API): style loading is an async fetch, so
 * `cameraRef` isn't attached to anything until the style resolves and <Camera> actually mounts. A
 * caller that wants to fitBounds() right after mount (the paddle-detail screen) needs to know when
 * that's safe to do.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
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
  /**
   * Raw passthrough of the Map's onRegionWillChange, undebounced. `event.nativeEvent.userInteraction`
   * distinguishes a real pan/pinch gesture from a programmatic camera move -- used by the nav map to
   * break follow mode only on genuine user gestures.
   */
  onRegionWillChange?: MapProps["onRegionWillChange"];
  /** Map press handler (bubbles feature presses from child sources). */
  onPress?: MapProps["onPress"];
  /**
   * Fires once the NATIVE map has finished loading (MLRN's onDidFinishLoadingMap) -- i.e. the map is
   * laid out and camera commands will actually take effect. A caller that wants to call
   * `cameraRef.current.fitBounds(...)` right after mount must wait for this; calling it after only
   * the JS style fetch resolves is a silent no-op because the native view isn't ready yet.
   */
  onStyleLoaded?: () => void;
  /** Ref to the underlying Map (for getCenter / queryRenderedFeatures). */
  mapRef?: Ref<MapRef>;
  /** Ref to the Camera (for programmatic easeTo / fitBounds). */
  cameraRef?: Ref<CameraRef>;
  /**
   * Absolute `file://` URI of a downloaded per-trip `.pmtiles` archive. When set, the style loads
   * fully offline (local tiles + local glyphs/sprite) instead of hitting the tile/style servers.
   */
  offlineTripPath?: string;
  /** Sources / layers / annotations rendered inside the map. */
  children?: ReactNode;
}

export function BaseMap({
  variant = "default",
  center = MICHIGAN_CENTER,
  zoom = MICHIGAN_ZOOM,
  onRegionChange,
  onRegionWillChange,
  onPress,
  onStyleLoaded,
  mapRef,
  cameraRef,
  offlineTripPath,
  children,
}: BaseMapProps) {
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tab screens stay mounted, so a failed style load would otherwise be permanent; bumping this
  // re-runs the load effect (the retry button below).
  const [loadAttempt, setLoadAttempt] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionChangeRef = useRef(onRegionChange);
  onRegionChangeRef.current = onRegionChange;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getMapStyle(variant, { offlineTripPath })
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
  }, [variant, loadAttempt, offlineTripPath]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const onStyleLoadedRef = useRef(onStyleLoaded);
  onStyleLoadedRef.current = onStyleLoaded;

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
      <View className="flex-1 items-center justify-center gap-4 bg-river-100 px-6">
        <Text className="text-center text-river-700">{error}</Text>
        <Pressable
          onPress={() => setLoadAttempt((n) => n + 1)}
          className="rounded-full bg-sunset-500 px-5 py-2.5"
        >
          <Text className="font-semibold text-white">Try again</Text>
        </Pressable>
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
      onRegionWillChange={onRegionWillChange}
      onDidFinishLoadingMap={() => onStyleLoadedRef.current?.()}
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
