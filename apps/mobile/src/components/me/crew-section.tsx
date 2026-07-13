/**
 * The member directory on the Me tab: everyone in the crew, who's currently out on the water, and
 * how many paddles they've logged. Mirrors the card styling of the other me.tsx sections
 * (rounded-2xl bg-white shadow-sm) and apps/web/src/components/me/crew-section.tsx's copy/layout.
 */
import { ActivityIndicator, Text, View } from "react-native";

import { Avatar } from "../../components/ui/avatar";
import { api } from "../../lib/trpc";

function joinedLabel(joinedAt: Date, paddleCount: number): string {
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(new Date(joinedAt));
  return `Joined ${month} · ${paddleCount} paddle${paddleCount === 1 ? "" : "s"}`;
}

export function CrewSection() {
  const { data, isPending, isError } = api.users.directory.useQuery();

  return (
    <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
        Crew
      </Text>

      {isPending ? (
        <ActivityIndicator color="#1f7796" />
      ) : isError ? (
        <Text className="text-sm text-river-500">
          Couldn&apos;t load the crew.
        </Text>
      ) : !data || data.length === 0 ? (
        <Text className="text-sm text-river-500">No one here yet.</Text>
      ) : (
        <View className="gap-2">
          {data.map((member) => (
            <View
              key={member.id}
              className="flex-row items-center gap-3 rounded-xl bg-river-50 p-3"
            >
              <Avatar name={member.name} image={member.image} size="md" />
              <View className="min-w-0 flex-1">
                <Text
                  className="font-semibold text-river-900"
                  numberOfLines={1}
                >
                  {member.name}
                </Text>
                <Text className="text-xs text-river-500" numberOfLines={1}>
                  {joinedLabel(member.joinedAt, member.paddleCount)}
                </Text>
              </View>
              {member.onWaterNow ? (
                <View className="shrink-0 flex-row items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-1">
                  <View className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <Text className="text-xs font-bold text-emerald-700">
                    On the water
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
