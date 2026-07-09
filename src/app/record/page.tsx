import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  RecordClient,
  type RecordRoute,
} from "~/components/record/record-client";
import { auth } from "~/server/auth";
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
      const r = await api.routes.byId({ id: routeId });
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
        })),
      };
    } catch (err) {
      // A bad/removed route id just falls back to a free paddle rather than erroring the page.
      if (!(err instanceof TRPCError && err.code === "NOT_FOUND")) throw err;
      redirect("/record");
    }
  }

  return <RecordClient route={route} />;
}
