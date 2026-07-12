/**
 * The paddle detail screen: the recorded track over the planned route (if any), start/end dots, stats,
 * and the trip note. Mirrors apps/web/src/components/paddles/paddle-summary-resilient.tsx (the map
 * layering/coloring, the stat cells, and the owner-only note-edit flow) minus the web build's offline
 * queue fallback -- the mobile app has no local paddle queue yet, so this reads straight from
 * `paddles.byId` and shows a simple error state if that fails.
 *
 * Routed at (app)/paddles/[id] so it participates in the same Tabs navigator as the four primary tabs
 * (session gate, providers, etc. all live above that layout); its `Tabs.Screen` entry in
 * (app)/_layout.tsx sets `href: null` to keep it out of the tab bar, and `headerShown: false` because
 * this screen renders its own back button over the map instead of the Tabs default header.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
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
import { authClient } from "../../../lib/auth-client";
import {
  formatClock,
  formatDateTime,
  formatDistanceMi,
  formatSpeedMph,
} from "../../../lib/format";
import { boundsOf } from "../../../lib/geo";
import { api } from "../../../lib/trpc";

const ROUTE_COLOR = "#1f7796"; // river-600
const TRACK_COLOR = "#f97316"; // sunset-500

export default function PaddleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const paddleQuery = api.paddles.byId.useQuery(
    { id: id ?? "" },
    { enabled: !!id },
  );

  const cameraRef = useRef<CameraRef>(null);
  const [mapReady, setMapReady] = useState(false);

  const paddle = paddleQuery.data;

  const trackCoords = useMemo<Array<[number, number]> | null>(
    () =>
      paddle?.trackGeom?.coordinates.map((c) => [c[0], c[1]] as [number, number]) ??
      null,
    [paddle],
  );
  const routeCoords = useMemo<Array<[number, number]> | null>(
    () =>
      paddle?.routeGeom?.coordinates.map((c) => [c[0], c[1]] as [number, number]) ??
      null,
    [paddle],
  );
  // Frame to the recorded track when there is one; fall back to the planned route (e.g. a track that
  // failed to simplify to 2+ points but the paddle still references a route).
  const frame = trackCoords && trackCoords.length >= 2 ? trackCoords : routeCoords;

  const routeFeature = useMemo<Feature<LineString> | null>(() => {
    if (!routeCoords || routeCoords.length < 2) return null;
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoords } };
  }, [routeCoords]);
  const trackFeature = useMemo<Feature<LineString> | null>(() => {
    if (!trackCoords || trackCoords.length < 2) return null;
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trackCoords } };
  }, [trackCoords]);

  // Frame the camera to the track/route bbox once the style has loaded (cameraRef isn't attached to
  // anything until then -- see BaseMap's onStyleLoaded doc) and we have at least 2 distinct points; a
  // single-point "track" just gets centered at a reasonable zoom instead of a degenerate fitBounds.
  useEffect(() => {
    if (!mapReady || !frame || frame.length === 0) return;
    if (frame.length < 2) {
      cameraRef.current?.jumpTo({ center: frame[0]!, zoom: 14 });
      return;
    }
    cameraRef.current?.fitBounds(boundsOf(frame), {
      padding: { top: 56, right: 56, bottom: 56, left: 56 },
      duration: 0,
    });
  }, [mapReady, frame]);

  const first = frame?.[0] ?? null;
  const last = frame && frame.length > 1 ? frame[frame.length - 1]! : null;

  if (paddleQuery.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-river-50">
        <ActivityIndicator size="large" color="#1f7796" />
      </View>
    );
  }

  if (paddleQuery.isError || !paddle) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-river-50 px-6">
        <Text className="text-5xl">🛶</Text>
        <Text className="text-center text-river-700">
          {paddleQuery.error?.message ?? "Couldn't find that paddle."}
        </Text>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          className="rounded-full bg-sunset-500 px-5 py-2.5"
        >
          <Text className="font-semibold text-white">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isOwner = session?.user.id === paddle.userId;
  const avgMph = paddle.avgSpeedMps;

  return (
    <View className="flex-1 bg-river-50">
      <View className="h-[42%]">
        <BaseMap cameraRef={cameraRef} onStyleLoaded={() => setMapReady(true)}>
          {routeFeature ? (
            <GeoJSONSource id="paddle-route-line" data={routeFeature}>
              <Layer
                id="paddle-route-line"
                type="line"
                paint={{ "line-color": ROUTE_COLOR, "line-width": 4, "line-opacity": 0.6 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
            </GeoJSONSource>
          ) : null}

          {trackFeature ? (
            <GeoJSONSource id="paddle-track-line" data={trackFeature}>
              <Layer
                id="paddle-track-line"
                type="line"
                paint={{ "line-color": TRACK_COLOR, "line-width": 4 }}
                layout={{ "line-cap": "round", "line-join": "round" }}
              />
            </GeoJSONSource>
          ) : null}

          {first ? (
            <ViewAnnotation id="paddle-start" lngLat={first} anchor="center">
              <View className="h-4 w-4 rounded-full border-2 border-white bg-sunset-500" />
            </ViewAnnotation>
          ) : null}
          {last ? (
            <ViewAnnotation id="paddle-end" lngLat={last} anchor="center">
              <View className="h-4 w-4 rounded-full border-2 border-white bg-river-600" />
            </ViewAnnotation>
          ) : null}
        </BaseMap>

        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          accessibilityLabel="Back"
          className="absolute left-4 top-4 h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-lg"
          style={{ elevation: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color="#0d1f24" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text className="text-xl font-extrabold text-river-950">
            {paddle.userName ?? "Someone"} paddled{" "}
            {paddle.routeId && paddle.routeName ? paddle.routeName : "a quick start paddle"}
          </Text>
          <Text className="mt-0.5 text-sm text-river-600">
            {formatDateTime(new Date(paddle.startedAt))}
          </Text>
        </View>

        <View className="flex-row flex-wrap gap-x-4 gap-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <Cell label="Distance" value={formatDistanceMi(paddle.distanceM)} />
          <Cell label="Elapsed" value={formatClock(paddle.elapsedS)} />
          <Cell label="Moving" value={formatClock(paddle.movingS)} />
          <Cell label="Avg speed" value={formatSpeedMph(avgMph)} />
        </View>

        <PaddleNote id={paddle.id} note={paddle.note} isOwner={isOwner} />
      </ScrollView>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[45%] flex-1">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-400">
        {label}
      </Text>
      <Text className="text-xl font-extrabold tabular-nums text-river-900">{value}</Text>
    </View>
  );
}

/** The trip note: read-only for everyone, with an owner-only Edit toggle that swaps in a TextInput and
 * saves via `paddles.updateNote`. */
