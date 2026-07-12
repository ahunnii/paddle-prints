import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DownloadedBadge } from "~/components/offline/downloaded-badge";
import { auth } from "@paddle-prints/auth";
import { api } from "~/trpc/server";

const METERS_PER_MILE = 1609.344;

function formatDistance(distanceM: number, shape: "one_way" | "out_and_back") {
  const miles = (distanceM / METERS_PER_MILE) * (shape === "out_and_back" ? 2 : 1);
  return `${miles.toFixed(1)} mi${shape === "out_and_back" ? " (round trip)" : ""}`;
}

function typeIcon(type: "river" | "waypoint") {
  return type === "waypoint" ? "🌊" : "🏞️";
}

export default async function CommunityRoutesPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const routes = await api.routes.list({ scope: "all" });

  return (
    <main className="from-river-800 to-river-950 min-h-dvh bg-gradient-to-b px-4 pb-28 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/"
              className="text-river-200 hover:text-white text-sm font-semibold"
            >
              ← Back
            </Link>
            <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight text-white">
              Community Routes
            </h1>
          </div>
        </div>

        {routes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-white/10 p-10 text-center">
            <span className="text-4xl">🛶</span>
            <p className="text-river-100 text-lg font-medium">No routes yet</p>
            <Link
              href="/routes/new"
              className="bg-sunset-500 hover:bg-sunset-600 active:scale-[0.98] active:bg-sunset-600 mt-2 rounded-full px-6 py-2.5 font-semibold text-white shadow-lg transition-colors"
            >
              + Plan a Route
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {routes.map((route) => (
              <li key={route.id}>
                <Link
                  href={`/routes/${route.id}`}
                  className="flex items-center gap-4 rounded-2xl bg-white/95 p-4 shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.99]"
                >
                  <span className="text-3xl">{typeIcon(route.type)}</span>
                  <div className="flex flex-1 flex-col">
                    <span className="text-river-950 flex items-center gap-2 font-semibold">
                      {route.name}
                      <DownloadedBadge routeId={route.id} />
                    </span>
                    <span className="text-river-600 text-sm">
                      {formatDistance(route.distanceM, route.shape)} &middot;{" "}
                      {route.creatorName} &middot;{" "}
                      {new Date(route.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Link
          href="/routes/new"
          className="bg-sunset-500 hover:bg-sunset-600 active:scale-[0.98] active:bg-sunset-600 pointer-events-auto flex min-h-11 items-center gap-2 rounded-full px-6 py-3 font-semibold text-white shadow-2xl transition-colors"
        >
          + Plan a Route
        </Link>
      </div>
    </main>
  );
}
