import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { REACTION_EMOJIS } from "../constants";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { user } from "@paddle-prints/db/auth-schema";
import {
  paddleComments,
  paddlePins,
  paddleReactions,
  paddles,
  routes,
} from "@paddle-prints/db/schema";

/**
 * Fetch the reaction summary for a single paddle: a `{ emoji: count }` map plus the list of emoji
 * the signed-in user has personally applied. Shared by `reactionToggle` and any read path.
 */
async function reactionSummary(
  db: (typeof import("@paddle-prints/db"))["db"],
  paddleId: string,
  meId: string,
): Promise<{ counts: Record<string, number>; mine: string[] }> {
  const rows = await db
    .select({ emoji: paddleReactions.emoji, userId: paddleReactions.userId })
    .from(paddleReactions)
    .where(eq(paddleReactions.paddleId, paddleId));

  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const row of rows) {
    counts[row.emoji] = (counts[row.emoji] ?? 0) + 1;
    if (row.userId === meId) mine.push(row.emoji);
  }
  return { counts, mine };
}

export const socialRouter = createTRPCRouter({
  /** Comments on a paddle, oldest first, each with its author's profile. */
  commentsList: protectedProcedure
    .input(z.object({ paddleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: paddleComments.id,
          body: paddleComments.body,
          createdAt: paddleComments.createdAt,
          user: { id: user.id, name: user.name, image: user.image },
        })
        .from(paddleComments)
        .innerJoin(user, eq(paddleComments.userId, user.id))
        .where(eq(paddleComments.paddleId, input.paddleId))
        .orderBy(asc(paddleComments.createdAt));
    }),

  /**
   * Post a comment. `id` is client-generated so retries are idempotent. Returns the stored comment
   * in the same shape as `commentsList` rows.
   */
  commentAdd: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        paddleId: z.string().uuid(),
        body: z.string().trim().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(paddleComments)
        .values({
          id: input.id,
          paddleId: input.paddleId,
          userId: ctx.session.user.id,
          body: input.body,
        })
        .onConflictDoNothing({ target: paddleComments.id });

      const [row] = await ctx.db
        .select({
          id: paddleComments.id,
          body: paddleComments.body,
          createdAt: paddleComments.createdAt,
          user: { id: user.id, name: user.name, image: user.image },
        })
        .from(paddleComments)
        .innerJoin(user, eq(paddleComments.userId, user.id))
        .where(eq(paddleComments.id, input.id));

      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save comment",
        });
      }
      return row;
    }),

  /** Delete a comment. Author-only. */
  commentDelete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [comment] = await ctx.db
        .select({ userId: paddleComments.userId })
        .from(paddleComments)
        .where(eq(paddleComments.id, input.id));

      if (!comment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Comment not found",
        });
      }
      if (comment.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the author can delete this comment",
        });
      }

      await ctx.db
        .delete(paddleComments)
        .where(eq(paddleComments.id, input.id));
      return { id: input.id };
    }),

  /**
   * Toggle one of the fixed reaction emoji on a paddle: if the signed-in user already reacted with
   * that emoji, remove it; otherwise add it. Returns the fresh summary for the paddle.
   */
  reactionToggle: protectedProcedure
    .input(
      z.object({
        paddleId: z.string().uuid(),
        emoji: z.enum(REACTION_EMOJIS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const [existing] = await ctx.db
        .select({ emoji: paddleReactions.emoji })
        .from(paddleReactions)
        .where(
          and(
            eq(paddleReactions.paddleId, input.paddleId),
            eq(paddleReactions.userId, me),
            eq(paddleReactions.emoji, input.emoji),
          ),
        );

      if (existing) {
        await ctx.db
          .delete(paddleReactions)
          .where(
            and(
              eq(paddleReactions.paddleId, input.paddleId),
              eq(paddleReactions.userId, me),
              eq(paddleReactions.emoji, input.emoji),
            ),
          );
      } else {
        await ctx.db
          .insert(paddleReactions)
          .values({ paddleId: input.paddleId, userId: me, emoji: input.emoji })
          .onConflictDoNothing();
      }

      return reactionSummary(ctx.db, input.paddleId, me);
    }),

  /** Toggle a private bookmark ("pin") on a paddle. Returns the resulting pinned state. */
  pinToggle: protectedProcedure
    .input(z.object({ paddleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const [existing] = await ctx.db
        .select({ paddleId: paddlePins.paddleId })
        .from(paddlePins)
        .where(
          and(
            eq(paddlePins.userId, me),
            eq(paddlePins.paddleId, input.paddleId),
          ),
        );

      if (existing) {
        await ctx.db
          .delete(paddlePins)
          .where(
            and(
              eq(paddlePins.userId, me),
              eq(paddlePins.paddleId, input.paddleId),
            ),
          );
        return { pinned: false };
      }

      await ctx.db
        .insert(paddlePins)
        .values({ userId: me, paddleId: input.paddleId })
        .onConflictDoNothing();
      return { pinned: true };
    }),

  /** The signed-in user's pinned paddles, newest pin first, with a compact paddle summary. */
  pinsList: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        paddleId: paddlePins.paddleId,
        pinnedAt: paddlePins.createdAt,
        paddle: {
          id: paddles.id,
          routeId: paddles.routeId,
          routeName: routes.name,
          tripType: paddles.tripType,
          distanceM: paddles.distanceM,
          startedAt: paddles.startedAt,
          ownerName: user.name,
          ownerImage: user.image,
        },
      })
      .from(paddlePins)
      .innerJoin(paddles, eq(paddlePins.paddleId, paddles.id))
      .innerJoin(user, eq(paddles.userId, user.id))
      .leftJoin(routes, eq(paddles.routeId, routes.id))
      .where(eq(paddlePins.userId, ctx.session.user.id))
      .orderBy(desc(paddlePins.createdAt));
  }),
});
