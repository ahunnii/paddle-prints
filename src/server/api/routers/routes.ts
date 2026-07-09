import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/db/auth-schema";
import { paddles, pois, routeShape, routeType, routes } from "~/server/db/schema";

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
          // Distance along the route line (in meters from the start) so the UI can order/place
          // POIs along the corridor.
          routeDistM: sql<number>`ST_LineLocatePoint(ST_GeomFromGeoJSON(${routeGeomJson}), ${pois.geom}) * ${route.distanceM}`,
        })
        .from(pois)
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

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(routes)
        .where(eq(routes.id, input.id))
        .returning({ id: routes.id });

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Route not found" });
      }

      return { id: deleted.id };
    }),
});
