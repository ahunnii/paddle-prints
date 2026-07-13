/**
 * The "Paddle in Review" recap screen: year-scoped totals, a map of every track for that scope, a
 * couple of highlight records (longest / fastest / most-active-month), and a "Share" action that
 * captures an off-screen recap card and hands it to the OS share sheet. Reads `paddles.review`
 * (`{ years, totals, longest, fastest, mostActiveMonth, currentStreakWeeks, tracks }`).
 *
 * Routed at (app)/review so it participates in the same Tabs navigator as the primary tabs (reached
 * from Me's "🏆 Paddle in Review" row via router.push, not a tab-bar item); its `Tabs.Screen` entry in
 * (app)/_layout.tsx sets `href: null` + `headerShown: false`, same as paddles/[id] and routes/[id] --
 * this screen renders its own back button instead of the Tabs default header.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  GeoJSONSource,
  Layer,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import * as Sharing from "expo-sharing";
import type { FeatureCollection, LineString } from "geojson";
import { captureRef } from "react-native-view-shot";

import { BaseMap } from "../../components/map/base-map";
import {
  formatDateTime,
  formatDistanceMi,
  formatDuration,
  formatSpeedMph,
} from "../../lib/format";
import { boundsOf } from "../../lib/geo";
import { api, type RouterOutputs } from "../../lib/trpc";

const TRACK_COLOR = "#f97316"; // sunset-500

type ReviewData = RouterOutputs["paddles"]["review"];

/** "2026-07" -> "July 2026". Kept local to this screen -- format.ts has nothing that parses a
 * YYYY-MM key, and mostActiveMonth is the only place one shows up. */
