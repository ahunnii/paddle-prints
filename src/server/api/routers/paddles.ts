import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/db/auth-schema";
import { paddles, routeType, routes } from "~/server/db/schema";

/** A recorded track as a GeoJSON LineString (2+ points). Same validation shape as routes. */
const trackGeometry = z.object({
  type: z.literal("LineString"),
  coordinates: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .min(2, "A track needs at least 2 points"),
});

/** Full-fidelity track sample kept in `trackJson`. */
const trackSample = z.object({
  lng: z.number(),
  lat: z.number(),
  t: z.number(),
  acc: z.number(),
});

export const paddlesRouter = createTRPCRouter({
  /**
   * Save a finished paddle. `id` is client-generated so retries are idempotent: ON CONFLICT DO
   * NOTHING means a re-sent create (Phase 6 offline queue) can't create a duplicate, and we fetch
   * and return the existing row in that case.
   */
  create: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        routeId: z.string().uuid().nullable(),
        tripType: z.enum(routeType.enumValues),
        startedAt: z.coerce.date(),
        elapsedS: z.number().int().nonnegative(),
        movingS: z.number().int().nonnegative(),
        distanceM: z.number().nonnegative(),
        avgSpeedMps: z.number().nonnegative(),
        trackGeom: trackGeometry.nullable(),
        trackJson: z.array(trackSample).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(paddles)
        .values({
          id: input.id,
          userId: ctx.session.user.id,
          routeId: input.routeId,
          tripType: input.tripType,
          startedAt: input.startedAt,
          elapsedS: input.elapsedS,
          movingS: input.movingS,
          distanceM: input.distanceM,
          avgSpeedMps: input.avgSpeedMps,
          trackJson: input.trackJson,
          // Omit trackGeom entirely when null so the geometry column stays NULL rather than being
          // fed a "null" GeoJSON literal.
          ...(input.trackGeom ? { trackGeom: input.trackGeom } : {}),
        })
        .onConflictDoNothing({ target: paddles.id });

      const [row] = await ctx.db
        .select()
        .from(paddles)
        .where(eq(paddles.id, input.id));

      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save paddle",
        });
      }
      // Only the owner may create/read back their just-saved paddle.
      if (row.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return row;
    }),

  /** The crew feed: the 30 most recent paddles across all users. */
  feed: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: paddles.id,
        tripType: paddles.tripType,
        startedAt: paddles.startedAt,
        elapsedS: paddles.elapsedS,
        movingS: paddles.movingS,
        distanceM: paddles.distanceM,
        avgSpeedMps: paddles.avgSpeedMps,
        userName: user.name,
        routeId: paddles.routeId,
        routeName: routes.name,
        routeShape: routes.shape,
      })
      .from(paddles)
      .innerJoin(user, eq(paddles.userId, user.id))
      .leftJoin(routes, eq(paddles.routeId, routes.id))
      .orderBy(desc(paddles.startedAt))
      .limit(30);
  }),

  /** A single paddle with its track, the route it followed (if any), and the paddler's name. */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: paddles.id,
          userId: paddles.userId,
          tripType: paddles.tripType,
          startedAt: paddles.startedAt,
          elapsedS: paddles.elapsedS,
          movingS: paddles.movingS,
          distanceM: paddles.distanceM,
          avgSpeedMps: paddles.avgSpeedMps,
          trackGeom: paddles.trackGeom,
          userName: user.name,
          routeId: paddles.routeId,
          routeName: routes.name,
          routeShape: routes.shape,
          routeGeom: routes.geom,
        })
        .from(paddles)
        .innerJoin(user, eq(paddles.userId, user.id))
        .leftJoin(routes, eq(paddles.routeId, routes.id))
        .where(eq(paddles.id, input.id));

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paddle not found" });
      }
      return row;
    }),

  /** The signed-in paddler's own paddles, newest first. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: paddles.id,
        tripType: paddles.tripType,
        startedAt: paddles.startedAt,
        elapsedS: paddles.elapsedS,
        movingS: paddles.movingS,
        distanceM: paddles.distanceM,
        avgSpeedMps: paddles.avgSpeedMps,
        routeId: paddles.routeId,
        routeName: routes.name,
      })
      .from(paddles)
      .leftJoin(routes, eq(paddles.routeId, routes.id))
      .where(eq(paddles.userId, ctx.session.user.id))
      .orderBy(desc(paddles.startedAt));
  }),
});
