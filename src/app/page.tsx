import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "~/app/_components/sign-out-button";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

function shortElapsed(totalS: number) {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m} min`;
}

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const feed = await api.paddles.feed();

  return (
    <main className="from-river-800 to-river-950 min-h-dvh bg-gradient-to-b px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">🛶</span>
            <h1 className="text-xl font-extrabold tracking-tight">
              Ahoy, {session.user.name}
            </h1>
          </div>
          <SignOutButton />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/map"
            className="bg-sunset-500 hover:bg-sunset-600 rounded-full px-4 py-2 text-sm font-semibold shadow-lg transition-colors"
          >
            🗺️ Map
          </Link>
          <Link
            href="/routes"
            className="border-river-300 text-river-100 hover:bg-river-800 rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
          >
            🛶 Routes
          </Link>
          <Link
            href="/routes/new"
            className="border-river-300 text-river-100 hover:bg-river-800 rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
          >
            ➕ New route
          </Link>
          <Link
            href="/record"
            className="border-river-300 text-river-100 hover:bg-river-800 rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
          >
            ⏺️ Free paddle
          </Link>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-river-200 text-xs font-bold uppercase tracking-widest">
            Crew feed
          </h2>

          {feed.length === 0 ? (
            <div className="border-river-700 rounded-2xl border border-dashed p-6 text-center">
              <p className="text-river-200 text-sm">
                No paddles logged yet. Pick a route and tap Start paddle to be
                first on the board.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {feed.map((p) => {
                const miles = (p.distanceM / METERS_PER_MILE).toFixed(1);
                const mph = (p.avgSpeedMps * MPS_TO_MPH).toFixed(1);
                return (
                  <li key={p.id}>
                    <Link
                      href={`/paddles/${p.id}`}
                      className="bg-river-900/60 hover:bg-river-900 block rounded-2xl p-4 shadow transition-colors"
                    >
                      <p className="font-semibold">
                        <span className="text-white">{p.userName}</span>{" "}
                        <span className="text-river-300">paddled</span>{" "}
                        <span className="text-sunset-300">
                          {p.routeName ?? "a free paddle"}
                        </span>
                      </p>
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
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