function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default function ReviewScreen() {
  const router = useRouter();

  const [year, setYear] = useState<number | undefined>(undefined);
  const reviewQuery = api.paddles.review.useQuery({ year });
  const review: ReviewData | undefined = reviewQuery.data;

  const cameraRef = useRef<CameraRef>(null);
  const [mapReady, setMapReady] = useState(false);

  const tracks = review?.tracks ?? [];

  const trackFeatures = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: "FeatureCollection",
      features: (review?.tracks ?? []).map((t) => ({
        type: "Feature",
        properties: {},
        geometry: t.geom,
      })),
    }),
    [review],
  );

  const allCoords = useMemo<Array<[number, number]>>(() => {
    const coords: Array<[number, number]> = [];
    for (const t of review?.tracks ?? []) {
      for (const c of t.geom.coordinates) coords.push([c[0], c[1]] as [number, number]);
    }
    return coords;
  }, [review]);

  // Frame the camera to every track's combined bbox once the style has loaded (same gate as
  // paddles/[id].tsx / routes/[id].tsx -- cameraRef isn't attached to anything until BaseMap's
  // onStyleLoaded fires), and re-fit whenever switching years changes the track set. No fit (and no
  // attempt to jump/center) when there are zero tracks -- the "No paddles yet" overlay covers that.
  useEffect(() => {
    if (!mapReady || allCoords.length === 0) return;
    if (allCoords.length < 2) {
      cameraRef.current?.jumpTo({ center: allCoords[0]!, zoom: 12 });
      return;
    }
    cameraRef.current?.fitBounds(boundsOf(allCoords), {
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      duration: 0,
    });
  }, [mapReady, allCoords]);

  const shareCardRef = useRef<View>(null);
  const [shareState, setShareState] = useState<"idle" | "preparing">("idle");
  const [shareError, setShareError] = useState<string | null>(null);

  async function handleShare() {
    setShareError(null);
    setShareState("preparing");
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        setShareError("Sharing isn't available on this device.");
        return;
      }
      const uri = await captureRef(shareCardRef, { format: "png", quality: 1 });
      await Sharing.shareAsync(uri, { mimeType: "image/png" });
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Couldn't create the share image.",
      );
    } finally {
      setShareState("idle");
    }
  }

  const yearLabel = year ? String(year) : "All time";

  return (
    <View className="flex-1 bg-river-50">
      <ScrollView className="flex-1" contentContainerClassName="gap-6 p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/me")
              }
              accessibilityLabel="Back"
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm"
            >
              <Ionicons name="chevron-back" size={20} color="#0d1f24" />
            </Pressable>
            <Text className="text-2xl font-extrabold tracking-tight text-river-900">
              Paddle in Review
            </Text>
          </View>
          <Pressable
            onPress={() => void handleShare()}
            disabled={shareState === "preparing"}
            className="min-h-10 items-center justify-center rounded-full bg-sunset-500 px-4 disabled:opacity-60"
          >
            {shareState === "preparing" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-sm font-bold text-white">Share</Text>
            )}
          </Pressable>
        </View>

        {shareError ? (
          <Text className="-mt-4 text-xs text-red-600">{shareError}</Text>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-row items-center gap-2"
        >
          <YearPill
            label="All time"
            selected={year === undefined}
            onPress={() => setYear(undefined)}
          />
          {(review?.years ?? []).map((y) => (
            <YearPill
              key={y}
              label={String(y)}
              selected={year === y}
              onPress={() => setYear(y)}
            />
          ))}
        </ScrollView>

        <View className="h-64 overflow-hidden rounded-2xl bg-river-100">
          <BaseMap cameraRef={cameraRef} onStyleLoaded={() => setMapReady(true)}>
            {trackFeatures.features.length > 0 ? (
              <GeoJSONSource id="review-tracks" data={trackFeatures}>
                <Layer
                  id="review-tracks"
                  type="line"
                  paint={{
                    "line-color": TRACK_COLOR,
                    "line-width": 3,
                    "line-opacity": 0.85,
                  }}
                  layout={{ "line-cap": "round", "line-join": "round" }}
                />
              </GeoJSONSource>
            ) : null}
          </BaseMap>

          {reviewQuery.isPending ? (
            <View className="absolute inset-0 items-center justify-center bg-river-100/80">
              <ActivityIndicator color="#1f7796" />
            </View>
          ) : tracks.length === 0 ? (
            <View className="absolute inset-0 items-center justify-center bg-river-100/80">
              <Text className="text-sm font-medium text-river-500">
                No paddles yet
              </Text>
            </View>
          ) : null}
        </View>

        {review ? (
          <>
            <View className="flex-row flex-wrap gap-3">
              <StatTile
                label="Total miles"
                value={formatDistanceMi(review.totals.distanceM)}
              />
              <StatTile label="Paddles" value={String(review.totals.paddles)} />
              <StatTile
                label="Total time"
                value={formatDuration(review.totals.elapsedS)}
              />
              <StatTile
                label="Avg miles"
                value={formatDistanceMi(review.totals.avgDistanceM)}
              />
              <StatTile
                label="Avg duration"
                value={formatDuration(review.totals.avgElapsedS)}
              />
              <StatTile
                label="Streak"
                value={`${review.currentStreakWeeks} wk${
                  review.currentStreakWeeks === 1 ? "" : "s"
                }`}
              />
            </View>

            {review.longest || review.fastest || review.mostActiveMonth ? (
              <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
                <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
                  Records
                </Text>
                {review.longest ? (
                  <RecordRow
                    emoji="🛶"
                    label="Longest"
                    value={formatDistanceMi(review.longest.distanceM)}
                    meta={`${review.longest.routeName ?? "Unnamed route"} · ${formatDateTime(
                      new Date(review.longest.startedAt),
                    )}`}
                  />
                ) : null}
                {review.fastest ? (
                  <RecordRow
                    emoji="⚡"
                    label="Fastest"
                    value={formatSpeedMph(review.fastest.avgSpeedMps)}
                    meta={`${review.fastest.routeName ?? "Unnamed route"} · ${formatDateTime(
                      new Date(review.fastest.startedAt),
                    )}`}
                  />
                ) : null}
                {review.mostActiveMonth ? (
                  <RecordRow
                    emoji="📅"
                    label="Most active month"
                    value={formatMonthLabel(review.mostActiveMonth.month)}
                    meta={`${review.mostActiveMonth.count} paddle${
                      review.mostActiveMonth.count === 1 ? "" : "s"
                    }`}
                  />
                ) : null}
              </View>
            ) : null}
          </>
        ) : reviewQuery.isError ? (
          <Text className="text-sm text-river-500">
            Couldn&apos;t load your paddle history.
          </Text>
        ) : null}
      </ScrollView>

      {/* Off-screen recap card for the Share button. captureRef needs the view mounted and laid out
          at its real (fixed) size, so this stays permanently rendered rather than only while sharing --
          it's just pushed far outside the viewport (`left: -2000`) instead of conditionally mounted.
          `collapsable={false}` keeps Android from flattening it out of the native view tree (which
          would leave captureRef nothing to snapshot). No map here, per spec -- just the big numbers. */}
      <View
        ref={shareCardRef}
        collapsable={false}
        style={{ position: "absolute", top: 0, left: -2000, width: 360, height: 640 }}
      >
        <View
          className="flex-1 justify-between p-8"
          style={{
            backgroundColor: "#112a38",
            // NativeWind has no gradient utility that compiles to RN styles (Tailwind's `bg-gradient-*`
            // classes emit a CSS `background-image` that NativeWind doesn't translate), so the actual
            // gradient pixel comes from RN 0.86's native `experimental_backgroundImage` style field
            // (accepts a CSS gradient string directly) rather than a className.
            experimental_backgroundImage:
              "linear-gradient(160deg, #112a38 0%, #1e4356 45%, #7c2d12 100%)",
          }}
        >
          <View className="gap-1">
            <Text className="text-3xl font-extrabold text-white">
              🛶 Paddle Prints
            </Text>
            <Text className="text-base font-semibold text-sunset-300">
              {yearLabel} recap
            </Text>
          </View>

          <View className="gap-6">
            <ShareStat
              label="Total miles"
              value={formatDistanceMi(review?.totals.distanceM ?? 0)}
            />
            <ShareStat label="Paddles" value={String(review?.totals.paddles ?? 0)} />
            <ShareStat
              label="Total time"
              value={formatDuration(review?.totals.elapsedS ?? 0)}
            />
          </View>

          <Text className="text-xs text-river-200">Made with Paddle Prints</Text>
        </View>
      </View>
    </View>
  );
}

function YearPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-4 py-2 shadow-sm ${
        selected ? "bg-sunset-500" : "bg-white"
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          selected ? "text-white" : "text-river-700"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[45%] flex-1 rounded-2xl bg-white p-4 shadow-sm">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-400">
        {label}
      </Text>
      <Text className="mt-0.5 text-xl font-extrabold tabular-nums text-river-900">
        {value}
      </Text>
    </View>
  );
}

function RecordRow({
  emoji,
  label,
  value,
  meta,
}: {
  emoji: string;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <View className="flex-row items-center gap-3">
      <Text className="text-2xl">{emoji}</Text>
      <View className="flex-1">
        <Text className="text-xs font-medium text-river-500">{label}</Text>
        <Text className="text-base font-bold text-river-900">{value}</Text>
        <Text className="text-xs text-river-400">{meta}</Text>
      </View>
    </View>
  );
}

function ShareStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-bold uppercase tracking-widest text-river-200">
        {label}
      </Text>
      <Text className="text-4xl font-extrabold text-white">{value}</Text>
    </View>
  );
}
