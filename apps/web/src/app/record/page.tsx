import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  RecordClient,
  type RecordRoute,
} from "~/components/record/record-client";
import { auth } from "@paddle-prints/auth";
import { api } from "~/trpc/server";

/**
 * On-water recording screen. `?route=<id>` ties the paddle to a saved route (showing progress /
 * remaining / ETA); with no route it's a free paddle. Session-gated.
 */
export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { route: routeId } = await searchParams;

  let route: RecordRoute | null = null;
  if (routeId) {
    try {
      // Fetched in parallel: the ETA call can never itself be the reason this route falls back to a
      // free paddle (it can only 404 if the route itself is gone, which `routes.byId` already guards).
      const [r, eta] = await Promise.all([
        api.routes.byId({ id: routeId }),
        api.routes.etaForUser({ routeId }),
      ]);
      route = {
        id: r.id,
        name: r.name,
        distanceM: r.distanceM,
        shape: r.shape,
        type: r.type,
        coords: r.geom.coordinates.map(
          (c) => [c[0], c[1]] as [number, number],
        ),
        pois: r.pois.map((p) => ({
          id: p.id,
          category: p.category,
          note: p.note,
          routeDistM: p.routeDistM,
          lng: p.geom.coordinates[0]!,
          lat: p.geom.coordinates[1]!,
        })),
        historicalSpeedMps: eta.speedMps,
      };
    } catch (err) {
      // A bad/removed route id just falls back to a free paddle rather than erroring the page.
      if (!(err instanceof TRPCError && err.code === "NOT_FOUND")) throw err;
      redirect("/record");
    }
  }

  return <RecordClient route={route} />;
}
