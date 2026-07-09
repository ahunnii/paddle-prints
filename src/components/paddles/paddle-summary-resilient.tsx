"use client";

/**
 * The paddle summary, resilient to the paddle not (yet) being on the server. The server component
 * passes `server` when it could read the paddle from the DB; otherwise this reads the queued paddle
 * straight from IndexedDB (the just-finished / offline case) and renders the same summary with a
 * "waiting to sync" badge. The map draws from the cached trip's route geometry + the queued track, so
 * it works with zero network.
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { FloatingHeader } from "~/components/layout/floating-header";
import { PaddleMap } from "~/components/paddles/paddle-map";
import { db } from "~/lib/offline/db";

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

export interface SummaryData {
  id: string;
  userName: string | null;
  routeId: string | null;
  routeName: string | null;
  startedAt: string;
  elapsedS: number;
  movingS: number;
  distanceM: number;
  avgSpeedMps: number;
  trackCoords: Array<[number, number]> | null;
  routeCoords: Array<[number, number]> | null;
  pending: boolean;
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
      pending: true,
    };
    return data;
  }, [id, !!server]);

  const data = server ?? local;

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
        trackCoords={data.trackCoords}
        className="h-full w-full"
      />

      <FloatingHeader backHref="/" backLabel="Home" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-4 rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur">
          <div>
            <div className="flex items-center gap-2">
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
                  "a free paddle"
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
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <Cell label="Distance" value={`${distanceMi} mi`} />
            <Cell label="Elapsed" value={formatElapsed(data.elapsedS)} />
            <Cell label="Moving" value={formatElapsed(data.movingS)} />
            <Cell label="Avg speed" value={`${avgMph} mph`} />
          </div>
        </div>
      </div>
    </main>
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
