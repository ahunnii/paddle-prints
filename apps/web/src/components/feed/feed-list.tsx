"use client";

/**
 * The crew feed, merged with this device's outbound queue. The server renders the shared "all"
 * feed (`initial`); this client component folds in the paddles still sitting in IndexedDB so a
 * just-finished trip appears immediately -- before background sync lands it -- instead of looking
 * lost. Each pending item wears a sync badge, and when it finally reaches the server we hold a
 * brief "Saved ✓" state (refetching the live queries so it never flickers out and back as the
 * server list catches up.
 *
 * An "All / My Teams" toggle switches between `paddles.feed({ filter: "all" })` (seeded from the
 * server-rendered `initial`, so it paints instantly) and `paddles.feed({ filter: "teams" })` (a
 * plain client fetch, only enabled once selected). Queued/local items are device-local and always
 * belong to the signed-in user, so they're merged into both views regardless of which is active.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { ReactionBar } from "~/components/paddles/reaction-bar";
import { Avatar } from "~/components/ui/avatar";
import { db } from "~/lib/offline/db";
import { api, type RouterOutputs } from "~/trpc/react";

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

type ServerRow = RouterOutputs["paddles"]["feed"][number];
type FeedFilter = "all" | "teams";

type SyncStatus = "syncing" | "failed" | "saved" | null;

/**
 * The one shape the list renders -- server rows and queued paddles both normalize into this.
 * `userImage`, `commentCount`, `reactions`, and `myReactions` are only ever known for server rows;
 * queued paddles (still in this device's IndexedDB outbound queue, not yet a `ServerRow`) default
 * them (no image, no social activity yet -- they haven't reached the server).
 */
interface FeedItem {
  id: string;
  userName: string | null;
  userImage: string | null;
  routeName: string | null;
  distanceM: number;
  avgSpeedMps: number;
  elapsedS: number;
  startedAt: Date | string;
  status: SyncStatus;
  commentCount: number;
  reactions: Record<string, number>;
  myReactions: string[];
}

/** Defensive accessor: `item` may come from a server row (has these fields) or a locally-queued
 * paddle (doesn't) -- narrow with an `in` check rather than assuming the shape. */
