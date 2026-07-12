import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FeedList } from "~/components/feed/feed-list";
import { InstallNudge } from "~/components/offline/install-nudge";
import { MeLink } from "~/components/offline/me-link";
import { auth } from "@paddle-prints/auth";
import { api } from "~/trpc/server";

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
            <h1 className="font-display text-xl font-extrabold tracking-tight">
              Ahoy, {session.user.name}
            </h1>
          </div>
          <MeLink />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/map"
            className="bg-sunset-500 hover:bg-sunset-600 active:bg-sunset-600 active:scale-[0.97] flex items-center justify-center rounded-full px-4 py-2 text-center text-sm font-semibold shadow-lg transition-colors"
          >
            🗺️ Map
          </Link>
          <Link
            href="/routes"
            className="border-river-300 text-river-100 hover:bg-river-800 active:bg-river-800 active:scale-[0.97] flex items-center justify-center rounded-full border px-4 py-2 text-center text-sm font-semibold transition-colors"
          >
            🛶 My Routes
          </Link>
          <Link
            href="/routes/community"
            className="border-river-300 text-river-100 hover:bg-river-800 active:bg-river-800 active:scale-[0.97] flex items-center justify-center rounded-full border px-4 py-2 text-center text-sm font-semibold transition-colors"
          >
            🌍 Community Routes
          </Link>
          <Link
            href="/routes/new"
            className="border-river-300 text-river-100 hover:bg-river-800 active:bg-river-800 active:scale-[0.97] flex items-center justify-center rounded-full border px-4 py-2 text-center text-sm font-semibold transition-colors"
          >
            ➕ Plan a Route
          </Link>
          <Link
            href="/record"
            className="border-river-300 text-river-100 hover:bg-river-800 active:bg-river-800 active:scale-[0.97] col-span-2 flex items-center justify-center rounded-full border px-4 py-2 text-center text-sm font-semibold transition-colors"
          >
            ⏺️ Quick Start Paddle
          </Link>
        </div>

        <InstallNudge />

        <section className="flex flex-col gap-3">
          <h2 className="text-river-200 text-xs font-bold uppercase tracking-widest">
            Recent Crew Activity
          </h2>

          <FeedList initial={feed} />
        </section>
      </div>
    </main>
  );
}
