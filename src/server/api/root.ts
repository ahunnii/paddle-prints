import { healthRouter } from "~/server/api/routers/health";
import { riversRouter } from "~/server/api/routers/rivers";
import { routesRouter } from "~/server/api/routers/routes";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  health: healthRouter,
  rivers: riversRouter,
  routes: routesRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.health.ping();
 *       ^? { ok: boolean, userId: string }
 */
export const createCaller = createCallerFactory(appRouter);
