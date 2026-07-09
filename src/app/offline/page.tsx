"use client";

/**
 * The offline navigation fallback (served by the service worker when a document request can't reach
 * the network). It doubles as a universal client shell: if the URL that failed was a paddle summary
 * (`/paddles/<id>`), we render that summary straight from IndexedDB, so finishing a paddle offline
 * and landing on its summary Just Works even though the server was never reached.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import { PaddleSummaryResilient } from "~/components/paddles/paddle-summary-resilient";

const PADDLE_PATH = /^\/paddles\/([0-9a-fA-F-]{36})\/?$/;

export default function OfflinePage() {
  const [paddleId, setPaddleId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const match = window.location.pathname.match(PADDLE_PATH);
    setPaddleId(match ? match[1]! : null);
  }, []);

  if (paddleId === undefined) return null; // hydrating
  if (paddleId) return <PaddleSummaryResilient id={paddleId} server={null} />;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-river-950 px-6 text-center text-white">
      <span className="text-5xl">🛶</span>
      <h1 className="text-xl font-extrabold">You&apos;re offline</h1>
      <p className="text-river-300 max-w-xs text-sm">
        This page isn&apos;t available offline. Downloaded routes, the map, and
        your in-progress paddle still work.
      </p>
      <Link
        href="/"
        className="bg-sunset-500 rounded-xl px-4 py-2 font-semibold text-white"
      >
        Home
      </Link>
    </main>
  );
}