function userImageOf(item: { userImage?: string | null }): string | null {
  return "userImage" in item ? (item.userImage ?? null) : null;
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

function serverRowToItem(r: ServerRow): FeedItem {
  return {
    id: r.id,
    userName: r.userName,
    userImage: userImageOf(r),
    routeName: r.routeName,
    distanceM: r.distanceM,
    avgSpeedMps: r.avgSpeedMps,
    elapsedS: r.elapsedS,
    startedAt: r.startedAt,
    status: null,
    commentCount: r.commentCount,
    reactions: r.reactions,
    myReactions: r.myReactions,
  };
}

export function FeedList({ initial }: { initial: ServerRow[] }) {
  const [filter, setFilter] = useState<FeedFilter>("all");

  const allQuery = api.paddles.feed.useQuery(
    { filter: "all" },
    { initialData: initial },
  );
  const teamsQuery = api.paddles.feed.useQuery(
    { filter: "teams" },
    { enabled: filter === "teams" },
  );

  const serverRows: ServerRow[] =
    filter === "all" ? allQuery.data : (teamsQuery.data ?? []);
  const teamsLoading = filter === "teams" && teamsQuery.isPending;

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
        userImage: null,
        routeName,
        distanceM: r.input.distanceM,
        avgSpeedMps: r.input.avgSpeedMps,
        elapsedS: r.input.elapsedS,
        startedAt: r.input.startedAt,
        status: r.deadLetter ? "failed" : "syncing",
        commentCount: 0,
        reactions: {},
        myReactions: [],
      });
    }
    return items;
  }, []);

  // Paddles that have just left the queue (synced) but aren't in the "all" feed yet. We keep their
  // last-rendered item around with a "Saved ✓" badge so they don't vanish for the beat between the
  // queue row being deleted and the refetched server feed arriving.
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
      // Pull the live feeds so they pick up the freshly-synced paddle for real.
      void allQuery.refetch();
      if (filter === "teams") void teamsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItems]);

  // Once the "all" feed contains a just-synced id, hand it back off to the real row (the "all"
  // feed always includes the signed-in user's own paddles, so it's the reliable source of truth
  // here even while viewing "teams").
  useEffect(() => {
    const allIds = new Set(allQuery.data.map((r) => r.id));
    setJustSynced((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) {
        if (allIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allQuery.data]);

  const serverIds = new Set(serverRows.map((r) => r.id));
  const pendingIds = new Set((pendingItems ?? []).map((it) => it.id));

  const serverItems: FeedItem[] = serverRows.map(serverRowToItem);

  // Queued paddles not already in the current view, plus any we're briefly holding as "Saved ✓".
  const pendingNew = (pendingItems ?? []).filter((it) => !serverIds.has(it.id));
  const justSyncedNew = [...justSynced.values()].filter(
    (it) => !serverIds.has(it.id) && !pendingIds.has(it.id),
  );

  const merged = [...serverItems, ...pendingNew, ...justSyncedNew].sort(
    (a, b) => startedMs(b) - startedMs(a),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterPill>
        <FilterPill
          active={filter === "teams"}
          onClick={() => setFilter("teams")}
        >
          My Teams
        </FilterPill>
      </div>

      {teamsLoading ? (
        <p className="text-river-300 px-1 text-sm">Loading your teams…</p>
      ) : merged.length === 0 ? (
        <div className="border-river-700 rounded-2xl border border-dashed p-6 text-center">
          <p className="text-river-200 text-sm">
            {filter === "teams"
              ? "No paddles from your teams yet."
              : "No paddles logged yet. Pick a route and tap Start paddle to be first on the board."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {merged.map((p) => {
            const miles = (p.distanceM / METERS_PER_MILE).toFixed(1);
            const mph = (p.avgSpeedMps * MPS_TO_MPH).toFixed(1);
            const inlineBadge =
              p.status === "syncing" || p.status === "saved" ? p.status : null;
            const showFooter = p.status === null || p.status === "saved";
            return (
              <li key={p.id} className="group relative">
                <div className="bg-river-900/60 group-hover:bg-river-900 group-active:bg-river-900 relative rounded-2xl p-4 shadow transition-colors">
                  {/* Stretched link: covers the whole card so anywhere without a higher-stacked
                      interactive child (the footer below) navigates to the paddle. */}
                  <Link
                    href={`/paddles/${p.id}`}
                    className="absolute inset-0 z-10 rounded-2xl"
                  >
                    <span className="sr-only">
                      View paddle by {p.userName ?? "someone"}
                    </span>
                  </Link>

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <Avatar name={p.userName ?? "Someone"} image={p.userImage} size="sm" />
                      <p className="font-semibold">
                        <span className="text-white">{p.userName}</span>{" "}
                        <span className="text-river-300">paddled</span>{" "}
                        <span className="text-sunset-300">
                          {p.routeName ?? "a quick start paddle"}
                        </span>
                      </p>
                    </div>
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

                  {showFooter ? (
                    <div className="relative z-20 mt-2 flex items-center justify-between gap-2">
                      <ReactionBar
                        paddleId={p.id}
                        reactions={p.reactions}
                        myReactions={p.myReactions}
                        size="sm"
                        variant="dark"
                      />
                      <Link
                        href={`/paddles/${p.id}#comments`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-river-300 hover:text-river-100 shrink-0 text-xs font-semibold"
                      >
                        💬 {p.commentCount}
                      </Link>
                    </div>
                  ) : null}
                </div>
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
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-sunset-500 text-white"
          : "border-river-300 text-river-200 hover:bg-river-800 border"
      }`}
    >
      {children}
    </button>
  );
}
