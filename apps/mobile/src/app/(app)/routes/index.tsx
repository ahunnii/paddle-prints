/**
 * The Routes tab: a list of every saved route, newest-first. Mirrors apps/web/src/app/routes/page.tsx
 * (card layout, empty state copy) minus the route builder -- drawing a route needs a proper map-drag
 * UI that only exists on web (apps/web/src/components/routes/route-builder.tsx), so this tab is
 * read-only and points people at the web app instead of a "+ New route" button/CTA.
 *
 * File lives at (app)/routes/index.tsx; see the comment on its Tabs.Screen entry in
 * (app)/_layout.tsx for why that makes its registered tab route name "routes/index".
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { formatRouteDistance } from "../../../lib/format";
import { getDownloadedTrips } from "../../../lib/offline/trips";
import { api, type RouterOutputs } from "../../../lib/trpc";

type RouteItem = RouterOutputs["routes"]["list"][number];

function typeIcon(type: RouteItem["type"]) {
  return type === "waypoint" ? "🌊" : "🏞️";
}

function RouteCard({ item, downloaded }: { item: RouteItem; downloaded: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/routes/${item.id}`)}
      className="flex-row items-center gap-3 rounded-2xl bg-white p-4 shadow-sm active:opacity-80"
    >
      <Text className="text-3xl">{typeIcon(item.type)}</Text>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="flex-shrink font-semibold text-river-900" numberOfLines={1}>
            {item.name}
          </Text>
          {downloaded ? (
            <View className="rounded-full bg-river-100 px-2 py-0.5">
              <Text className="text-[10px] font-bold uppercase tracking-wide text-river-600">
                Downloaded
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-0.5 text-sm text-river-600">
          {formatRouteDistance(item.distanceM, item.shape)} · {item.creatorName} ·{" "}
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </View>
    </Pressable>
  );
}

export default function RoutesScreen() {
  const routesQuery = api.routes.list.useQuery();

  // Which routes have offline tiles downloaded -- refreshed each time the tab regains focus (a
  // download/remove happens on the detail screen, so re-read on return rather than subscribing).
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      setDownloadedIds(new Set(getDownloadedTrips().map((t) => t.routeId)));
    }, []),
  );

  if (routesQuery.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-river-50">
        <ActivityIndicator size="large" color="#1f7796" />
      </View>
    );
  }

  if (routesQuery.isError) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-river-50 px-6">
        <Text className="text-center text-river-700">
          Couldn&apos;t load routes. {routesQuery.error.message}
        </Text>
        <Pressable
          onPress={() => void routesQuery.refetch()}
          className="rounded-full bg-sunset-500 px-5 py-2.5"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const routes = routesQuery.data;

  return (
    <View className="flex-1 bg-river-50">
      <FlatList
        data={routes}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 p-4"
        renderItem={({ item }) => (
          <RouteCard item={item} downloaded={downloadedIds.has(item.id)} />
        )}
        ListHeaderComponent={
          <Text className="mb-1 text-2xl font-extrabold tracking-tight text-river-900">
            Routes
          </Text>
        }
        ListEmptyComponent={
          <View className="mt-16 items-center gap-2 px-6">
            <Text className="text-4xl">🛶</Text>
            <Text className="text-center text-river-500">
              No routes yet — draw your first one on the web
            </Text>
          </View>
        }
        ListFooterComponent={
          <Text className="mt-2 text-center text-xs text-river-400">
            Draw new routes at the web app — the builder is web-only.
          </Text>
        }
      />
    </View>
  );
}
