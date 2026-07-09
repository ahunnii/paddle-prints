import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const healthRouter = createTRPCRouter({
  ping: protectedProcedure.query(({ ctx }) => ({
    ok: true,
    userId: ctx.session.user.id,
  })),
});