function PaddleNote({
  id,
  note,
  isOwner,
}: {
  id: string;
  note: string | null;
  isOwner: boolean;
}) {
  const utils = api.useUtils();
  const updateNote = api.paddles.updateNote.useMutation();

  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(note);
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      const row = await updateNote.mutateAsync({ id, note: draft.trim() });
      setDisplay(row.note);
      await utils.paddles.byId.invalidate({ id });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the note.");
    }
  }

  if (!display && !isOwner) return null;

  if (editing) {
    return (
      <View className="gap-2">
        <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
          Notes
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          numberOfLines={4}
          maxLength={2000}
          autoFocus
          placeholder="Conditions, wildlife, who came along…"
          placeholderTextColor="#88cde2"
          className="min-h-24 rounded-2xl border border-river-200 bg-white px-3 py-2 text-sm text-river-900"
        />
        {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => void handleSave()}
            disabled={updateNote.isPending}
            className="min-h-11 flex-1 items-center justify-center rounded-xl bg-sunset-500 disabled:opacity-60"
          >
            {updateNote.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-bold text-white">Save</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setDraft(display ?? "");
              setEditing(false);
              setError(null);
            }}
            disabled={updateNote.isPending}
            className="min-h-11 flex-1 items-center justify-center rounded-xl border border-river-200"
          >
            <Text className="font-semibold text-river-600">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-1">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
        Notes
      </Text>
      {display ? (
        <Text className="text-sm text-river-700">{display}</Text>
      ) : (
        <Text className="text-sm italic text-river-400">No notes yet.</Text>
      )}
      {isOwner ? (
        <Pressable
          onPress={() => {
            setDraft(display ?? "");
            setEditing(true);
          }}
          className="mt-1 self-start"
        >
          <Text className="text-sm font-semibold text-sunset-600">
            {display ? "Edit note" : "Add a note"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
