/**
 * A vanilla (non-React) tRPC client for imperative calls made outside any component/hook -- the
 * recorder's presence heartbeat and finish/discard cleanup run from the store, not from a render.
 *
 * Mirrors the header wiring of `./trpc.ts`'s `createTRPCClient` (same Cookie from better-auth's
 * SecureStore-backed `authClient.getCookie()` and the `x-trpc-source: expo` tag), but built with the
 * plain `createTRPCClient` so it can be imported and called anywhere.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

import type { AppRouter } from "@paddle-prints/api";

import { env } from "../env";
import { authClient } from "./auth-client";

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: superjson,
      url: `${env.EXPO_PUBLIC_API_URL}/api/trpc`,
      headers() {
        const cookie = authClient.getCookie();
        return {
          ...(cookie ? { Cookie: cookie } : {}),
          "x-trpc-source": "expo",
        };
      },
    }),
  ],
});
