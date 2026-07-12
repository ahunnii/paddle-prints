import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";

import { colors } from "@paddle-prints/tokens";

import { authClient } from "../../lib/auth-client";

export default function AppLayout() {
  const { data: session, isPending } = authClient.useSession();

  // Root's SessionGate already waits out the initial load, but guard here too in case this
  // layout re-renders after a sign-out while isPending is momentarily true again.
  if (!session && !isPending) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.river[600],
        tabBarInactiveTintColor: colors.river[400],
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Feed",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "water" : "water-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "person" : "person-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
