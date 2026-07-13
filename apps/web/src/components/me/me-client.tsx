"use client";

/**
 * The account + offline-storage manager (/me): who you are, sign out, per-trip downloaded storage
 * with delete, total device usage from navigator.storage.estimate(), and the pending-sync queue with
 * a "Sync now" button and any dead-lettered errors.
 */
import { useEffect, useState } from "react";

import { deleteTrip } from "~/lib/offline/download-trip";
import { formatBytes } from "~/lib/offline/format";
import { syncQueue } from "~/lib/offline/sync";
import {
  useDeadLetters,
  usePendingCounts,
  useStorageSummary,
} from "~/lib/offline/use-offline";
import { db } from "~/lib/offline/db";
import { useSettings } from "~/lib/settings/use-settings";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { AvatarUploader } from "~/components/me/avatar-uploader";
import { CrewSection } from "~/components/me/crew-section";
import { TeamsSection } from "~/components/me/teams-section";
import { PinnedSection } from "~/components/me/pinned-section";

const MPS_TO_MPH = 2.2369363;

export interface PaceStat {
  tripType: "river" | "waypoint";
  count: number;
  avgSpeedMps: number;
}

function tripTypeLabel(tripType: PaceStat["tripType"]) {
  return tripType === "river" ? "🏞️ River" : "🌊 Flat water";
}

export function MeClient({
  user,
  paceStats,
}: {
  user: { name: string; email: string; image: string | null };
  paceStats: PaceStat[];
}) {
  const storage = useStorageSummary();
  const pending = usePendingCounts();
  const deadLetters = useDeadLetters();
  const [syncing, setSyncing] = useState(false);

  // zustand's `persist` middleware hydrates from localStorage after the first client render, so
  // rendering these toggles from the store before mount would show the SSR default (board / share
  // on) and then possibly flip -- gate on mount to avoid the hydration-mismatch flash.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const markerStyle = useSettings((s) => s.markerStyle);
  const setMarkerStyle = useSettings((s) => s.setMarkerStyle);
  const sharePresence = useSettings((s) => s.sharePresence);
  const setSharePresence = useSettings((s) => s.setSharePresence);

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

        <div className="flex items-center gap-4">
          <AvatarUploader name={user.name} image={user.image} />
          <div className="min-w-0">
            <h1 className="font-display truncate text-2xl font-extrabold tracking-tight">
              {user.name}
            </h1>
            <p className="text-river-300 truncate text-sm">{user.email}</p>
          </div>
        </div>

        {/* Your pace --------------------------------------------------------- */}
        <section className="flex flex-col gap-3 rounded-3xl bg-white/10 p-5">
          <h2 className="text-river-100 text-xs font-bold uppercase tracking-widest">
            Your pace
          </h2>
          {paceStats.length === 0 ? (
            <p className="text-river-300 text-sm">
              🛶 Log a paddle and your average pace will show up here.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {paceStats.map((s) => (
                <div key={s.tripType} className="rounded-2xl bg-river-900/50 p-3">
                  <p className="text-river-300 text-xs font-medium">
                    {tripTypeLabel(s.tripType)}
                  </p>
                  <p className="font-display text-2xl font-extrabold tabular-nums text-white">
                    {(s.avgSpeedMps * MPS_TO_MPH).toFixed(1)}
                    <span className="text-river-300 ml-1 text-sm font-medium">
                      mph
                    </span>
                  </p>
                  <p className="text-river-400 text-xs">
                    {s.count} paddle{s.count === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Crew ---------------------------------------------------------------- */}
        <CrewSection />

        {/* Paddle Teams ---------------------------------------------------- */}
        <TeamsSection />

        {/* Pinned Paddles ---------------------------------------------------- */}
        <PinnedSection />

        {/* Preferences ------------------------------------------------------- */}
        <section className="flex flex-col gap-4 rounded-3xl bg-white/10 p-5">
          <h2 className="text-river-100 text-xs font-bold uppercase tracking-widest">
            Preferences
          </h2>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-white">Live marker</p>
            <div className="flex items-center gap-1 rounded-full bg-river-900/50 p-1">
              <button
                type="button"
                disabled={!mounted}
                onClick={() => setMarkerStyle("board")}
                className={`min-h-10 flex-1 rounded-full px-3 text-sm font-semibold transition-colors ${
                  mounted && markerStyle === "board"
                    ? "bg-sunset-500 text-white"
                    : "text-river-300"
                }`}
              >
                Board 🏄
              </button>
              <button
                type="button"
                disabled={!mounted}
                onClick={() => setMarkerStyle("dot")}
                className={`min-h-10 flex-1 rounded-full px-3 text-sm font-semibold transition-colors ${
                  mounted && markerStyle === "dot"
                    ? "bg-sunset-500 text-white"
                    : "text-river-300"
                }`}
              >
                Classic dot ●
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                Share live location with the crew while recording
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={mounted && sharePresence}
                disabled={!mounted}
                onClick={() => setSharePresence(!sharePresence)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  mounted && sharePresence ? "bg-sunset-500" : "bg-river-900/70"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                    mounted && sharePresence ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <p className="text-river-400 text-xs">
              Friends see you on the community map while you&apos;re recording. Updates every
              minute or so and disappears when you finish.
            </p>
          </div>
        </section>

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
              className="bg-sunset-500 active:bg-sunset-600 rounded-full px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
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
                    className="active:text-red-300 shrink-0 underline"
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
                        className="active:bg-red-500/30 shrink-0 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-200"
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
