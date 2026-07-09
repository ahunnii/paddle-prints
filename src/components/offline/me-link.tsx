"use client";

import Link from "next/link";

import { usePendingCounts } from "~/lib/offline/use-offline";

/** Header link to /me, with a subtle badge when paddles/spots are waiting to sync. */
export function MeLink() {
  const pending = usePendingCounts();
  return (
    <Link
      href="/me"
      className="border-river-300 text-river-100 hover:bg-river-800 relative flex min-h-9 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
    >
      Me
      {pending.total > 0 ? (
        <span
          className="bg-sunset-500 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold text-white"
          title={`${pending.total} waiting to sync`}
        >
          {pending.total}
        </span>
      ) : null}
    </Link>
  );
}
