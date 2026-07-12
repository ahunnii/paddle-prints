/**
 * The community Map tab. Mirrors apps/web/src/components/map/community-map-client.tsx, adapted to
 * MapLibre React Native:
 *   - all saved route lines (routes.listGeoms) as a thin river-blue GeoJSON line layer; tapping one
 *     opens a bottom card with its name + distance. (A route-detail screen doesn't exist on mobile
 *     yet, so there's no "View" navigation -- flagged for the parity phase.)
 *   - viewport POIs (pois.inBbox, keyed off the debounced region bbox) as emoji-pill ViewAnnotations;
 *     tapping one opens a card with label / note / creator / date and a Delete action.
 *   - live presence (presence.list, polled every 60s, self excluded) as name-pill ViewAnnotations.
 *   - a floating "+" that enters a placement mode: a center crosshair + category chips + optional
 *     note; Save reads the map center (mapRef.getCenter) and calls pois.create.
 *
 * MLRN v11 findings used here (verified in node_modules/@maplibre/maplibre-react-native/src):
 *   - Region events: <Map onRegionDidChange> -> e.nativeEvent.bounds = [w, s, e, n] (wired in BaseMap).
 *   - Hit-testing: <GeoJSONSource onPress> bubbles e.nativeEvent.features (PressEventWithFeatures) --
 *     no manual queryRenderedFeatures needed for the route lines.
 *   - Camera read: mapRef.current.getCenter() returns Promise<LngLat> ([lng, lat]) for placement save.
 *   - ViewAnnotation: arbitrary RN child anchored to lngLat, with its own onPress (used for POIs).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
  type MapRef,
  type PressEventWithFeatures,
} from "@maplibre/maplibre-react-native";
import type { FeatureCollection, LineString } from "geojson";

import { BaseMap, type Bbox } from "../../components/map/base-map";
import { PoiPill } from "../../components/map/poi-pill";
import { authClient } from "../../lib/auth-client";
import { formatDateTime, formatDistanceMi } from "../../lib/format";
import {
  pendingPoiStore,
  savePoiQueued,
  type PendingRow,
  type PoiInput,
} from "../../lib/offline/sync";
import { POI_CATEGORIES, poiMeta, type PoiCategory } from "../../lib/pois";
import { api, type RouterOutputs } from "../../lib/trpc";

type PoiItem = RouterOutputs["pois"]["inBbox"][number];

/**
 * POIs queued on this device but not yet on the server. Polled on focus + every 5s while pending, and
 * refreshed explicitly right after a queued save. Mirrors web's `pendingPois` liveQuery merge in
 * community-map-client.tsx -- the difference is native has no reactive query, so we poll lightly.
 */
