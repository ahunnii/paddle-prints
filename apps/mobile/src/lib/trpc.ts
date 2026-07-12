import {
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
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

/**
 * True for the specific tRPC error a protectedProcedure throws when the server session is gone
 * (expired/revoked in the DB) while the app still holds a SecureStore cookie. `TRPCClientError`
 * carries the server error's `data.code`; a transport failure or a 5xx has a different code (or
 * `data == null`), so this stays surgical and never signs out on a mere network blip.
 */
function isUnauthorizedError(error: unknown): boolean {
  return (
    error instanceof TRPCClientError &&
    (error as TRPCClientError<AppRouter>).data?.code === "UNAUTHORIZED"
  );
}

/**
 * Global "dead server session -> sign the app out" handler.
 *
 * PROBLEM (observed): when a session is revoked/expired server-side while the app holds a valid-looking
 * cookie, better-auth's RN `useSession` keeps serving a STALE session and never notices. Verified in
 * node_modules/@better-auth/expo/dist/client.js: on init the expo plugin hydrates the session atom from
 * a local `<prefix>_session_data` cache and only trusts its OWN cached `expiresAt` (getActions, the
 * `expMs > Date.now()` check) -- a DB-side revocation that hasn't reached that clock is invisible. The
 * plugin's focus/online managers can trigger a get-session refetch, but nothing here forces one, so the
 * gate never flips: every protectedProcedure returns UNAUTHORIZED and the feed shows "UNAUTHORIZED"
 * forever instead of redirecting to /login.
 *
 * FIX: on any UNAUTHORIZED tRPC error, call `authClient.signOut()`. Verified in the same file: the expo
 * plugin's fetch `init` hook runs `clearSessionCache()` for any `/sign-out` URL BEFORE the network call
 * (client.js line ~381). `clearSessionCache` wipes the stored cookie, wipes the cached session_data,
 * AND sets the session nanostore atom to `{ data: null, error: null, isPending: false }`. So local auth
 * state is cleared even when the sign-out REQUEST itself fails because the session is already dead.
 * Clearing the atom flips `useSession` to `{ session: null, isPending: false }`, and the existing gates
 * in (app)/_layout.tsx and (auth)/_layout.tsx redirect to /login naturally -- no gate changes needed.
 *
 * GUARD: a batch of protected queries fails together (and each retries once), so a module-level flag
 * collapses the fan-out into a SINGLE sign-out per dead-session episode. The atom is cleared
 * synchronously inside signOut's init hook (before the promise settles and before the flag resets), so
 * the redirect has already unmounted the protected queries by then; the flag purely prevents a stampede
 * during the in-flight window. It resets once the sign-out settles so a genuinely new session can fail
 * and re-trigger later.
 */
let signingOutForDeadSession = false;

function handleUnauthorized(error: unknown): void {
  if (!isUnauthorizedError(error)) return;
  if (signingOutForDeadSession) return;
  signingOutForDeadSession = true;
  void authClient
    .signOut()
    .catch(() => {
      // signOut's request can reject when the server session is already gone; the expo client has
      // already cleared local state (cookie + cache + session atom) in its init hook, so the gate
      // still flips and the app redirects. Nothing to do.
    })
    .finally(() => {
      signingOutForDeadSession = false;
    });
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
    // Global handlers so a dead session detected by ANY query or mutation triggers one sign-out.
    queryCache: new QueryCache({ onError: handleUnauthorized }),
    mutationCache: new MutationCache({ onError: handleUnauthorized }),
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
