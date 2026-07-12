import { QueryClient } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import superjson from "superjson";

import type { AppRouter } from "@paddle-prints/api";

import { env } from "../env";
import { authClient } from "./auth-client";

export const api = createTRPCReact<AppRouter>();

/**
 * Inference helper for outputs, e.g. `RouterOutputs["paddles"]["feed"][number]`.
 * Mirrors apps/web/src/trpc/react.tsx.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  });
}

export function createTRPCClient() {
  return api.createClient({
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
}
