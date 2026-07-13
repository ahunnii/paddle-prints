import { healthRouter } from "./routers/health";
import { paddlesRouter } from "./routers/paddles";
import { poisRouter } from "./routers/pois";
import { presenceRouter } from "./routers/presence";
import { riversRouter } from "./routers/rivers";
import { routesRouter } from "./routers/routes";
import { usersRouter } from "./routers/users";
import { createCallerFactory, createTRPCRouter } from "./trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  health: healthRouter,
  paddles: paddlesRouter,
  pois: poisRouter,
  presence: presenceRouter,
  rivers: riversRouter,
  routes: routesRouter,
  users: usersRouter,
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
