import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BaseMap } from "~/components/map/base-map";
import { auth } from "~/server/auth";

export default async function MapPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="relative h-dvh w-dvw">
      <BaseMap className="h-full w-full" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 shadow-lg backdrop-blur">
          <Link
            href="/"
            className="text-river-700 hover:text-river-900 text-sm font-semibold"
          >
            ← Back
          </Link>
          <span className="text-river-200">|</span>
          <span className="text-river-900 text-sm font-medium">
            Community map
          </span>
          <span className="text-river-400 text-xs">
            (POIs coming in Phase 5)
          </span>
        </div>
      </div>
    </main>
  );
}
