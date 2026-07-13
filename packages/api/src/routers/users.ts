import { asc, count, eq, sql } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { user } from "@paddle-prints/db/auth-schema";
import { paddles, presence } from "@paddle-prints/db/schema";

export const usersRouter = createTRPCRouter({
  /**
   * The member directory: every user, sorted by name, with their lifetime paddle count and whether
   * they're currently out on the water. `onWaterNow` reuses the exact 5-minute staleness predicate
   * from `presenceRouter.list`; `bool_or` collapses the (at most one) presence row per user, and
   * `coalesce(..., false)` handles users who have never sent a heartbeat.
   */
  directory: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: user.id,
        name: user.name,
        image: user.image,
        joinedAt: user.createdAt,
        paddleCount: count(paddles.id),
        onWaterNow: sql<boolean>`coalesce(bool_or(${presence.updatedAt} > now() - interval '5 minutes'), false)`,
      })
      .from(user)
      .leftJoin(paddles, eq(paddles.userId, user.id))
      .leftJoin(presence, eq(presence.userId, user.id))
      .groupBy(user.id)
      .orderBy(asc(user.name));
  }),
});
