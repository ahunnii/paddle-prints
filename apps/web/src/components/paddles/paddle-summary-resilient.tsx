"use client";

/**
 * The paddle summary, resilient to the paddle not (yet) being on the server. The server component
 * passes `server` when it could read the paddle from the DB; otherwise this reads the queued paddle
 * straight from IndexedDB (the just-finished / offline case) and renders the same summary with a
 * "waiting to sync" badge. The map draws from the cached trip's route geometry + the queued track, so
 * it works with zero network.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { CommentThread } from "~/components/paddles/comment-thread";
import { PaddleDifficultyEditor } from "~/components/paddles/paddle-difficulty-editor";
import { FloatingHeader } from "~/components/layout/floating-header";
import type { FlowLeg } from "~/components/map/flow-arrow-layer";
import { PaddleMap } from "~/components/paddles/paddle-map";
import { ReactionBar } from "~/components/paddles/reaction-bar";
import { DifficultyBadge } from "~/components/routes/difficulty-badge";
import { Avatar } from "~/components/ui/avatar";
import { toast } from "~/components/ui/toaster";
import { useSession } from "~/lib/auth-client";
import { db } from "~/lib/offline/db";
import { api } from "~/trpc/react";

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

export interface SummaryData {
  id: string;
  userId?: string;
  userName: string | null;
  userImage: string | null;
  routeId: string | null;
  routeName: string | null;
  startedAt: string;
  elapsedS: number;
  movingS: number;
  distanceM: number;
  avgSpeedMps: number;
  trackCoords: Array<[number, number]> | null;
  routeCoords: Array<[number, number]> | null;
  /** Flow legs of the followed route, over metre ranges of `routeCoords`. Only set for a
   * server-loaded paddle whose route is a river; null for pending/offline or routeless paddles. */
  routeFlowLegs?: FlowLeg[] | null;
  note: string | null;
  difficulty: string | null;
  isOwner: boolean;
  pending: boolean;
  /** Social fields (Phase 3). Only ever populated for server-loaded paddles -- a paddle still
   * queued locally hasn't reached the server yet, so it can't have crew, reactions, comments, or a
   * pin, and the UI below skips rendering all of that for `pending` rows. */
  guestNames?: string[];
  crew?: Array<{ id: string; name: string | null; image: string | null }>;
  commentCount?: number;
  reactions?: Record<string, number>;
  myReactions?: string[];
  pinnedByMe?: boolean;
}

