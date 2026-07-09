import { pgEnum, pgTableCreator } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `paddle-prints_${name}`);

/**
 * The kind of route a saved paddle trip represents.
 */
export const routeType = pgEnum("route_type", ["river", "waypoint"]);

/**
 * Whether a route is a one-way run or an out-and-back loop.
 */
export const routeShape = pgEnum("route_shape", ["one_way", "out_and_back"]);

/**
 * Category of a point of interest logged along a route.
 */
export const poiCategory = pgEnum("poi_category", [
  "hazard",
  "wildlife",
  "dock",
  "portage",
  "campsite",
  "scenic",
  "other",
]);