function usePendingPois() {
  const [rows, setRows] = useState<PendingRow<PoiInput>[]>([]);

  const refresh = useCallback(() => {
    pendingPoiStore
      .toArray()
      .then(setRows)
      .catch(() => {
        // Best-effort local read; a transient failure just means no pending pins this tick.
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (rows.length === 0) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [rows.length, refresh]);

  return { rows, refresh };
}

const ROUTE_LINE_COLOR = "#4fb0cd"; // river-400

interface SelectedRoute {
  id: string;
  name: string;
  distanceM: number | null;
}

export default function MapScreen() {
  const { data: session } = authClient.useSession();
  const selfId = session?.user.id;
  const router = useRouter();

  const mapRef = useRef<MapRef>(null);
  const utils = api.useUtils();

  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<SelectedRoute | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<PoiItem | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeCategory, setPlaceCategory] = useState<PoiCategory>("hazard");
  const [placeNote, setPlaceNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const { rows: pendingPoiRows, refresh: refreshPendingPois } = usePendingPois();

  const routesQuery = api.routes.listGeoms.useQuery();
  // routes.listGeoms carries geometry but not distance; routes.list carries the stored distance.
  const routeMetaQuery = api.routes.list.useQuery();
  const poisQuery = api.pois.inBbox.useQuery(
    bbox
      ? { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }
      : { west: 0, south: 0, east: 0, north: 0 },
    { enabled: !!bbox },
  );
  const presenceQuery = api.presence.list.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const deletePoi = api.pois.delete.useMutation();

  // Auto-dismiss the small "saved" confirmation pill after a beat.
  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 2500);
    return () => clearTimeout(t);
  }, [confirmation]);

  const routeFeatures = useMemo<
    FeatureCollection<LineString, { id: string; name: string }>
  >(
    () => ({
      type: "FeatureCollection",
      features: (routesQuery.data ?? []).map((r) => ({
        type: "Feature",
        properties: { id: r.id, name: r.name },
        geometry: r.geom,
      })),
    }),
    [routesQuery.data],
  );

  const distanceById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of routeMetaQuery.data ?? []) m.set(r.id, r.distanceM);
    return m;
  }, [routeMetaQuery.data]);

  const pois = poisQuery.data ?? [];
  // Pending POIs not yet reflected by the server query -- drawn as translucent pins so the user sees
  // their spot immediately, offline included (community-map-client.tsx does the same on web).
  const serverPoiIds = new Set(pois.map((p) => p.id));
  const pendingPois = pendingPoiRows.filter((row) => !serverPoiIds.has(row.id));
  const presenceRows = (presenceQuery.data ?? []).filter(
    (row) => row.userId !== selfId,
  );

  const closeSheets = () => {
    setSelectedRoute(null);
    setSelectedPoi(null);
  };

  const handleRoutePress = (
    event: NativeSyntheticEvent<PressEventWithFeatures>,
  ) => {
    const feature = event.nativeEvent.features?.[0];
    const id = feature?.properties?.id as string | undefined;
    if (!id) return;
    closeSheets();
    setSelectedRoute({
      id,
      name: (feature?.properties?.name as string | undefined) ?? "Route",
      distanceM: distanceById.get(id) ?? null,
    });
  };

  const openPlacement = () => {
    closeSheets();
    setPlaceCategory("hazard");
    setPlaceNote("");
    setPlacing(true);
  };

  const handleSave = async () => {
    const center = await mapRef.current?.getCenter();
    if (!center) return;
    const note = placeNote.trim();
    setSaving(true);
    try {
      // Queue-first, offline-safe: savePoiQueued writes the spot to SQLite, tries one immediate drain,
      // and reports whether it reached the server. The server dedupes by client uuid, so this can
      // never duplicate on a retry.
      const status = await savePoiQueued({
        category: placeCategory,
        note: note.length > 0 ? note : undefined,
        point: { lng: center[0], lat: center[1] },
      });
      if (status === "synced") {
        void utils.pois.inBbox.invalidate();
        setConfirmation("Spot saved");
      } else {
        // Still queued (offline / send failed) -- surface it as a translucent pending pin right away.
        refreshPendingPois();
        setConfirmation("Saved offline — will sync when online");
      }
      setPlacing(false);
      setPlaceNote("");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (poi: PoiItem) => {
    Alert.alert("Delete this spot?", "This removes it for everyone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          deletePoi.mutate(
            { id: poi.id },
            {
              onSuccess: () => {
                void utils.pois.inBbox.invalidate();
                setSelectedPoi(null);
              },
            },
          ),
      },
    ]);
  };

  const overlayHidden = placing || !!selectedRoute || !!selectedPoi;

  return (
    <View className="flex-1 bg-river-50">
      <BaseMap mapRef={mapRef} onRegionChange={setBbox}>
        {routeFeatures.features.length > 0 ? (
          <GeoJSONSource
            id="community-route-lines"
            data={routeFeatures}
            onPress={handleRoutePress}
          >
            <Layer
              id="community-route-lines"
              type="line"
              paint={{
                "line-color": ROUTE_LINE_COLOR,
                "line-width": 2,
                "line-opacity": 0.85,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </GeoJSONSource>
        ) : null}

        {pois.map((poi) => {
          const meta = poiMeta(poi.category);
          const lng = poi.geom.coordinates[0]!;
          const lat = poi.geom.coordinates[1]!;
          return (
            <ViewAnnotation
              key={poi.id}
              id={`poi-${poi.id}`}
              lngLat={[lng, lat]}
              anchor="center"
              onPress={() => {
                closeSheets();
                setSelectedPoi(poi);
              }}
            >
              <PoiPill emoji={meta.emoji} color={meta.color} />
            </ViewAnnotation>
          );
        })}

        {pendingPois.map((row) => {
          const meta = poiMeta(row.input.category);
          return (
            <ViewAnnotation
              key={`pending-${row.id}`}
              id={`pending-poi-${row.id}`}
              lngLat={[row.input.point.lng, row.input.point.lat]}
              anchor="center"
            >
              {/* Translucent so it reads as "not yet synced" and can't be tapped like a saved spot. */}
              <View style={{ opacity: 0.6 }} pointerEvents="none">
                <PoiPill emoji={meta.emoji} color={meta.color} />
              </View>
            </ViewAnnotation>
          );
        })}

        {presenceRows.map((row) => {
          const lng = row.geom.coordinates[0]!;
          const lat = row.geom.coordinates[1]!;
          return (
            <ViewAnnotation
              key={row.userId}
              id={`presence-${row.userId}`}
              lngLat={[lng, lat]}
              anchor="center"
            >
              <View className="flex-row items-center gap-1 rounded-full border border-river-400 bg-white px-2 py-1">
                <Text style={{ fontSize: 13 }}>🏄</Text>
                <Text
                  className="text-xs font-bold text-river-800"
                  numberOfLines={1}
                >
                  {row.name}
                </Text>
              </View>
            </ViewAnnotation>
          );
        })}
      </BaseMap>

      {/* Transient "spot saved / saved offline" confirmation pill. */}
      {confirmation ? (
        <View
          pointerEvents="none"
          className="absolute inset-x-0 top-4 items-center"
        >
          <View className="rounded-full bg-river-900 px-4 py-2 shadow-lg" style={{ elevation: 6 }}>
            <Text className="text-sm font-semibold text-white">{confirmation}</Text>
          </View>
        </View>
      ) : null}

      {/* Placement crosshair, centered over the map. */}
      {placing ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center"
        >
          <View className="h-11 w-11 items-center justify-center rounded-full border-2 border-sunset-500 bg-white/70">
            <Ionicons name="add" size={26} color="#f97316" />
          </View>
        </View>
      ) : null}

      {/* Route card */}
      {selectedRoute ? (
        <View
          className="absolute inset-x-4 bottom-6 rounded-2xl bg-white p-4 shadow-lg"
          style={{ elevation: 6 }}
        >
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-base font-bold text-river-950">
                {selectedRoute.name}
              </Text>
              {selectedRoute.distanceM != null ? (
                <Text className="mt-0.5 text-sm text-river-600">
                  {formatDistanceMi(selectedRoute.distanceM)}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => setSelectedRoute(null)}
              hitSlop={8}
              className="p-1"
            >
              <Ionicons name="close" size={20} color="#4fb0cd" />
            </Pressable>
          </View>
          <Pressable
            onPress={() => router.push(`/routes/${selectedRoute.id}`)}
            className="mt-3 min-h-11 items-center justify-center rounded-xl bg-sunset-500"
          >
            <Text className="text-sm font-extrabold text-white">View route</Text>
          </Pressable>
        </View>
      ) : null}

      {/* POI card */}
      {selectedPoi ? (
        <View
          className="absolute inset-x-4 bottom-6 rounded-2xl bg-white p-4 shadow-lg"
          style={{ elevation: 6 }}
        >
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-base font-bold text-river-950">
                {poiMeta(selectedPoi.category).emoji}{" "}
                {poiMeta(selectedPoi.category).label}
              </Text>
              {selectedPoi.note ? (
                <Text className="mt-1 text-sm text-river-700">
                  {selectedPoi.note}
                </Text>
              ) : null}
              <Text className="mt-1 text-xs text-river-400">
                {selectedPoi.creatorName} ·{" "}
                {formatDateTime(new Date(selectedPoi.createdAt))}
              </Text>
            </View>
            <Pressable
              onPress={() => setSelectedPoi(null)}
              hitSlop={8}
              className="p-1"
            >
              <Ionicons name="close" size={20} color="#4fb0cd" />
            </Pressable>
          </View>
          <Pressable
            onPress={() => handleDelete(selectedPoi)}
            className="mt-3 min-h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50"
          >
            <Text className="text-sm font-semibold text-red-600">Delete</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Placement panel */}
      {placing ? (
        <View
          className="absolute inset-x-4 bottom-6 rounded-2xl bg-white p-4 shadow-lg"
          style={{ elevation: 6 }}
        >
          <Text className="text-base font-bold text-river-950">Add a spot</Text>
          <Text className="mt-0.5 text-xs text-river-500">
            Center the crosshair on the spot, pick a type, then save.
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-3 -mx-1"
            contentContainerClassName="gap-2 px-1"
          >
            {POI_CATEGORIES.map((cat) => {
              const active = cat.category === placeCategory;
              return (
                <Pressable
                  key={cat.category}
                  onPress={() => setPlaceCategory(cat.category)}
                  className={`flex-row items-center gap-1 rounded-full border px-3 py-2 ${
                    active
                      ? "border-river-400 bg-river-100"
                      : "border-river-200 bg-white"
                  }`}
                >
                  <Text style={{ fontSize: 14 }}>{cat.emoji}</Text>
                  <Text
                    className={`text-xs font-semibold ${
                      active ? "text-river-800" : "text-river-500"
                    }`}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextInput
            value={placeNote}
            onChangeText={setPlaceNote}
            placeholder="Add a note (optional)"
            placeholderTextColor="#88cde2"
            maxLength={280}
            className="mt-3 rounded-xl border border-river-200 bg-river-50 px-3 py-2.5 text-river-900"
          />

          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => setPlacing(false)}
              className="min-h-11 flex-1 items-center justify-center rounded-xl border border-river-200 bg-white"
            >
              <Text className="text-sm font-semibold text-river-600">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSave()}
              disabled={saving}
              className="min-h-11 flex-1 items-center justify-center rounded-xl bg-sunset-500"
              style={{ opacity: saving ? 0.6 : 1 }}
            >
              <Text className="text-sm font-extrabold text-white">
                {saving ? "Saving…" : "Save spot"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Floating add button */}
      {!overlayHidden ? (
        <Pressable
          onPress={openPlacement}
          className="absolute bottom-6 right-4 h-14 w-14 items-center justify-center rounded-full bg-sunset-500 shadow-lg"
          style={{ elevation: 6 }}
        >
          <Ionicons name="add" size={30} color="white" />
        </Pressable>
      ) : null}
    </View>
  );
}
