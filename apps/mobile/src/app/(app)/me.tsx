import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { colors } from "@paddle-prints/tokens";

import { authClient } from "../../lib/auth-client";
import { formatSpeedMph } from "../../lib/format";
import { useSettings } from "../../lib/settings/use-settings";
import { api, type RouterOutputs } from "../../lib/trpc";

type PaceStat = RouterOutputs["paddles"]["myStats"][number];

function tripTypeLabel(tripType: PaceStat["tripType"]) {
  return tripType === "river" ? "River" : "Flat water";
}

export default function MeScreen() {
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const stats = api.paddles.myStats.useQuery();
  const sharePresence = useSettings((s) => s.sharePresence);
  const setSharePresence = useSettings((s) => s.setSharePresence);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      queryClient.clear();
    } finally {
      // The (app) group's session gate redirects to /login once the session clears; this only
      // matters if sign-out fails and the button needs to become tappable again.
      setSigningOut(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-river-50"
      contentContainerClassName="gap-6 p-4"
    >
      <View>
        <Text className="text-2xl font-extrabold tracking-tight text-river-900">
          {session?.user.name}
        </Text>
        <Text className="text-sm text-river-600">{session?.user.email}</Text>
      </View>

      <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
          Your pace
        </Text>
        {stats.isPending ? (
          <ActivityIndicator color="#1f7796" />
        ) : stats.data && stats.data.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {stats.data.map((s: PaceStat) => (
              <View
                key={s.tripType}
                className="min-w-[45%] flex-1 rounded-xl bg-river-50 p-3"
              >
                <Text className="text-xs font-medium text-river-600">
                  {tripTypeLabel(s.tripType)}
                </Text>
                <Text className="text-xl font-extrabold text-river-900">
                  {formatSpeedMph(s.avgSpeedMps)}
                </Text>
                <Text className="text-xs text-river-400">
                  {s.count} paddle{s.count === 1 ? "" : "s"}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="text-sm text-river-500">
            Log a paddle and your average pace will show up here.
          </Text>
        )}
      </View>

      <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
          Settings
        </Text>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="text-base font-semibold text-river-900">
              Share live location
            </Text>
            <Text className="text-sm text-river-600">
              Friends see you on the community map while you record
            </Text>
          </View>
          <Switch
            value={sharePresence}
            onValueChange={setSharePresence}
            trackColor={{ false: colors.river[200], true: colors.river[500] }}
            thumbColor={sharePresence ? colors.sunset[400] : "#ffffff"}
            ios_backgroundColor={colors.river[200]}
          />
        </View>
      </View>

      <Pressable
        onPress={() => void handleSignOut()}
        disabled={signingOut}
        className="items-center rounded-full bg-sunset-500 px-6 py-3 disabled:opacity-60"
      >
        {signingOut ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="font-semibold text-white">Sign out</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
