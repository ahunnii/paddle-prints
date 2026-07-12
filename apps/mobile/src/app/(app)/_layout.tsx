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
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "map" : "map-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: "Record",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "radio-button-on" : "radio-button-on-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      {/* This tab's screen file is (app)/routes/index.tsx -- a nested folder with an index route
          contributes to the SAME Tabs navigator as the top-level screens above (there's no
          _layout.tsx inside routes/ to make it its own stack), but its registered route name is
          "routes/index", not "routes". Getting this wrong silently drops the tab instead of erroring. */}
      <Tabs.Screen
        name="routes/index"
        options={{
          title: "Routes",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "trail-sign" : "trail-sign-outline"}
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
      {/* Paddle detail is reachable (feed cards push to it) but isn't one of the primary tabs --
          `href: null` keeps expo-router's Tabs navigator from rendering it as an extra tab-bar item
          while still letting router.push("/paddles/[id]") resolve to it. The screen renders its own
          header (back button + title), so the Tabs default header is turned off here too. This file
          is a direct sibling ("paddles/[id].tsx", no index.tsx in that folder), so its route name is
          just "paddles/[id]" -- unlike routes/index above, no extra "/index" segment applies. */}
      <Tabs.Screen
        name="paddles/[id]"
        options={{ href: null, headerShown: false }}
      />
      {/* Route detail: same nested-folder situation as routes/index, but this file isn't an index
          route, so its name is "routes/[id]" (no "/index" suffix) -- mirrors paddles/[id] above. */}
      <Tabs.Screen
        name="routes/[id]"
        options={{ href: null, headerShown: false }}
      />
    </Tabs>
  );
}
