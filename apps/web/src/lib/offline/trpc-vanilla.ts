/**
 * A vanilla (non-React) tRPC client for the offline layer. The recorder's finish flow and the
 * background sync loop call mutations imperatively, outside any component/hook, so they need a plain
 * client rather than `api.*.useMutation`.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";

import type { AppRouter } from "@paddle-prints/api";

function baseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${baseUrl()}/api/trpc`,
      transformer: SuperJSON,
    }),
  ],
});
