import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import {
  formatDateTime,
  formatDistanceMi,
  formatDuration,
  formatSpeedMph,
} from "../../lib/format";
import { api, type RouterOutputs } from "../../lib/trpc";

type FeedItem = RouterOutputs["paddles"]["feed"][number];

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
        <Text
          className="flex-1 font-semibold text-river-900"
          numberOfLines={1}
        >
          {item.userName}
        </Text>
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

  const onRefresh = useCallback(() => {
    void feed.refetch();
  }, [feed]);

  if (feed.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-river-50">
        <ActivityIndicator size="large" color="#1f7796" />
      </View>
    );
  }

  if (feed.isError) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-river-50 px-6">
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
    );
  }

  return (
    <View className="flex-1 bg-river-50">
      <FlatList
        data={feed.data}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 p-4"
        renderItem={({ item }) => <FeedCard item={item} />}
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
