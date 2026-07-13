import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { Avatar } from "../../components/ui/avatar";
import {
  formatDateTime,
  formatDistanceMi,
  formatDuration,
  formatSpeedMph,
} from "../../lib/format";
import {
  pendingPaddleStore,
  type PaddleInput,
  type PendingRow,
} from "../../lib/offline/sync";
import { api, type RouterOutputs } from "../../lib/trpc";

type FeedItem = RouterOutputs["paddles"]["feed"][number];

/**
 * The paddles queued on this device but not yet on the server. Polled on screen focus, and every 5s
 * only while something is pending (there's no Dexie liveQuery equivalent on native; this stays light).
 * A drain that lands via the sync triggers invalidates the feed query and deletes the queue rows, so
 * the next poll drops the pending card and the real feed row appears in its place.
 */
function usePendingPaddles() {
  const [rows, setRows] = useState<PendingRow<PaddleInput>[]>([]);

  const refresh = useCallback(() => {
    pendingPaddleStore
      .toArray()
      .then(setRows)
      .catch(() => {
        // Reading the local queue is best-effort; a transient failure just means no pending cards.
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

/** A queued (or dead-lettered) paddle rendered as a feed card with a "Waiting to sync" chip. */
function PendingPaddleCard({ row }: { row: PendingRow<PaddleInput> }) {
  const failed = row.deadLetter != null;
  return (
    <View className="rounded-2xl border border-sunset-200 bg-white p-4 shadow-sm">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-2">
          {/* Queued-offline rows carry no server userImage yet -- Avatar falls back to initials. */}
          <Avatar name="You" image={null} size="sm" />
          <Text className="flex-1 font-semibold text-river-900" numberOfLines={1}>
            You
          </Text>
        </View>
        <View
          className={`rounded-full px-2 py-0.5 ${failed ? "bg-red-100" : "bg-sunset-100"}`}
        >
          <Text
            className={`text-xs font-bold ${failed ? "text-red-700" : "text-sunset-700"}`}
          >
            {failed ? "Sync failed" : "Waiting to sync"}
          </Text>
        </View>
      </View>

      <Text className="mt-1 text-sm text-river-600">
        {formatDistanceMi(row.input.distanceM)} ·{" "}
        {formatDuration(row.input.elapsedS)} · avg{" "}
        {formatSpeedMph(row.input.avgSpeedMps)}
      </Text>

      <Text className="mt-1 text-xs text-river-400">
        {formatDateTime(row.input.startedAt)}
      </Text>
    </View>
  );
}

function tripTypeLabel(tripType: FeedItem["tripType"]) {
  return tripType === "river" ? "River" : "Flat water";
}

function FeedCard({ item }: { item: FeedItem }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/paddles/${item.id}`)}
      className="rounded-2xl bg-white p-4 shadow-sm active:opacity-80"
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <Avatar name={item.userName ?? "Someone"} image={item.userImage} size="sm" />
          <Text
            className="flex-1 font-semibold text-river-900"
            numberOfLines={1}
          >
            {item.userName}
          </Text>
        </View>
        <View className="rounded-full bg-river-100 px-2 py-0.5">
          <Text className="text-xs font-bold text-river-700">
            {tripTypeLabel(item.tripType)}
          </Text>
        </View>
      </View>

      {item.routeName ? (
        <Text className="mt-0.5 text-sm text-sunset-600">
          {item.routeName}
        </Text>
      ) : null}

      <Text className="mt-1 text-sm text-river-600">
        {formatDistanceMi(item.distanceM)} · {formatDuration(item.elapsedS)} ·
        avg {formatSpeedMph(item.avgSpeedMps)}
      </Text>

      <Text className="mt-1 text-xs text-river-400">
        {formatDateTime(item.startedAt)}
      </Text>
    </Pressable>
  );
}

export default function FeedScreen() {
  const feed = api.paddles.feed.useQuery();
  const { rows: pendingRows, refresh: refreshPending } = usePendingPaddles();

  const onRefresh = useCallback(() => {
    refreshPending();
    void feed.refetch();
  }, [feed, refreshPending]);

  // Hide a queued row the instant its real server row lands in the feed (its id is the paddle id).
  const serverIds = new Set((feed.data ?? []).map((item) => item.id));
  const visiblePending = pendingRows.filter((row) => !serverIds.has(row.id));

  const pendingHeader =
    visiblePending.length > 0 ? (
      <View className="gap-3 pb-3">
        {visiblePending.map((row) => (
          <PendingPaddleCard key={row.id} row={row} />
        ))}
      </View>
    ) : null;

  if (feed.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-river-50">
        <ActivityIndicator size="large" color="#1f7796" />
      </View>
    );
  }

  if (feed.isError) {
    // Queued-offline paddles must stay visible even when the feed itself can't load — otherwise a
    // paddler with no signal saves a trip and then can't see it anywhere on this tab.
    return (
      <View className="flex-1 bg-river-50">
        <View className="p-4 pb-0">
          <Text className="text-2xl font-extrabold tracking-tight text-river-900">
            Recent Crew Activity
          </Text>
        </View>
        {visiblePending.length > 0 ? (
          <View className="gap-3 p-4 pb-0">{pendingHeader}</View>
        ) : null}
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-center text-river-700">
            Couldn&apos;t load the feed. {feed.error.message}
          </Text>
          <Pressable
            onPress={() => void feed.refetch()}
            className="rounded-full bg-sunset-500 px-5 py-2.5"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-river-50">
      <FlatList
        data={feed.data}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 p-4"
        renderItem={({ item }) => <FeedCard item={item} />}
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            <Text className="text-2xl font-extrabold tracking-tight text-river-900">
              Recent Crew Activity
            </Text>
            {pendingHeader}
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={feed.isFetching}
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          <View className="mt-16 items-center">
            <Text className="text-river-500">No paddles yet</Text>
          </View>
        }
      />
    </View>
  );
}
