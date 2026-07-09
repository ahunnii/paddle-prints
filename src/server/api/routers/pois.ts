import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/db/auth-schema";
import { poiCategory, pois } from "~/server/db/schema";

const latLng = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

/** Cap the community map query so a huge viewport can't pull down an unbounded result set. */
const MAX_POIS = 500;

export const poisRouter = createTRPCRouter({
  /**
   * Log a spot (hazard, wildlife, dock, etc). `id` is client-generated so retries are idempotent --
   * same pattern as `paddles.create` and `routes.create`.
   */
  create: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        category: z.enum(poiCategory.enumValues),
        note: z.string().trim().max(280).optional(),
        point: latLng,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(pois)
        .values({
          id: input.id,
          createdBy: ctx.session.user.id,
          category: input.category,
          note: input.note && input.note.length > 0 ? input.note : null,
          geom: { type: "Point", coordinates: [input.point.lng, input.point.lat] },
        })
        .onConflictDoNothing({ target: pois.id });

      const [row] = await ctx.db.select().from(pois).where(eq(pois.id, input.id));
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save spot",
        });
      }
      return row;
    }),

  /** POIs inside a viewport bbox, for the community map. Capped at 500. */
  inBbox: protectedProcedure
    .input(
      z.object({
        west: z.number().min(-180).max(180),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: pois.id,
          category: pois.category,
          note: pois.note,
          geom: pois.geom,
          createdAt: pois.createdAt,
          creatorName: user.name,
        })
        .from(pois)
        .innerJoin(user, eq(pois.createdBy, user.id))
        .where(
          sql`${pois.geom} && ST_MakeEnvelope(${input.west}, ${input.south}, ${input.east}, ${input.north}, 4326)`,
        )
        .limit(MAX_POIS);
    }),

  /** Any signed-in user may delete any spot -- this is a friends app, not a moderation system. */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(pois)
        .where(eq(pois.id, input.id))
        .returning({ id: pois.id });

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Spot not found" });
      }
      return { id: deleted.id };
    }),
});
