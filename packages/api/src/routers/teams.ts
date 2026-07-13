import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { user } from "@paddle-prints/db/auth-schema";
import { teamMembers, teams } from "@paddle-prints/db/schema";

/** The shape returned by `list`/`mine`: a team plus its resolved member profiles. */
interface TeamWithMembers {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  members: { id: string; name: string; image: string | null }[];
}

/**
 * Given a set of team ids, fetch those teams and their members (one flat join, grouped in JS).
 * Returns them ordered by team name. An empty id list short-circuits to `[]`.
 */
async function teamsWithMembers(
  db: (typeof import("@paddle-prints/db"))["db"],
  teamIds: string[],
): Promise<TeamWithMembers[]> {
  if (teamIds.length === 0) return [];

  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      createdBy: teams.createdBy,
      createdAt: teams.createdAt,
      memberId: user.id,
      memberName: user.name,
      memberImage: user.image,
    })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .leftJoin(user, eq(teamMembers.userId, user.id))
    .where(inArray(teams.id, teamIds))
    .orderBy(asc(teams.name));

  const byTeam = new Map<string, TeamWithMembers>();
  for (const row of rows) {
    let team = byTeam.get(row.id);
    if (!team) {
      team = {
        id: row.id,
        name: row.name,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        members: [],
      };
      byTeam.set(row.id, team);
    }
    if (row.memberId) {
      team.members.push({
        id: row.memberId,
        name: row.memberName ?? "",
        image: row.memberImage ?? null,
      });
    }
  }
  return [...byTeam.values()];
}

export const teamsRouter = createTRPCRouter({
  /**
   * Create a crew. `id` is client-generated so retries are idempotent (ON CONFLICT DO NOTHING).
   * The creator is inserted as the first member.
   */
  create: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(teams)
        .values({
          id: input.id,
          name: input.name,
          createdBy: ctx.session.user.id,
        })
        .onConflictDoNothing({ target: teams.id });

      await ctx.db
        .insert(teamMembers)
        .values({
          teamId: input.id,
          userId: ctx.session.user.id,
          addedBy: ctx.session.user.id,
        })
        .onConflictDoNothing();

      return { id: input.id };
    }),

  /** Every team with its members, ordered by name. Small trusted app -- no scoping. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const ids = await ctx.db.select({ id: teams.id }).from(teams);
    return teamsWithMembers(
      ctx.db,
      ids.map((r) => r.id),
    );
  }),

  /** Teams the signed-in user belongs to, with all members, ordered by name. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const ids = await ctx.db
      .select({ id: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, ctx.session.user.id));
    return teamsWithMembers(
      ctx.db,
      ids.map((r) => r.id),
    );
  }),

  /** Add a member. Any signed-in user may add anyone (lightweight-crews decision). Idempotent. */
  addMember: protectedProcedure
    .input(z.object({ teamId: z.string().uuid(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(teamMembers)
        .values({
          teamId: input.teamId,
          userId: input.userId,
          addedBy: ctx.session.user.id,
        })
        .onConflictDoNothing();
      return { teamId: input.teamId, userId: input.userId };
    }),

  /** Remove a member. Any member may remove anyone (consistent with the lightweight model). */
  removeMember: protectedProcedure
    .input(z.object({ teamId: z.string().uuid(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, input.userId),
          ),
        );
      return { teamId: input.teamId, userId: input.userId };
    }),

  /** Delete a team. Creator-only; the FK cascade removes its members. */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [team] = await ctx.db
        .select({ createdBy: teams.createdBy })
        .from(teams)
        .where(eq(teams.id, input.id));

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      if (team.createdBy !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the team's creator can delete it",
        });
      }

      await ctx.db.delete(teams).where(eq(teams.id, input.id));
      return { id: input.id };
    }),
});
