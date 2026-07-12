import { useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { api, createQueryClient, createTRPCClient } from "../lib/trpc";
import { registerSyncTriggers } from "../lib/offline/triggers";

/**
 * Registers the offline sync triggers (app launch / foreground / network regain) once, inside the
 * tRPC + QueryClient providers so it can invalidate the feed and POI queries when a drain actually
 * sent something. Renders nothing. Mirrors web's OfflineBootstrap in offline-layer.tsx.
 */
function SyncTriggers() {
  const utils = api.useUtils();
  useEffect(() => {
    const unregister = registerSyncTriggers({
      onSynced: () => {
        // A queued paddle/POI just reached the server: pull the real rows so the pending cards on the
        // feed / map hand off to the synced ones.
        void utils.paddles.feed.invalidate();
        void utils.pois.inBbox.invalidate();
      },
    });
    return unregister;
  }, [utils]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [trpcClient] = useState(createTRPCClient);

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SyncTriggers />
        {children}
      </QueryClientProvider>
    </api.Provider>
  );
}
