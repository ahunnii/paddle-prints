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
 * remaining / ETA); `?paddle=<id>` retraces another paddler's logged track (same nav experience, but
 * saves with `routeId: null` since it isn't itself a saved route); with neither it's a free paddle.
 * Session-gated.
 */
export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; paddle?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { route: routeId, paddle: paddleId } = await searchParams;

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
        // Per-leg flow directions, measured against `r.geom` -- drives the nav-map arrows.
        flowLegs: r.flowLegs ?? null,
        pois: r.pois.map((p) => ({
          id: p.id,
          category: p.category,
          note: p.note,
          routeDistM: p.routeDistM,
          lng: p.geom.coordinates[0]!,
          lat: p.geom.coordinates[1]!,
        })),
        historicalSpeedMps: eta.speedMps,
        saveRouteId: r.id,
      };
    } catch (err) {
      // A bad/removed route id just falls back to a free paddle rather than erroring the page.
      // A non-uuid id surfaces as BAD_REQUEST from input validation -- same treatment.
      const recoverable =
        err instanceof TRPCError &&
        (err.code === "NOT_FOUND" || err.code === "BAD_REQUEST");
      if (!recoverable) throw err;
      redirect("/record");
    }
  } else if (paddleId) {
    try {
      const p = await api.paddles.byId({ id: paddleId });
      if (!p.trackGeom || p.trackGeom.coordinates.length < 2) {
        // Nothing to retrace -- treat like a missing id and fall back to a free paddle.
        throw new TRPCError({ code: "NOT_FOUND", message: "No track to retrace" });
      }
      route = {
        id: p.id,
        name: `Retracing ${p.userName}'s paddle`,
        distanceM: p.distanceM,
        shape: "one_way",
        type: p.tripType,
        coords: p.trackGeom.coordinates.map(
          (c) => [c[0], c[1]] as [number, number],
        ),
        pois: [],
        historicalSpeedMps: p.avgSpeedMps,
        // Not a saved route -- the finished paddle must not point at another paddle's id via routeId.
        saveRouteId: null,
      };
    } catch (err) {
      // A bad/removed paddle id (or one with no usable track) falls back to a free paddle, same as
      // an invalid route id. Non-uuid ids surface as BAD_REQUEST from input validation.
      const recoverable =
        err instanceof TRPCError &&
        (err.code === "NOT_FOUND" || err.code === "BAD_REQUEST");
      if (!recoverable) throw err;
      redirect("/record");
    }
  }

  return <RecordClient route={route} />;
}
