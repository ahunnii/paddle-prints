import { TRPCError } from "@trpc/server";
import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { user } from "@paddle-prints/db/auth-schema";
import {
  paddleComments,
  paddleCrew,
  paddlePins,
  paddleReactions,
  paddles,
  routeType,
  routes,
  teamMembers,
} from "@paddle-prints/db/schema";

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

type Db = (typeof import("@paddle-prints/db"))["db"];

/**
 * A WHERE predicate matching paddles the given user either owns OR was registered as crew on.
 * Used to widen the "your paddles" surfaces (mine, myStats, ETA history) to include trips a user
 * paddled but didn't personally log.
 */
function ownedOrCrewedByMe(db: Db, meId: string) {
  return or(
    eq(paddles.userId, meId),
    inArray(
      paddles.id,
      db
        .select({ id: paddleCrew.paddleId })
        .from(paddleCrew)
        .where(eq(paddleCrew.userId, meId)),
    ),
  );
}

/** The per-paddle social counters attached to feed/byId rows. */
interface SocialAggregates {
  commentCount: number;
  reactions: Record<string, number>;
  myReactions: string[];
  pinnedByMe: boolean;
}

/**
 * For a page of paddle ids, fetch comment counts, reaction tallies, and the signed-in user's own
 * reactions/pins in three small grouped queries, returning a lookup keyed by paddle id. Any id not
 * present gets the empty aggregate.
 */
