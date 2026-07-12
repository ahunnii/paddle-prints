import { Redirect, Stack } from "expo-router";

import { authClient } from "../../lib/auth-client";

export default function AuthLayout() {
  const { data: session } = authClient.useSession();

  // Signed-in users have no business on login/register; send them to the feed.
  if (session) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