function formatElapsed(totalS: number) {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function PaddleSummaryResilient({
  id,
  server,
}: {
  id: string;
  server: SummaryData | null;
}) {
  // Only queried when the server didn't provide the paddle -- reads the queued copy from IDB.
  const local = useLiveQuery(async () => {
    if (server) return undefined;
    const pending = await db().pendingPaddles.get(id);
    if (!pending) return null;
    const { input } = pending;
    const trip = input.routeId
      ? await db().trips.get(input.routeId)
      : undefined;
    const data: SummaryData = {
      id,
      userName: "You",
      userImage: null,
      routeId: input.routeId,
      routeName: trip?.route.name ?? null,
      startedAt:
        input.startedAt instanceof Date
          ? input.startedAt.toISOString()
          : String(input.startedAt),
      elapsedS: input.elapsedS,
      movingS: input.movingS,
      distanceM: input.distanceM,
      avgSpeedMps: input.avgSpeedMps,
      trackCoords: input.trackGeom?.coordinates ?? null,
      routeCoords: trip?.route.coords ?? null,
      note: input.note ?? null,
      difficulty: input.difficulty ?? null,
      isOwner: true,
      pending: true,
    };
    return data;
  }, [id, !!server]);

  const router = useRouter();

  // Race fix: if a pending paddle syncs away while this summary is open, its pendingPaddles row is
  // deleted -> `local` transitions data -> null and (with no server copy) the page would flip to
  // "not found". Instead refresh so the server component re-reads the now-synced row. Guard against
  // a refresh loop by only firing on the actual data -> null transition.
  const hadLocal = useRef(false);
  useEffect(() => {
    if (server) return;
    if (local) {
      hadLocal.current = true;
    } else if (local === null && hadLocal.current) {
      hadLocal.current = false;
      router.refresh();
    }
  }, [server, local, router]);

  const data = server ?? local;
  const session = useSession();

  if (data === undefined) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-river-950 text-river-200">
        Loading…
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-river-950 px-6 text-center text-white">
        <span className="text-5xl">🛶</span>
        <h1 className="font-display text-xl font-extrabold">Paddle not found here</h1>
        <p className="text-river-300 max-w-xs text-sm">
          This paddle isn&apos;t on the server or on this device. It may belong
          to another paddler, or the link is wrong.
        </p>
        <Link
          href="/"
          className="bg-sunset-500 active:bg-sunset-600 rounded-xl px-4 py-2 font-semibold text-white"
        >
          Home
        </Link>
      </main>
    );
  }

  const avgMph = (data.avgSpeedMps * MPS_TO_MPH).toFixed(1);
  const distanceMi = (data.distanceM / METERS_PER_MILE).toFixed(2);

  return (
    <main className="relative h-dvh w-dvw">
      <PaddleMap
        routeCoords={data.routeCoords}
        routeFlowLegs={data.routeFlowLegs ?? null}
        trackCoords={data.trackCoords}
        className="h-full w-full"
      />

      <FloatingHeader backHref="/" backLabel="Home" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex max-h-[80vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur">
          <div>
            <div className="flex items-center gap-2">
              <Avatar
                name={data.userName ?? "Someone"}
                image={data.userImage}
                size="sm"
              />
              <h1 className="text-river-950 font-display text-xl font-extrabold tracking-tight">
                {data.userName ?? "Someone"} paddled{" "}
                {data.routeId && data.routeName ? (
                  <Link
                    href={`/routes/${data.routeId}`}
                    className="text-sunset-600 underline"
                  >
                    {data.routeName}
                  </Link>
                ) : (
                  "a quick start paddle"
                )}
              </h1>
              {data.pending ? (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                  Waiting to sync
                </span>
              ) : null}
            </div>
            <p className="text-river-600 text-sm">
              {new Date(data.startedAt).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <div className="mt-1">
              {data.isOwner && !data.pending ? (
                <PaddleDifficultyEditor
                  paddleId={data.id}
                  difficulty={data.difficulty}
                />
              ) : (
                <DifficultyBadge difficulty={data.difficulty} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <Cell label="Distance" value={`${distanceMi} mi`} />
            <Cell label="Elapsed" value={formatElapsed(data.elapsedS)} />
            <Cell label="Moving" value={formatElapsed(data.movingS)} />
            <Cell label="Avg speed" value={`${avgMph} mph`} />
          </div>

          {data.pending && data.isOwner ? (
            <div className="flex justify-end">
              <DeletePaddleButton id={data.id} pending />
            </div>
          ) : null}

          {!data.pending ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <ReactionBar
                  paddleId={data.id}
                  reactions={data.reactions ?? {}}
                  myReactions={data.myReactions ?? []}
                  variant="light"
                />
                <div className="flex items-center gap-2">
                  <PinButton
                    paddleId={data.id}
                    pinnedByMe={data.pinnedByMe ?? false}
                  />
                  {data.isOwner ? (
                    <DeletePaddleButton id={data.id} pending={false} />
                  ) : null}
                </div>
              </div>

              <CrewRow crew={data.crew ?? []} guestNames={data.guestNames ?? []} />

              <Link
                href={
                  data.routeId
                    ? `/record?route=${data.routeId}`
                    : `/record?paddle=${data.id}`
                }
                className="bg-sunset-500 active:bg-sunset-600 flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white"
              >
                🛶 Paddle this
              </Link>
            </>
          ) : null}

          <PaddleNote
            id={id}
            note={data.note}
            isOwner={data.isOwner}
            pending={data.pending}
          />

          {!data.pending ? (
            <CommentThread paddleId={data.id} myUserId={session.data?.user.id} />
          ) : null}
        </div>
      </div>
    </main>
  );
}

/** Bookmark-style pin toggle. Optimistic: flips immediately, reverts on mutation failure. */
function PinButton({
  paddleId,
  pinnedByMe,
}: {
  paddleId: string;
  pinnedByMe: boolean;
}) {
  const [pinned, setPinned] = useState(pinnedByMe);
  const toggle = api.social.pinToggle.useMutation({
    onSuccess: (data) => setPinned(data.pinned),
    onError: () => setPinned((p) => !p),
  });

  return (
    <button
      type="button"
      onClick={() => {
        setPinned((p) => !p);
        toggle.mutate({ paddleId });
      }}
      disabled={toggle.isPending}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
        pinned
          ? "border-sunset-500 bg-sunset-500/15 text-sunset-600"
          : "border-river-200 text-river-600 hover:bg-river-50"
      }`}
    >
      {pinned ? "📌 Pinned" : "📌 Pin this paddle"}
    </button>
  );
}

/**
 * Owner-only destructive delete. Confirms via native dialog, then removes the paddle -- through
 * `paddles.delete` for an already-synced paddle, or by dropping its queued row for one still
 * `pending` -- and navigates home.
 */
function DeletePaddleButton({ id, pending }: { id: string; pending: boolean }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const del = api.paddles.delete.useMutation();

  async function handleDelete() {
    if (!window.confirm("Delete this paddle? This can't be undone.")) return;
    setDeleting(true);
    try {
      if (pending) {
        await db().pendingPaddles.delete(id);
      } else {
        await del.mutateAsync({ id });
      }
      toast("Paddle deleted");
      router.push("/");
    } catch {
      toast("Couldn't delete the paddle. Try again.", "error");
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleDelete()}
      disabled={deleting}
      className="shrink-0 rounded-full border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
    >
      {deleting ? "Deleting…" : "Delete"}
    </button>
  );
}

/** "With <crew>, and guests <names>" -- only rendered when there's someone to show. */
function CrewRow({
  crew,
  guestNames,
}: {
  crew: Array<{ id: string; name: string | null; image: string | null }>;
  guestNames: string[];
}) {
  if (crew.length === 0 && guestNames.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-sm">
      <span className="text-river-600">With</span>
      {crew.map((c) => (
        <span
          key={c.id}
          className="bg-river-50 inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2"
        >
          <Avatar name={c.name ?? "Someone"} image={c.image} size="sm" />
          <span className="text-river-950 font-semibold">
            {c.name ?? "Someone"}
          </span>
        </span>
      ))}
      {guestNames.length > 0 ? (
        <span className="text-river-700">
          {crew.length > 0 ? "and guests " : "guests "}
          <span className="font-semibold">{guestNames.join(", ")}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * The trip note on the summary card. A read-only paragraph for everyone; owners get an Edit toggle
 * that swaps in a textarea. Save routes to the queue (pending paddle, dotted-keypath Dexie update so
 * the note ships with the eventual create) or to `updateNote` (already-synced paddle).
 */
function PaddleNote({
  id,
  note,
  isOwner,
  pending,
}: {
  id: string;
  note: string | null;
  isOwner: boolean;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Local display copy so a synced edit is reflected immediately without a full refresh. Reseeded
  // from the prop when not editing (e.g. a pending row's live note changes underneath us).
  const [display, setDisplay] = useState(note);
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const updateNote = api.paddles.updateNote.useMutation();

  const lastPropNote = useRef(note);
  useEffect(() => {
    // Reseed only when the incoming prop actually changes -- the editing flag flipping false
    // after a save must not clobber the freshly saved value with the stale server prop.
    if (note !== lastPropNote.current) {
      lastPropNote.current = note;
      if (!editing) setDisplay(note);
    }
  }, [note, editing]);

  async function save() {
    const trimmed = draft.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    setSaving(true);
    try {
      if (pending) {
        // Dexie dotted-keypath update: patches input.note inside the queued row in place, so the
        // note travels with the create when the queue drains. useLiveQuery re-renders the summary.
        await db().pendingPaddles.update(id, { "input.note": value });
        setDisplay(value);
      } else {
        const row = await updateNote.mutateAsync({ id, note: trimmed });
        setDisplay(row.note);
      }
      toast("Note saved");
      setEditing(false);
    } catch {
      toast("Couldn't save the note. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          maxLength={2000}
          autoFocus
          placeholder="Conditions, wildlife, who came along…"
          className="text-river-950 placeholder:text-river-400 focus:border-river-400 w-full resize-none rounded-xl border border-river-200 bg-white px-3 py-2 text-sm outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="bg-sunset-500 active:bg-sunset-600 rounded-xl px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(display ?? "");
              setEditing(false);
            }}
            disabled={saving}
            className="text-river-600 rounded-xl px-4 py-1.5 text-sm font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!display && !isOwner) return null;

  return (
    <div className="flex flex-col gap-1">
      {display ? (
        <p className="text-river-700 whitespace-pre-wrap text-sm">{display}</p>
      ) : (
        <p className="text-river-400 text-sm italic">No notes yet.</p>
      )}
      {isOwner ? (
        <button
          type="button"
          onClick={() => {
            setDraft(display ?? "");
            setEditing(true);
          }}
          className="text-sunset-600 self-start text-sm font-semibold"
        >
          {display ? "Edit note" : "Add a note"}
        </button>
      ) : null}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-river-50 rounded-xl p-3">
      <p className="text-river-500 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-river-950 font-bold tabular-nums">{value}</p>
    </div>
  );
}
