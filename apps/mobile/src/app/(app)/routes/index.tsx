/**
 * The Routes tab: a list of saved routes, newest-first, split by a My Routes / Community segmented
 * toggle (`routes.list` takes `{ scope: "mine" | "all" }` -- "mine" is the default landing segment).
 * Mirrors apps/web/src/app/routes/page.tsx (card layout, empty state copy) minus the route builder --
 * drawing a route needs a proper map-drag UI that only exists on web
 * (apps/web/src/components/routes/route-builder.tsx), so this tab is read-only and points people at
 * the web app instead of a "+ New route" button/CTA.
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
type RouteScope = "mine" | "all";

function typeIcon(type: RouteItem["type"]) {
  return type === "waypoint" ? "🌊" : "🏞️";
}

function RouteCard({
  item,
  downloaded,
  showCreator,
}: {
  item: RouteItem;
  downloaded: boolean;
  /** Only shown on the Community segment -- on My Routes every card is yours, so the name is noise. */
  showCreator: boolean;
}) {
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
          {formatRouteDistance(item.distanceM, item.shape)}
          {showCreator ? ` · ${item.creatorName}` : ""} ·{" "}
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </View>
    </Pressable>
  );
}

/** My Routes / Community segmented toggle, styled like the free-paddle trip-type pill in record.tsx. */
function ScopeToggle({
  scope,
  onChange,
}: {
  scope: RouteScope;
  onChange: (scope: RouteScope) => void;
}) {
  return (
    <View className="flex-row items-center gap-1 self-start rounded-full bg-river-100 p-1">
      {(["mine", "all"] as const).map((s) => (
        <Pressable
          key={s}
          onPress={() => onChange(s)}
          className={`min-h-11 justify-center rounded-full px-4 ${
            scope === s ? "bg-river-600" : ""
          }`}
        >
          <Text
            className={`text-sm font-semibold ${
              scope === s ? "text-white" : "text-river-700"
            }`}
          >
            {s === "mine" ? "My Routes" : "Community"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function RoutesScreen() {
  const [scope, setScope] = useState<RouteScope>("mine");
  const routesQuery = api.routes.list.useQuery({ scope });

  // Which routes have offline tiles downloaded -- refreshed each time the tab regains focus (a
  // download/remove happens on the detail screen, so re-read on return rather than subscribing).
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      setDownloadedIds(new Set(getDownloadedTrips().map((t) => t.routeId)));
    }, []),
  );

  const header = (
    <View className="mb-1 gap-3">
      <Text className="text-2xl font-extrabold tracking-tight text-river-900">
        Routes
      </Text>
      <ScopeToggle scope={scope} onChange={setScope} />
    </View>
  );

  if (routesQuery.isPending) {
    return (
      <View className="flex-1 bg-river-50">
        <View className="p-4 pb-0">{header}</View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1f7796" />
        </View>
      </View>
    );
  }

  if (routesQuery.isError) {
    return (
      <View className="flex-1 bg-river-50">
        <View className="p-4 pb-0">{header}</View>
        <View className="flex-1 items-center justify-center gap-3 px-6">
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
          <RouteCard
            item={item}
            downloaded={downloadedIds.has(item.id)}
            showCreator={scope === "all"}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View className="mt-16 items-center gap-2 px-6">
            <Text className="text-4xl">🛶</Text>
            {scope === "mine" ? (
              <>
                <Text className="text-center text-river-500">
                  No routes of your own yet
                </Text>
                <Text className="text-center text-sm text-river-400">
                  Check the Community tab for routes other paddlers have made,
                  or plan your first route on the web.
                </Text>
              </>
            ) : (
              <Text className="text-center text-river-500">
                No community routes yet — draw the first one on the web
              </Text>
            )}
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
