import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { api, createQueryClient, createTRPCClient } from "../lib/trpc";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [trpcClient] = useState(createTRPCClient);

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
