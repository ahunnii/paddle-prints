"use client";

/**
 * The account + offline-storage manager (/me): who you are, sign out, per-trip downloaded storage
 * with delete, total device usage from navigator.storage.estimate(), and the pending-sync queue with
 * a "Sync now" button and any dead-lettered errors.
 */
import { useState } from "react";

import { deleteTrip } from "~/lib/offline/download-trip";
import { formatBytes } from "~/lib/offline/format";
import { syncQueue } from "~/lib/offline/sync";
import {
  useDeadLetters,
  usePendingCounts,
  useStorageSummary,
} from "~/lib/offline/use-offline";
import { db } from "~/lib/offline/db";
import { SignOutButton } from "~/app/_components/sign-out-button";

export function MeClient({
  user,
}: {
  user: { name: string; email: string };
}) {
  const storage = useStorageSummary();
  const pending = usePendingCounts();
  const deadLetters = useDeadLetters();
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await syncQueue();
    } finally {
      setSyncing(false);
    }
  }

  async function clearDeadLetter(id: string, kind: "paddle" | "poi") {
    if (kind === "paddle") await db().pendingPaddles.delete(id);
    else await db().pendingPois.delete(id);
  }

  return (
    <main className="from-river-800 to-river-950 min-h-dvh bg-gradient-to-b px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-between">
          <a href="/" className="text-river-200 text-sm font-semibold">
            ← Home
          </a>
          <SignOutButton />
        </div>

        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{user.name}</h1>
          <p className="text-river-300 text-sm">{user.email}</p>
        </div>

        {/* Pending sync ---------------------------------------------------- */}
        <section className="flex flex-col gap-3 rounded-3xl bg-white/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-river-100 text-xs font-bold uppercase tracking-widest">
              Sync queue
            </h2>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing || pending.total === 0}
              className="bg-sunset-500 rounded-full px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {pending.total === 0 ? (
            <p className="text-river-300 text-sm">Everything is synced. 🎉</p>
          ) : (
            <p className="text-river-100 text-sm">
              {pending.paddles} paddle{pending.paddles === 1 ? "" : "s"} ·{" "}
              {pending.pois} spot{pending.pois === 1 ? "" : "s"} waiting to sync
            </p>
          )}
          {deadLetters && deadLetters.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-red-900/40 p-3">
              <p className="text-xs font-bold text-red-200">
                {deadLetters.length} item(s) failed to sync
              </p>
              {deadLetters.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 text-xs text-red-100"
                >
                  <span className="truncate">
                    {d.kind}: {d.error}
                  </span>
                  <button
                    type="button"
                    onClick={() => void clearDeadLetter(d.id, d.kind)}
                    className="shrink-0 underline"
                  >
                    Discard
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {/* Storage --------------------------------------------------------- */}
        <section className="flex flex-col gap-3 rounded-3xl bg-white/10 p-5">
          <h2 className="text-river-100 text-xs font-bold uppercase tracking-widest">
            Offline storage
          </h2>

          {storage === undefined ? (
            <p className="text-river-300 text-sm">Loading…</p>
          ) : (
            <>
              <p className="text-river-200 text-sm">
                Downloaded trips: {formatBytes(storage.totalBytes)}
                {storage.estimateUsage != null ? (
                  <>
                    {" "}
                    · Device usage {formatBytes(storage.estimateUsage)}
                    {storage.estimateQuota
                      ? ` / ${formatBytes(storage.estimateQuota)}`
                      : ""}
                  </>
                ) : null}
              </p>
              {storage.persisted != null ? (
                <p className="text-river-400 text-xs">
                  Persistent storage: {storage.persisted ? "granted ✓" : "not granted"}
                </p>
              ) : null}

              {storage.trips.length === 0 ? (
                <p className="text-river-300 text-sm italic">
                  No trips downloaded. Open a route and tap “Download for
                  offline”.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {storage.trips.map((t) => (
                    <li
                      key={t.routeId}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-river-900/50 p-3"
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold">{t.name}</span>
                        <span className="text-river-300 text-xs">
                          {t.tileCount} tiles · {formatBytes(t.bytes)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteTrip(t.routeId)}
                        className="shrink-0 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-200"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
