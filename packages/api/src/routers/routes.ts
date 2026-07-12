import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { DEFAULT_HISTORICAL_SPEED_MPS } from "@paddle-prints/recorder-core/constants";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { user } from "@paddle-prints/db/auth-schema";
import { paddles, pois, routeShape, routeType, routes } from "@paddle-prints/db/schema";

/** Mean of a non-empty array of speeds. Callers only invoke this after checking `.length > 0`. */
function avgSpeed(speeds: number[]): number {
  return speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
}

/** Second join alias for `user` -- corridor POIs need their own creator, distinct from the route's. */
const poiCreator = alias(user, "poi_creator");

/**
 * Zod schema for a GeoJSON `LineString` geometry: at least two `[lng, lat]` coordinate pairs,
 * with each coordinate validated to be within valid longitude/latitude ranges.
 */
const lineStringGeometry = z.object({
  type: z.literal("LineString"),
  coordinates: z
    .array(
      z.tuple([
        z.number().min(-180).max(180), // lng
        z.number().min(-90).max(90), // lat
      ]),
    )
    .min(2, "A route needs at least 2 points"),
});

export const routesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        type: z.enum(routeType.enumValues),
        shape: z.enum(routeShape.enumValues),
        geometry: lineStringGeometry,
        description: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const geometryJson = JSON.stringify(input.geometry);

      const [route] = await ctx.db
        .insert(routes)
        .values({
          name: input.name,
          type: input.type,
          shape: input.shape,
          geom: input.geometry,
          description:
            input.description && input.description.length > 0
              ? input.description
              : null,
          // Never trust a client-supplied distance -- recompute it authoritatively from the
          // submitted geometry using a geography cast (accounts for the earth's curvature).
          distanceM: sql<number>`ST_Length(ST_GeomFromGeoJSON(${geometryJson})::geography)`,
          createdBy: ctx.session.user.id,
        })
        .returning();

      if (!route) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create route",
        });
      }

      return route;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: routes.id,
        name: routes.name,
        type: routes.type,
        shape: routes.shape,
        distanceM: routes.distanceM,
        createdAt: routes.createdAt,
        creatorName: user.name,
      })
      .from(routes)
      .innerJoin(user, eq(routes.createdBy, user.id))
      .orderBy(desc(routes.createdAt));
  }),

  /** Lightweight id/name/geom for every route, for drawing all saved lines on the community map. */
  listGeoms: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: routes.id, name: routes.name, geom: routes.geom })
      .from(routes);
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [route] = await ctx.db
        .select({
          id: routes.id,
          name: routes.name,
          type: routes.type,
          shape: routes.shape,
          geom: routes.geom,
          distanceM: routes.distanceM,
          description: routes.description,
          createdBy: routes.createdBy,
          createdAt: routes.createdAt,
          creatorName: user.name,
        })
        .from(routes)
        .innerJoin(user, eq(routes.createdBy, user.id))
        .where(eq(routes.id, input.id));

      if (!route) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Route not found" });
      }

      const routeGeomJson = JSON.stringify(route.geom);

      const nearbyPois = await ctx.db
        .select({
          id: pois.id,
          category: pois.category,
          note: pois.note,
          geom: pois.geom,
          createdAt: pois.createdAt,
          creatorName: poiCreator.name,
          // Distance along the route line (in meters from the start) so the UI can order/place
          // POIs along the corridor.
          routeDistM: sql<number>`ST_LineLocatePoint(ST_GeomFromGeoJSON(${routeGeomJson}), ${pois.geom}) * ${route.distanceM}`,
        })
        .from(pois)
        .innerJoin(poiCreator, eq(pois.createdBy, poiCreator.id))
        .where(
          sql`ST_DWithin(${pois.geom}::geography, ST_GeomFromGeoJSON(${routeGeomJson})::geography, 150)`,
        );

      const recentPaddles = await ctx.db
        .select({
          id: paddles.id,
          startedAt: paddles.startedAt,
          elapsedS: paddles.elapsedS,
          movingS: paddles.movingS,
          distanceM: paddles.distanceM,
          avgSpeedMps: paddles.avgSpeedMps,
          userName: user.name,
        })
        .from(paddles)
        .innerJoin(user, eq(paddles.userId, user.id))
        .where(eq(paddles.routeId, input.id))
        .orderBy(desc(paddles.startedAt))
        .limit(10);

      return { ...route, pois: nearbyPois, paddles: recentPaddles };
    }),

  /**
   * A personal ETA estimate for this route, in three tiers of decreasing specificity:
   *  1. "exact"   -- the user has paddled THIS route before: average their own `avgSpeedMps` on it.
   *  2. "typeAvg" -- no history on this route, but they have paddles of the same `tripType`
   *                  (river vs. lake/open-water): average across those instead.
   *  3. "default" -- no history at all: fall back to a generic cruising speed.
   * `estimates` always includes both one-way and round-trip seconds; the caller picks based on the
   * route's `shape`.
   */
  etaForUser: protectedProcedure
    .input(z.object({ routeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [route] = await ctx.db
        .select({ distanceM: routes.distanceM, type: routes.type })
        .from(routes)
        .where(eq(routes.id, input.routeId));

      if (!route) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Route not found" });
      }

      const estimatesFor = (speedMps: number) => {
        const oneWayS = route.distanceM / speedMps;
        return { oneWayS, roundTripS: oneWayS * 2 };
      };

      // Tier 1: the user's own history on this exact route, newest first.
      const exactPaddles = await ctx.db
        .select({
          startedAt: paddles.startedAt,
          elapsedS: paddles.elapsedS,
          movingS: paddles.movingS,
          distanceM: paddles.distanceM,
          avgSpeedMps: paddles.avgSpeedMps,
        })
        .from(paddles)
        .where(
          and(
            eq(paddles.routeId, input.routeId),
            eq(paddles.userId, ctx.session.user.id),
          ),
        )
        .orderBy(desc(paddles.startedAt));

      if (exactPaddles.length > 0) {
        const speedMps = avgSpeed(exactPaddles.map((p) => p.avgSpeedMps));
        return {
          source: "exact" as const,
          speedMps,
          estimates: estimatesFor(speedMps),
          pastTimes: exactPaddles.slice(0, 5).map((p) => ({
            startedAt: p.startedAt,
            elapsedS: p.elapsedS,
            movingS: p.movingS,
            distanceM: p.distanceM,
          })),
        };
      }

      // Tier 2: the user's history on any route of the same trip type (river vs. lake/open-water).
      const typePaddles = await ctx.db
        .select({ avgSpeedMps: paddles.avgSpeedMps })
        .from(paddles)
        .where(
          and(
            eq(paddles.userId, ctx.session.user.id),
            eq(paddles.tripType, route.type),
          ),
        );

      if (typePaddles.length > 0) {
        const speedMps = avgSpeed(typePaddles.map((p) => p.avgSpeedMps));
        return {
          source: "typeAvg" as const,
          speedMps,
          estimates: estimatesFor(speedMps),
        };
      }

      // Tier 3: no history anywhere -- generic default.
      return {
        source: "default" as const,
        speedMps: DEFAULT_HISTORICAL_SPEED_MPS,
        estimates: estimatesFor(DEFAULT_HISTORICAL_SPEED_MPS),
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [route] = await ctx.db
        .select({ createdBy: routes.createdBy })
        .from(routes)
        .where(eq(routes.id, input.id));

      if (!route) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Route not found" });
      }

      if (route.createdBy !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the route's creator can delete it",
        });
      }

      const [deleted] = await ctx.db
        .delete(routes)
        .where(
          and(
            eq(routes.id, input.id),
            eq(routes.createdBy, ctx.session.user.id),
          ),
        )
        .returning({ id: routes.id });

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Route not found" });
      }

      return { id: deleted.id };
    }),
});