async function socialAggregates(
  db: Db,
  paddleIds: string[],
  meId: string,
): Promise<Map<string, SocialAggregates>> {
  const result = new Map<string, SocialAggregates>();
  for (const id of paddleIds) {
    result.set(id, {
      commentCount: 0,
      reactions: {},
      myReactions: [],
      pinnedByMe: false,
    });
  }
  if (paddleIds.length === 0) return result;

  const [commentRows, reactionRows, pinRows] = await Promise.all([
    db
      .select({ paddleId: paddleComments.paddleId, n: count() })
      .from(paddleComments)
      .where(inArray(paddleComments.paddleId, paddleIds))
      .groupBy(paddleComments.paddleId),
    db
      .select({
        paddleId: paddleReactions.paddleId,
        emoji: paddleReactions.emoji,
        userId: paddleReactions.userId,
      })
      .from(paddleReactions)
      .where(inArray(paddleReactions.paddleId, paddleIds)),
    db
      .select({ paddleId: paddlePins.paddleId })
      .from(paddlePins)
      .where(
        and(
          eq(paddlePins.userId, meId),
          inArray(paddlePins.paddleId, paddleIds),
        ),
      ),
  ]);

  for (const row of commentRows) {
    const agg = result.get(row.paddleId);
    if (agg) agg.commentCount = row.n;
  }
  for (const row of reactionRows) {
    const agg = result.get(row.paddleId);
    if (!agg) continue;
    agg.reactions[row.emoji] = (agg.reactions[row.emoji] ?? 0) + 1;
    if (row.userId === meId) agg.myReactions.push(row.emoji);
  }
  for (const row of pinRows) {
    const agg = result.get(row.paddleId);
    if (agg) agg.pinnedByMe = true;
  }
  return result;
}

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
        // Optional/nullable and MUST stay that way: paddles already queued in a client's
        // IndexedDB from before this field existed will replay without it.
        note: z.string().trim().max(2000).nullable().optional(),
        // Phase 3 social fields -- also optional so pre-existing queued rows replay cleanly.
        crewUserIds: z.array(z.string()).max(20).optional(),
        guestNames: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
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
          note: input.note && input.note.length > 0 ? input.note : null,
          guestNames:
            input.guestNames && input.guestNames.length > 0
              ? input.guestNames
              : null,
          // Omit trackGeom entirely when null so the geometry column stays NULL rather than being
          // fed a "null" GeoJSON literal.
          ...(input.trackGeom ? { trackGeom: input.trackGeom } : {}),
        })
        .onConflictDoNothing({ target: paddles.id });

      // Register co-paddlers. Dedupe and drop the owner's own id; ON CONFLICT DO NOTHING keeps
      // idempotent replays from duplicating rows.
      if (input.crewUserIds && input.crewUserIds.length > 0) {
        const crewRows = [...new Set(input.crewUserIds)]
          .filter((uid) => uid !== ctx.session.user.id)
          .map((uid) => ({ paddleId: input.id, userId: uid }));
        if (crewRows.length > 0) {
          await ctx.db
            .insert(paddleCrew)
            .values(crewRows)
            .onConflictDoNothing();
        }
      }

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

  /**
   * The crew feed: the 30 most recent paddles. `filter: "teams"` narrows to paddles whose owner or
   * a registered crew member shares at least one team with the signed-in user. Each row carries its
   * social counters (comment count, reaction tallies, the viewer's own reactions, pin state).
   */
  feed: protectedProcedure
    .input(
      z.object({ filter: z.enum(["all", "teams"]).optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;

      let teamFilter = undefined;
      if (input?.filter === "teams") {
        // Everyone who shares at least one team with me (includes me if I'm in any team).
        const tmMine = alias(teamMembers, "tm_mine");
        const tmPeer = alias(teamMembers, "tm_peer");
        const teammateRows = await ctx.db
          .selectDistinct({ userId: tmPeer.userId })
          .from(tmMine)
          .innerJoin(tmPeer, eq(tmMine.teamId, tmPeer.teamId))
          .where(eq(tmMine.userId, me));
        const teammateIds = teammateRows.map((r) => r.userId);
        if (teammateIds.length === 0) return [];

        teamFilter = or(
          inArray(paddles.userId, teammateIds),
          inArray(
            paddles.id,
            ctx.db
              .select({ id: paddleCrew.paddleId })
              .from(paddleCrew)
              .where(inArray(paddleCrew.userId, teammateIds)),
          ),
        );
      }

      const rows = await ctx.db
        .select({
          id: paddles.id,
          tripType: paddles.tripType,
          startedAt: paddles.startedAt,
          elapsedS: paddles.elapsedS,
          movingS: paddles.movingS,
          distanceM: paddles.distanceM,
          avgSpeedMps: paddles.avgSpeedMps,
          userId: paddles.userId,
          userName: user.name,
          userImage: user.image,
          routeId: paddles.routeId,
          routeName: routes.name,
          routeShape: routes.shape,
        })
        .from(paddles)
        .innerJoin(user, eq(paddles.userId, user.id))
        .leftJoin(routes, eq(paddles.routeId, routes.id))
        .where(teamFilter)
        .orderBy(desc(paddles.startedAt))
        .limit(30);

      const aggregates = await socialAggregates(
        ctx.db,
        rows.map((r) => r.id),
        me,
      );

      return rows.map((row) => {
        const agg = aggregates.get(row.id)!;
        return {
          ...row,
          commentCount: agg.commentCount,
          reactions: agg.reactions,
          myReactions: agg.myReactions,
          pinnedByMe: agg.pinnedByMe,
        };
      });
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
          note: paddles.note,
          guestNames: paddles.guestNames,
          userName: user.name,
          userImage: user.image,
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

      const crew = await ctx.db
        .select({ id: user.id, name: user.name, image: user.image })
        .from(paddleCrew)
        .innerJoin(user, eq(paddleCrew.userId, user.id))
        .where(eq(paddleCrew.paddleId, input.id));

      const aggregates = await socialAggregates(
        ctx.db,
        [input.id],
        ctx.session.user.id,
      );
      const agg = aggregates.get(input.id)!;

      return {
        ...row,
        guestNames: row.guestNames ?? [],
        crew,
        commentCount: agg.commentCount,
        reactions: agg.reactions,
        myReactions: agg.myReactions,
        pinnedByMe: agg.pinnedByMe,
      };
    }),

  /** Edit the note on an already-saved paddle. Owner-only. */
  updateNote: protectedProcedure
    .input(z.object({ id: z.string().uuid(), note: z.string().trim().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(paddles)
        .set({ note: input.note.length > 0 ? input.note : null })
        .where(
          and(
            eq(paddles.id, input.id),
            eq(paddles.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: paddles.id, note: paddles.note });

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paddle not found" });
      }
      return row;
    }),

  /**
   * The signed-in paddler's average moving speed per trip type (river / lake-open-water), for the
   * /me "Your pace" section. Only types they've actually logged a paddle for are returned.
   */
  myStats: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        tripType: paddles.tripType,
        avgSpeedMps: paddles.avgSpeedMps,
      })
      .from(paddles)
      .where(ownedOrCrewedByMe(ctx.db, ctx.session.user.id));

    const byType = new Map<string, number[]>();
    for (const row of rows) {
      const list = byType.get(row.tripType) ?? [];
      list.push(row.avgSpeedMps);
      byType.set(row.tripType, list);
    }

    return [...byType.entries()].map(([tripType, speeds]) => ({
      tripType: tripType as (typeof routeType.enumValues)[number],
      count: speeds.length,
      avgSpeedMps: speeds.reduce((sum, s) => sum + s, 0) / speeds.length,
    }));
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
      .where(ownedOrCrewedByMe(ctx.db, ctx.session.user.id))
      .orderBy(desc(paddles.startedAt));
  }),
});
