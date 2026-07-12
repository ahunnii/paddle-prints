/**
 * The map shown in the record screen's live phase: the "nav" (dark) style, the route line (routed
 * paddles only), the live-position puck, the snapped-progress dot, and corridor safety POIs. Mirrors
 * apps/web/src/components/record/nav-map.tsx, adapted to MapLibre React Native:
 *   - the web build's marker-style setting (board vs. classic dot) is a web-only preference (no
 *     settings store on mobile yet) -- this always renders the classic glowing dot + heading wedge.
 *   - camera follow uses the v11 CameraRef.easeTo/jumpTo imperative API (verified in
 *     node_modules/@maplibre/maplibre-react-native/src/components/camera/Camera.tsx): `easeTo({
 *     center, duration })`, no separate "jump then ease" distinction needed since `duration: 0` gives
 *     an immediate cut.
 *   - user-gesture detection uses BaseMap's forwarded `onRegionWillChange` --
 *     `event.nativeEvent.userInteraction` is true only for a real pan/pinch/rotate (verified in
 *     .../components/map/Map.tsx's `ViewStateChangeEvent`); a programmatic easeTo/jumpTo never sets it,
 *     so this is the exact native equivalent of the web build's `originalEvent` check on `movestart`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
  type CameraRef,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import type { NativeSyntheticEvent } from "react-native";
import type { Feature, LineString } from "geojson";

import { BaseMap } from "./base-map";
import { PoiPill } from "./poi-pill";
import { poiMeta, type PoiCategory } from "../../lib/pois";

const ROUTE_LINE_COLOR = "#4fb0cd"; // river-400 -- readable on the near-black nav basemap
const SNAPPED_DOT_COLOR = "#4fb0cd"; // river-400
const PUCK_COLOR = "#f97316"; // sunset-500

export interface NavPoi {
  id: string;
  category: PoiCategory;
  lng: number;
  lat: number;
}

export interface NavMapProps {
  /** Route line to follow ([lng,lat] pairs), or null for a free paddle. */
  routeCoords: Array<[number, number]> | null;
  /** Latest GPS position (last accepted track point), or null before the first fix. */
  livePos: { lng: number; lat: number } | null;
  /** Last finite compass heading (degrees), or null. Rotates the puck's heading wedge. */
  headingDeg: number | null;
  /** Snapped-progress point along the route, shown only while on-route (caller filters offRoute). */
  snapped: { lng: number; lat: number } | null;
  /** Corridor safety POIs (already filtered to NAV_POI_CATEGORIES by the caller). */
  pois: NavPoi[];
}

/** The map shown while recording: route line, live position puck, snapped-progress dot, corridor POIs. */
export function NavMap({ routeCoords, livePos, headingDeg, snapped, pois }: NavMapProps) {
  const cameraRef = useRef<CameraRef>(null);
  // Follow mode keeps the camera centred on live GPS; a real user gesture breaks it until they
  // recenter via the ◎ button.
  const [follow, setFollow] = useState(true);
  const centeredOnce = useRef(false);

  const routeFeature = useMemo<Feature<LineString> | null>(() => {
    if (!routeCoords || routeCoords.length < 2) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: routeCoords },
    };
  }, [routeCoords]);

  // Camera follow: first fix snaps immediately at zoom 15; every fix after that eases over 600ms
  // while follow is on. Keyed on the actual coordinates so it only fires on a genuinely new fix.
  useEffect(() => {
    if (!livePos) return;
    if (!centeredOnce.current) {
      cameraRef.current?.easeTo({
        center: [livePos.lng, livePos.lat],
        zoom: 15,
        duration: 0,
      });
      centeredOnce.current = true;
    } else if (follow) {
      cameraRef.current?.easeTo({
        center: [livePos.lng, livePos.lat],
        duration: 600,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePos?.lng, livePos?.lat, follow]);

  const handleRegionWillChange = (
    event: NativeSyntheticEvent<ViewStateChangeEvent>,
  ) => {
    if (event.nativeEvent.userInteraction) setFollow(false);
  };

  const handleRecenter = () => {
    if (!livePos) return;
    cameraRef.current?.easeTo({ center: [livePos.lng, livePos.lat], duration: 500 });
    setFollow(true);
  };

  return (
    <View className="flex-1">
      <BaseMap
        variant="nav"
        cameraRef={cameraRef}
        onRegionWillChange={handleRegionWillChange}
      >
        {routeFeature ? (
          <GeoJSONSource id="nav-route-line" data={routeFeature}>
            <Layer
              id="nav-route-line"
              type="line"
              paint={{
                "line-color": ROUTE_LINE_COLOR,
                "line-width": 4,
                "line-opacity": 0.9,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </GeoJSONSource>
        ) : null}

        {pois.map((poi) => {
          const meta = poiMeta(poi.category);
          return (
            <ViewAnnotation
              key={poi.id}
              id={`nav-poi-${poi.id}`}
              lngLat={[poi.lng, poi.lat]}
              anchor="center"
            >
              <PoiPill emoji={meta.emoji} color={meta.color} size={30} />
            </ViewAnnotation>
          );
        })}

        {snapped ? (
          <ViewAnnotation
            id="nav-snapped-progress"
            lngLat={[snapped.lng, snapped.lat]}
            anchor="center"
          >
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: SNAPPED_DOT_COLOR,
                borderWidth: 1,
                borderColor: "#ffffff",
              }}
            />
          </ViewAnnotation>
        ) : null}

        {livePos ? (
          <ViewAnnotation
            id="nav-live-puck"
            lngLat={[livePos.lng, livePos.lat]}
            anchor="center"
          >
            <LivePuck headingDeg={headingDeg} />
          </ViewAnnotation>
        ) : null}
      </BaseMap>

      {!follow && livePos ? (
        <Pressable
          onPress={handleRecenter}
          accessibilityLabel="Recenter on my position"
          className="absolute bottom-3 right-3 h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-lg"
          style={{ elevation: 4 }}
        >
          <Text className="text-xl text-river-950">◎</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Sunset-orange dot with a soft glow halo and a white ring; rotates a small heading wedge when a
 * finite heading is available. Classic-dot style only -- the web build's board-marker preference is a
 * web-only settings option with no mobile equivalent yet. */
function LivePuck({ headingDeg }: { headingDeg: number | null }) {
  const showWedge = headingDeg != null && Number.isFinite(headingDeg);
  return (
    <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
      {showWedge ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 40,
            height: 40,
            alignItems: "center",
            transform: [{ rotate: `${headingDeg}deg` }],
          }}
        >
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 6,
              borderRightWidth: 6,
              borderBottomWidth: 9,
              borderLeftColor: "transparent",
              borderRightColor: "transparent",
              borderBottomColor: PUCK_COLOR,
            }}
          />
        </View>
      ) : null}
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: "rgba(249,115,22,0.28)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: PUCK_COLOR,
            borderWidth: 2,
            borderColor: "#ffffff",
          }}
        />
      </View>
    </View>
  );
}
