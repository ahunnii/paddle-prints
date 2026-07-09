import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DeleteRouteButton } from "~/components/routes/delete-route-button";
import { RouteMap } from "~/components/routes/route-map";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

const METERS_PER_MILE = 1609.344;

function formatDistance(distanceM: number, shape: "one_way" | "out_and_back") {
  const miles = (distanceM / METERS_PER_MILE) * (shape === "out_and_back" ? 2 : 1);
  return `${miles.toFixed(1)} mi${shape === "out_and_back" ? " (round trip)" : ""}`;
}

function typeLabel(type: "river" | "waypoint") {
  return type === "waypoint" ? "🌊 Lake / open water" : "🏞️ River";
}

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;

  let route: Awaited<ReturnType<typeof api.routes.byId>>;
  try {
    route = await api.routes.byId({ id });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
  }

  return (
    <main className="relative h-dvh w-dvw">
      <RouteMap
        geometry={route.geom}
        shape={route.shape}
        className="h-full w-full"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 shadow-lg backdrop-blur">
          <Link
            href="/routes"
            className="text-river-700 hover:text-river-900 text-sm font-semibold"
          >
            ← Back
          </Link>
          <span className="text-river-200">|</span>
          <span className="text-river-900 max-w-[14rem] truncate text-sm font-medium">
            {route.name}
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-4 rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur">
          <div>
            <h1 className="text-river-950 text-xl font-extrabold tracking-tight">
              {route.name}
            </h1>
            <p className="text-river-600 text-sm">
              {typeLabel(route.type)} &middot;{" "}
              {route.shape === "out_and_back" ? "Out & back" : "One-way"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-river-50 p-3">
              <p className="text-river-500 text-xs uppercase tracking-wide">
                Distance
              </p>
              <p className="text-river-950 font-bold">
                {formatDistance(route.distanceM, route.shape)}
              </p>
            </div>
            <div className="rounded-xl bg-river-50 p-3">
              <p className="text-river-500 text-xs uppercase tracking-wide">
                Created
              </p>
              <p className="text-river-950 font-bold">
                {route.creatorName}
              </p>
              <p className="text-river-600 text-xs">
                {new Date(route.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {route.shape === "out_and_back" ? (
            <p className="text-river-600 text-xs">
              Turns around at the far marker and retraces the same path back
              to the start.
            </p>
          ) : null}

          <div>
            <p className="text-river-500 mb-1 text-xs uppercase tracking-wide">
              Spots along the way
            </p>
            {route.pois.length === 0 ? (
              <p className="text-river-400 text-sm italic">
                No spots marked yet
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {route.pois.map((poi) => (
                  <li key={poi.id} className="text-river-700 text-sm">
                    {poi.category}
                    {poi.note ? ` — ${poi.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Link
              href={`/record?route=${route.id}`}
              className="bg-sunset-500 hover:bg-sunset-600 flex min-h-11 items-center justify-center rounded-xl font-semibold text-white shadow-lg transition-colors"
            >
              Start paddle
            </Link>
            <button
              type="button"
              disabled
              title="Phase 6"
              className="min-h-11 cursor-not-allowed rounded-xl bg-river-100 font-semibold text-river-400"
            >
              Download for offline (Phase 6)
            </button>
            <DeleteRouteButton routeId={route.id} />
          </div>
        </div>
      </div>
    </main>
  );
}
