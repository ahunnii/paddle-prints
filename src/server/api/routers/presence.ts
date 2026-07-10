import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/db/auth-schema";
import { presence, routeType } from "~/server/db/schema";

const latLng = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

export const presenceRouter = createTRPCRouter({
  /**
   * Upsert the signed-in user's live location while recording a trip. One row per user -- each
   * heartbeat overwrites the previous position.
   */
  heartbeat: protectedProcedure
    .input(
      z.object({
        point: latLng,
        tripType: z.enum(routeType.enumValues),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const geom = {
        type: "Point" as const,
        coordinates: [input.point.lng, input.point.lat] as [number, number],
      };

      await ctx.db
        .insert(presence)
        .values({
          userId: ctx.session.user.id,
          geom,
          tripType: input.tripType,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: presence.userId,
          set: { geom, tripType: input.tripType, updatedAt: new Date() },
        });
    }),

  /** Everyone currently live (heartbeat within the last 5 minutes), for the community map layer. */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        userId: presence.userId,
        name: user.name,
        geom: presence.geom,
        tripType: presence.tripType,
        updatedAt: presence.updatedAt,
      })
      .from(presence)
      .innerJoin(user, eq(presence.userId, user.id))
      .where(sql`${presence.updatedAt} > now() - interval '5 minutes'`);
  }),

  /** Best-effort cleanup when a trip finishes or is discarded. */
  clear: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(presence).where(eq(presence.userId, ctx.session.user.id));
  }),
});
