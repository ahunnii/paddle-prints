import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PaddleMap } from "~/components/paddles/paddle-map";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

function formatElapsed(totalS: number) {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export default async function PaddleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { id } = await params;

  let paddle: Awaited<ReturnType<typeof api.paddles.byId>>;
  try {
    paddle = await api.paddles.byId({ id });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const trackCoords =
    paddle.trackGeom?.coordinates.map((c) => [c[0], c[1]] as [number, number]) ??
    null;
  const routeCoords =
    paddle.routeGeom?.coordinates.map((c) => [c[0], c[1]] as [number, number]) ??
    null;

  const avgMph = (paddle.avgSpeedMps * MPS_TO_MPH).toFixed(1);
  const distanceMi = (paddle.distanceM / METERS_PER_MILE).toFixed(2);

  return (
    <main className="relative h-dvh w-dvw">
      <PaddleMap
        routeCoords={routeCoords}
        trackCoords={trackCoords}
        className="h-full w-full"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 shadow-lg backdrop-blur">
          <Link href="/" className="text-river-700 hover:text-river-900 text-sm font-semibold">
            ← Home
          </Link>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-4 rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur">
          <div>
            <h1 className="text-river-950 text-xl font-extrabold tracking-tight">
              {paddle.userName} paddled{" "}
              {paddle.routeId && paddle.routeName ? (
                <Link href={`/routes/${paddle.routeId}`} className="text-sunset-600 underline">
                  {paddle.routeName}
                </Link>
              ) : (
                "a free paddle"
              )}
            </h1>
            <p className="text-river-600 text-sm">
              {new Date(paddle.startedAt).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <Cell label="Distance" value={`${distanceMi} mi`} />
            <Cell label="Elapsed" value={formatElapsed(paddle.elapsedS)} />
            <Cell label="Moving" value={formatElapsed(paddle.movingS)} />
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
