/**
 * The route detail screen: the route line over BaseMap, corridor POIs, stats, a personal pace/ETA
 * estimate, and the "Spots along the way" list. Mirrors apps/web/src/app/routes/[id]/page.tsx (map
 * layering/coloring, stat cells, YourPaceCard content) and
 * apps/web/src/components/routes/your-pace-card.tsx (the pace card itself, ported inline below since
 * it's only used here) -- minus the web build's download-for-offline button (offline is Phase 5) and
 * its route-builder edit affordance (route editing is web-only, same as creation).
 *
 * Routed at (app)/routes/[id] so it participates in the same Tabs navigator as the primary tabs; its
 * `Tabs.Screen` entry in (app)/_layout.tsx sets `href: null` to keep it out of the tab bar (see that
 * file's comment for why this file's nested-folder route name is "routes/[id]", not "routes/index").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import type { Feature, LineString } from "geojson";

import { BaseMap } from "../../../components/map/base-map";
import { LocateFab } from "../../../components/map/locate-fab";
import { PoiDetailCard } from "../../../components/map/poi-detail-card";
import { PoiPill } from "../../../components/map/poi-pill";
import { DifficultyBadge } from "../../../components/routes/difficulty-badge";
import { authClient } from "../../../lib/auth-client";
import { formatBytes, formatHM, formatRouteDistance } from "../../../lib/format";
import { boundsOf } from "../../../lib/geo";
import {
  deleteTrip,
  downloadTrip,
  getDownloadedTrip,
  type DownloadProgress,
  type OfflineTrip,
} from "../../../lib/offline/trips";
import { poiHeadline, poiMeta } from "../../../lib/pois";
import { api, type RouterOutputs } from "../../../lib/trpc";

const ROUTE_COLOR = "#1f7796"; // river-600
const START_COLOR = "#f97316"; // sunset-500
const END_COLOR = "#1e6079"; // river-800

const METERS_PER_MILE = 1609.344;
const MPH_PER_MPS = 2.2369363;

type RouteType = RouterOutputs["routes"]["byId"]["type"];
type RouteShape = RouterOutputs["routes"]["byId"]["shape"];
type EtaData = RouterOutputs["routes"]["etaForUser"];
type RoutePoi = RouterOutputs["routes"]["byId"]["pois"][number];

function typeLabel(type: RouteType) {
  return type === "waypoint" ? "🌊 Lake / open water" : "🏞️ River";
}

function shapeLabel(shape: RouteShape) {
  return shape === "out_and_back" ? "Out & back" : "One-way";
}

function sourceLabel(source: EtaData["source"], routeType: RouteType) {
  switch (source) {
    case "exact":
      return "Based on your paddles on this route";
    case "typeAvg":
      return `Based on your ${routeType === "river" ? "river" : "flat-water"} average`;
    case "default":
      return "Using the 3.0 mph default (paddle more!)";
  }
}

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const utils = api.useUtils();

  const routeQuery = api.routes.byId.useQuery({ id: id ?? "" }, { enabled: !!id });
  const etaQuery = api.routes.etaForUser.useQuery(
    { routeId: id ?? "" },
    { enabled: !!id },
  );
  const deleteRoute = api.routes.delete.useMutation();

  const cameraRef = useRef<CameraRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<RoutePoi | null>(null);

  const route = routeQuery.data;

  const routeCoords = useMemo<Array<[number, number]> | null>(
    () => route?.geom.coordinates.map((c) => [c[0], c[1]] as [number, number]) ?? null,
    [route],
  );

  const routeFeature = useMemo<Feature<LineString> | null>(() => {
    if (!routeCoords || routeCoords.length < 2) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: routeCoords },
    };
  }, [routeCoords]);

  // Frame the camera to the route bbox once the style has loaded (cameraRef isn't attached to
  // anything until then -- see BaseMap's onStyleLoaded doc).
  useEffect(() => {
    if (!mapReady || !routeCoords || routeCoords.length === 0) return;
    if (routeCoords.length < 2) {
      cameraRef.current?.jumpTo({ center: routeCoords[0]!, zoom: 14 });
      return;
    }
    cameraRef.current?.fitBounds(boundsOf(routeCoords), {
      padding: { top: 56, right: 56, bottom: 56, left: 56 },
      duration: 0,
    });
  }, [mapReady, routeCoords]);

  const first = routeCoords?.[0] ?? null;
  const last = routeCoords && routeCoords.length > 1 ? routeCoords[routeCoords.length - 1]! : null;

  const sortedPois = useMemo(
    () => [...(route?.pois ?? [])].sort((a, b) => a.routeDistM - b.routeDistM),
    [route],
  );

  function handleDelete() {
    if (!route) return;
    Alert.alert("Delete this route?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteRoute.mutate(
            { id: route.id },
            {
              onSuccess: async () => {
                await utils.routes.list.invalidate();
                router.replace("/routes");
              },
            },
          );
        },
      },
    ]);
  }

  if (routeQuery.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-river-50">
        <ActivityIndicator size="large" color="#1f7796" />
      </View>
    );
  }

  if (routeQuery.isError || !route) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-river-50 px-6">
        <Text className="text-5xl">🛶</Text>
        <Text className="text-center text-river-700">
          {routeQuery.error?.message ?? "Couldn't find that route."}
        </Text>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/routes"))}
          className="rounded-full bg-sunset-500 px-5 py-2.5"
        >
          <Text className="font-semibold text-white">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isOwner = session?.user.id === route.createdBy;

  return (
    <View className="flex-1 bg-river-50">
      <View className="h-[40%]">
        <BaseMap cameraRef={cameraRef} onStyleLoaded={() => setMapReady(true)}>
          {routeFeature ? (
            <GeoJSONSource id="route-detail-line" data={routeFeature}>
              <Layer
                id="route-detail-line"
                type="line"
                paint={{ "line-color": ROUTE_COLOR, "line-width": 4 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
            </GeoJSONSource>
          ) : null}

          {first ? (
            <ViewAnnotation id="route-detail-start" lngLat={first} anchor="center">
              <View className="h-4 w-4 rounded-full border-2 border-white bg-sunset-500" />
            </ViewAnnotation>
          ) : null}
          {last ? (
            <ViewAnnotation id="route-detail-end" lngLat={last} anchor="center">
              <View
                className="h-4 w-4 rounded-full border-2 border-white"
                style={{ backgroundColor: END_COLOR }}
              />
            </ViewAnnotation>
          ) : null}

          {sortedPois.map((poi) => {
            const meta = poiMeta(poi.category);
            const lng = poi.geom.coordinates[0]!;
            const lat = poi.geom.coordinates[1]!;
            return (
              <ViewAnnotation
                key={poi.id}
                id={`route-detail-poi-${poi.id}`}
                lngLat={[lng, lat]}
                anchor="center"
                onPress={() => setSelectedPoi(poi)}
              >
                <PoiPill emoji={meta.emoji} color={meta.color} />
              </ViewAnnotation>
            );
          })}
        </BaseMap>

        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/routes"))}
          accessibilityLabel="Back"
          className="absolute left-4 top-4 h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-lg"
          style={{ elevation: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color="#0d1f24" />
        </Pressable>

        {!selectedPoi ? <LocateFab cameraRef={cameraRef} /> : null}

        {selectedPoi ? (
          <PoiDetailCard poi={selectedPoi} onClose={() => setSelectedPoi(null)} />
        ) : null}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        <View>
          <View className="flex-row items-center gap-2">
            <Text className="text-xl font-extrabold text-river-950">{route.name}</Text>
            <DifficultyBadge difficulty={route.difficulty} />
          </View>
          <Text className="mt-0.5 text-sm text-river-600">
            {typeLabel(route.type)} · {shapeLabel(route.shape)}
          </Text>
          {route.description ? (
            <Text className="mt-2 text-sm text-river-700">{route.description}</Text>
          ) : null}
        </View>

        <View className="flex-row flex-wrap gap-x-4 gap-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <View className="min-w-[45%] flex-1">
            <Text className="text-xs font-bold uppercase tracking-widest text-river-400">
              Distance
            </Text>
            <Text className="text-xl font-extrabold tabular-nums text-river-900">
              {formatRouteDistance(route.distanceM, route.shape)}
            </Text>
          </View>
          <View className="min-w-[45%] flex-1">
            <Text className="text-xs font-bold uppercase tracking-widest text-river-400">
              Created
            </Text>
            <Text className="text-xl font-extrabold text-river-900">
              {route.creatorName}
            </Text>
            <Text className="text-xs text-river-500">
              {new Date(route.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {etaQuery.data ? (
          <YourPaceCard eta={etaQuery.data} shape={route.shape} routeType={route.type} />
        ) : etaQuery.isError ? (
          <Text className="text-xs text-river-400">
            Couldn&apos;t load your pace estimate.
          </Text>
        ) : (
          <View className="items-center rounded-2xl bg-river-50 p-4">
            <ActivityIndicator color="#1f7796" />
          </View>
        )}

        {route.shape === "out_and_back" ? (
          <Text className="text-xs text-river-600">
            Turns around at the far marker and retraces the same path back to the start.
          </Text>
        ) : null}

        <View>
          <Text className="mb-1 text-xs font-bold uppercase tracking-widest text-river-500">
            Spots along the way
          </Text>
          {sortedPois.length === 0 ? (
            <Text className="text-sm italic text-river-400">
              📍 No spots marked yet — drop one from the map while paddling
            </Text>
          ) : (
            <View className="gap-1.5">
              {sortedPois.map((poi) => (
                <Text key={poi.id} className="text-sm text-river-700">
                  <Text className="font-semibold">
                    {poiMeta(poi.category).emoji} {poiHeadline(poi)}
                  </Text>
                  <Text className="text-river-400">
                    {" "}
                    — {(poi.routeDistM / METERS_PER_MILE).toFixed(1)} mi in
                  </Text>
                </Text>
              ))}
            </View>
          )}
        </View>

        <View>
          <Text className="mb-1 text-xs font-bold uppercase tracking-widest text-river-500">
            Offline map
          </Text>
          <TripDownloadSection routeId={route.id} />
        </View>

        <View className="gap-2">
          <Pressable
            onPress={() => router.push(`/record?route=${route.id}`)}
            className="min-h-14 items-center justify-center rounded-2xl bg-sunset-500"
          >
            <Text className="text-lg font-bold text-white">Start paddle</Text>
          </Pressable>

          {isOwner ? (
            <Pressable
              onPress={handleDelete}
              disabled={deleteRoute.isPending}
              className="min-h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 disabled:opacity-60"
            >
              {deleteRoute.isPending ? (
                <ActivityIndicator color="#dc2626" />
              ) : (
                <Text className="font-semibold text-red-600">Delete route</Text>
              )}
            </Pressable>
          ) : null}

          {deleteRoute.isError ? (
            <Text className="text-center text-xs text-red-600">
              {deleteRoute.error.message}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * The "Download for offline" control. Mirrors web's DownloadTripButton
 * (apps/web/src/components/offline/download-trip-button.tsx): three states driven by local component
 * state (there's no Dexie liveQuery on mobile, so we set state after each action) --
 *   - downloading -> a progress bar with a live % and byte count
 *   - downloaded  -> a "Downloaded · X MB" badge + a "Remove" text button (Alert-confirmed)
 *   - otherwise   -> a sunset-outline "Download for offline" button
 * Downloading also pulls the shared style/glyph/sprite assets (via downloadTrip -> ensureOfflineMapAssets)
 * so the route renders with zero network while recording.
 */
