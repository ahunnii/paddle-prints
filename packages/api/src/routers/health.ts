import { createTRPCRouter, protectedProcedure } from "../trpc";

export const healthRouter = createTRPCRouter({
  ping: protectedProcedure.query(({ ctx }) => ({
    ok: true,
    userId: ctx.session.user.id,
  })),
});
