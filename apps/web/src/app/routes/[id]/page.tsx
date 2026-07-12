import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FloatingHeader } from "~/components/layout/floating-header";
import { DeleteRouteButton } from "~/components/routes/delete-route-button";
import { DownloadTripButton } from "~/components/offline/download-trip-button";
import { RouteMap } from "~/components/routes/route-map";
import { YourPaceCard } from "~/components/routes/your-pace-card";
import { poiHeadline, poiMeta } from "~/lib/pois";
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

  // The ETA card can't 404 the page -- a route with no eligible history still renders a "default"
  // tier estimate, so this call can't itself throw NOT_FOUND once `route` above succeeded.
  const eta = await api.routes.etaForUser({ routeId: id });

  const sortedPois = [...route.pois].sort((a, b) => a.routeDistM - b.routeDistM);

  return (
    <main className="relative h-dvh w-dvw">
      <RouteMap
        geometry={route.geom}
        shape={route.shape}
        pois={sortedPois.map((poi) => ({
          id: poi.id,
          category: poi.category,
          note: poi.note,
          lng: poi.geom.coordinates[0]!,
          lat: poi.geom.coordinates[1]!,
          creatorName: poi.creatorName,
          createdAt: poi.createdAt,
        }))}
        className="h-full w-full"
      />

      <FloatingHeader backHref="/routes" title={route.name} />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex max-h-[80dvh] w-full max-w-md flex-col gap-4 overflow-y-auto overscroll-contain rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur">
          <div>
            <h1 className="text-river-950 font-display text-xl font-extrabold tracking-tight">
              {route.name}
            </h1>
            <p className="text-river-600 text-sm">
              {typeLabel(route.type)} &middot;{" "}
              {route.shape === "out_and_back" ? "Out & back" : "One-way"}
            </p>
            {route.description ? (
              <p className="text-river-700 mt-2 text-sm">
                {route.description}
              </p>
            ) : null}
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

          <YourPaceCard
            eta={{
              source: eta.source,
              speedMps: eta.speedMps,
              estimates: eta.estimates,
              pastTimes: eta.pastTimes?.map((p) => ({
                startedAt: p.startedAt.toISOString(),
                elapsedS: p.elapsedS,
                movingS: p.movingS,
                distanceM: p.distanceM,
              })),
            }}
            shape={route.shape}
            routeType={route.type}
          />

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
            {sortedPois.length === 0 ? (
              <p className="text-river-400 text-sm italic">
                📍 No spots marked yet &mdash; long-press the map while
                paddling to drop one
              </p>
            ) : (
              <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto overscroll-contain">
                {sortedPois.map((poi) => (
                  <li key={poi.id} className="text-river-700 text-sm">
                    <span className="font-semibold">
                      {poiMeta(poi.category).emoji} {poiHeadline(poi)}
                    </span>
                    <span className="text-river-400">
                      {" "}
                      — {(poi.routeDistM / METERS_PER_MILE).toFixed(1)} mi in
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Link
              href={`/record?route=${route.id}`}
              className="bg-sunset-500 hover:bg-sunset-600 active:scale-[0.98] active:bg-sunset-600 flex min-h-11 items-center justify-center rounded-xl font-semibold text-white shadow-lg transition-colors"
            >
              Start paddle
            </Link>
            <DownloadTripButton routeId={route.id} />
            {session.user.id === route.createdBy ? (
              <DeleteRouteButton routeId={route.id} />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
