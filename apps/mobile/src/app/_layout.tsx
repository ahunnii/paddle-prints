import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";

import { Providers } from "../components/providers";
import { authClient } from "../lib/auth-client";

// Side-effect import: registers the background location task (TaskManager.defineTask) at module scope
// so it exists before the recorder ever calls startLocationUpdatesAsync, and after any OS-triggered
// cold restart of the JS context.
import "../lib/recorder/location-task";

import "../../global.css";

/**
 * Blocks rendering of the route tree until better-auth's session check resolves. Without this,
 * the (auth)/(app) group layouts would briefly redirect based on a `null` session before the
 * real one loads, causing a flash between the login and feed screens.
 */
function SessionGate({ children }: { children: ReactNode }) {
  const { isPending } = authClient.useSession();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-river-50">
        <ActivityIndicator size="large" color="#1f7796" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <Providers>
      <SessionGate>
        <Stack screenOptions={{ headerShown: false }} />
      </SessionGate>
    </Providers>
  );
}