function TripDownloadSection({ routeId }: { routeId: string }) {
  const [trip, setTrip] = useState<OfflineTrip | undefined>(() =>
    getDownloadedTrip(routeId),
  );
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setBusy(true);
    setProgress({ bytesWritten: 0, totalBytes: 0 });
    try {
      const record = await downloadTrip(routeId, setProgress);
      setTrip(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function handleRemove() {
    Alert.alert(
      "Remove offline map?",
      "You can download it again anytime.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            deleteTrip(routeId);
            setTrip(undefined);
          },
        },
      ],
    );
  }

  if (busy) {
    const pct =
      progress && progress.totalBytes > 0
        ? Math.round((progress.bytesWritten / progress.totalBytes) * 100)
        : 0;
    return (
      <View className="gap-1.5 rounded-2xl bg-river-100 p-3">
        <Text className="text-xs font-semibold text-river-700">
          Downloading… {pct}% · {formatBytes(progress?.bytesWritten ?? 0)}
        </Text>
        <View className="h-2 overflow-hidden rounded-full bg-river-200">
          <View
            className="h-full rounded-full bg-sunset-500"
            style={{ width: `${pct}%` }}
          />
        </View>
      </View>
    );
  }

  if (trip) {
    return (
      <View className="flex-row items-center justify-between gap-2 rounded-2xl bg-river-100 px-4 py-3">
        <Text className="font-semibold text-river-700">
          Downloaded · {formatBytes(trip.bytes)}
        </Text>
        <Pressable onPress={handleRemove} accessibilityRole="button">
          <Text className="font-semibold text-red-600">Remove</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-1">
      <Pressable
        onPress={() => void handleDownload()}
        className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-sunset-400 bg-sunset-50"
      >
        <Ionicons name="cloud-download-outline" size={18} color="#ea6a1f" />
        <Text className="font-semibold text-sunset-600">Download for offline</Text>
      </Pressable>
      <Text className="text-xs text-river-500">
        Saves this route&apos;s map to your device so it works with no signal.
      </Text>
      {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
    </View>
  );
}

/** The "Your pace" card: an honest, tiered ETA (see `routes.etaForUser`) plus the before-you-start
 * hook -- "Start now -> done by <clock time>". Ported from
 * apps/web/src/components/routes/your-pace-card.tsx; the clock line is why this recomputes on a
 * 60s interval instead of once at render. */
function YourPaceCard({
  eta,
  shape,
  routeType,
}: {
  eta: EtaData;
  shape: RouteShape;
  routeType: RouteType;
}) {
  const durationS =
    shape === "out_and_back" ? eta.estimates.roundTripS : eta.estimates.oneWayS;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const doneBy = new Date(now + durationS * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <View className="gap-2 rounded-2xl bg-river-50 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-wide text-river-500">Your pace</Text>
        <Text className="text-xs font-semibold tabular-nums text-river-600">
          {(eta.speedMps * MPH_PER_MPS).toFixed(1)} mph
        </Text>
      </View>

      <Text className="text-2xl font-extrabold tabular-nums text-river-950">
        {formatHM(durationS)}
        {shape === "out_and_back" ? (
          <Text className="text-sm font-medium text-river-500"> round trip</Text>
        ) : null}
      </Text>

      <Text className="text-xs text-river-600">{sourceLabel(eta.source, routeType)}</Text>

      <Text className="text-sm font-bold text-sunset-600">
        Start now → done by {doneBy}
      </Text>

      {eta.pastTimes && eta.pastTimes.length > 0 ? (
        <Text className="text-xs text-river-500">
          Your history here:{" "}
          {eta.pastTimes
            .map(
              (p) =>
                `${new Date(p.startedAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })} — ${formatHM(p.elapsedS)}`,
            )
            .join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}
