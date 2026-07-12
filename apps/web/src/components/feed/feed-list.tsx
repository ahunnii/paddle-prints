"use client";

/**
 * The crew feed, merged with this device's outbound queue. The server renders the shared feed
 * (`initial`); this client component folds in the paddles still sitting in IndexedDB so a
 * just-finished trip appears immediately -- before background sync lands it -- instead of looking
 * lost. Each pending item wears a sync badge, and when it finally reaches the server we hold a brief
 * "Saved ✓" state (and `router.refresh()`) so it never flickers out and back as the server list
 * catches up.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "~/lib/offline/db";
import type { RouterOutputs } from "~/trpc/react";

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

type ServerRow = RouterOutputs["paddles"]["feed"][number];

type SyncStatus = "syncing" | "failed" | "saved" | null;

/** The one shape the list renders -- server rows and queued paddles both normalize into this. */
interface FeedItem {
  id: string;
  userName: string | null;
  routeName: string | null;
  distanceM: number;
  avgSpeedMps: number;
  elapsedS: number;
  startedAt: Date | string;
  status: SyncStatus;
}

function shortElapsed(totalS: number) {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m} min`;
}

function startedMs(item: FeedItem): number {
  return new Date(item.startedAt).getTime();
}

export function FeedList({ initial }: { initial: ServerRow[] }) {
  const router = useRouter();

  // The queued paddles on this device, mapped to feed items. Reactive: re-runs when the queue
  // changes (a paddle syncs and its row is deleted, or is dead-lettered).
  const pendingItems = useLiveQuery(async () => {
    const rows = await db().pendingPaddles.toArray();
    const items: FeedItem[] = [];
    for (const r of rows) {
      const routeName = r.input.routeId
        ? ((await db().trips.get(r.input.routeId))?.route.name ?? null)
        : null;
      items.push({
        id: r.id,
        userName: "You",
        routeName,
        distanceM: r.input.distanceM,
        avgSpeedMps: r.input.avgSpeedMps,
        elapsedS: r.input.elapsedS,
        startedAt: r.input.startedAt,
        status: r.deadLetter ? "failed" : "syncing",
      });
    }
    return items;
  }, []);

  // Paddles that have just left the queue (synced) but aren't in `initial` yet. We keep their
  // last-rendered item around with a "Saved ✓" badge so they don't vanish for the beat between the
  // queue row being deleted and the refreshed server feed arriving.
  const [justSynced, setJustSynced] = useState<Map<string, FeedItem>>(
    () => new Map(),
  );
  const prevPendingRef = useRef<Map<string, FeedItem>>(new Map());

  // Detect ids that disappeared from the queue (and weren't dead-lettered): those synced.
  useEffect(() => {
    if (pendingItems === undefined) return;
    const current = new Map(pendingItems.map((it) => [it.id, it]));
    const additions: Array<[string, FeedItem]> = [];
    for (const [id, item] of prevPendingRef.current) {
      if (!current.has(id) && item.status !== "failed") {
        additions.push([id, { ...item, status: "saved" }]);
      }
    }
    prevPendingRef.current = current;
    if (additions.length > 0) {
      setJustSynced((prev) => {
        const next = new Map(prev);
        for (const [id, item] of additions) next.set(id, item);
        return next;
      });
      // Pull the server feed so it picks up the freshly-synced paddle for real.
      router.refresh();
    }
  }, [pendingItems, router]);

  // Once the server feed contains a just-synced id, hand it back off to the real row.
  useEffect(() => {
    const initialIds = new Set(initial.map((r) => r.id));
    setJustSynced((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) {
        if (initialIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [initial]);

  const initialIds = new Set(initial.map((r) => r.id));
  const pendingIds = new Set((pendingItems ?? []).map((it) => it.id));

  const serverItems: FeedItem[] = initial.map((r) => ({
    id: r.id,
    userName: r.userName,
    routeName: r.routeName,
    distanceM: r.distanceM,
    avgSpeedMps: r.avgSpeedMps,
    elapsedS: r.elapsedS,
    startedAt: r.startedAt,
    status: null,
  }));

  // Queued paddles not already on the server, plus any we're briefly holding as "Saved ✓".
  const pendingNew = (pendingItems ?? []).filter((it) => !initialIds.has(it.id));
  const justSyncedNew = [...justSynced.values()].filter(
    (it) => !initialIds.has(it.id) && !pendingIds.has(it.id),
  );

  const merged = [...serverItems, ...pendingNew, ...justSyncedNew].sort(
    (a, b) => startedMs(b) - startedMs(a),
  );

  if (merged.length === 0) {
    return (
      <div className="border-river-700 rounded-2xl border border-dashed p-6 text-center">
        <p className="text-river-200 text-sm">
          No paddles logged yet. Pick a route and tap Start paddle to be first on
          the board.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {merged.map((p) => {
        const miles = (p.distanceM / METERS_PER_MILE).toFixed(1);
        const mph = (p.avgSpeedMps * MPS_TO_MPH).toFixed(1);
        const inlineBadge =
          p.status === "syncing" || p.status === "saved" ? p.status : null;
        return (
          <li key={p.id}>
            <Link
              href={`/paddles/${p.id}`}
              className="bg-river-900/60 hover:bg-river-900 active:bg-river-900 block rounded-2xl p-4 shadow transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">
                  <span className="text-white">{p.userName}</span>{" "}
                  <span className="text-river-300">paddled</span>{" "}
                  <span className="text-sunset-300">
                    {p.routeName ?? "a quick start paddle"}
                  </span>
                </p>
                {inlineBadge === "syncing" ? (
                  <span className="shrink-0 rounded-full bg-amber-400/90 px-2 py-0.5 text-xs font-bold text-amber-950">
                    Syncing…
                  </span>
                ) : inlineBadge === "saved" ? (
                  <span className="shrink-0 rounded-full bg-emerald-400/90 px-2 py-0.5 text-xs font-bold text-emerald-950">
                    Saved ✓
                  </span>
                ) : null}
              </div>
              <p className="text-river-200 mt-1 text-sm tabular-nums">
                {miles} mi in {shortElapsed(p.elapsedS)} · avg {mph} mph
              </p>
              <p className="text-river-400 mt-0.5 text-xs">
                {new Date(p.startedAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </Link>
            {p.status === "failed" ? (
              <Link
                href="/me"
                className="mt-1 inline-block rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white"
              >
                Sync failed — see profile
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
