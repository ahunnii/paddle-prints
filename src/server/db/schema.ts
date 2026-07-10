import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTableCreator,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { geoPoint, lineString } from "./geo";
import { user } from "./auth-schema";

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

/**
 * A saved paddle route -- either a river run or a waypoint-built lake/open-water route.
 *
 * `geom` stores only the OUTBOUND line; `distanceM` is the one-way distance. For
 * `shape: "out_and_back"` routes, the UI doubles the distance for display.
 */
export const routes = createTable(
  "routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: routeType("type").notNull(),
    shape: routeShape("shape").notNull().default("one_way"),
    geom: lineString("geom").notNull(),
    distanceM: real("distance_m").notNull(),
    description: text("description"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("routes_geom_idx").using("gist", table.geom)],
);

/**
 * A logged paddle trip, optionally linked to a saved route. `id` has no default -- the client
 * generates it (uuid) at trip-start time so trips can be created offline and synced idempotently.
 */
export const paddles = createTable(
  "paddles",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    routeId: uuid("route_id").references(() => routes.id, {
      onDelete: "set null",
    }),
    tripType: routeType("trip_type").notNull(),
    startedAt: timestamp("started_at").notNull(),
    elapsedS: integer("elapsed_s").notNull(),
    movingS: integer("moving_s").notNull(),
    distanceM: real("distance_m").notNull(),
    avgSpeedMps: real("avg_speed_mps").notNull(),
    trackGeom: lineString("track_geom"),
    trackJson: jsonb("track_json"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("paddles_userId_idx").on(table.userId),
    index("paddles_routeId_idx").on(table.routeId),
  ],
);

/**
 * A point of interest logged by a user (hazard, wildlife sighting, dock, etc). `id` has no
 * default -- client-generated for the same offline-idempotency reason as `paddles.id`.
 */
export const pois = createTable(
  "pois",
  {
    id: uuid("id").primaryKey(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    category: poiCategory("category").notNull(),
    note: text("note"),
    geom: geoPoint("geom").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("pois_geom_idx").using("gist", table.geom)],
);

/**
 * A user's most recent live location while recording a trip, for the community map's "who's out
 * there right now" layer. One row per user -- each heartbeat overwrites the previous position.
 * Rows older than 5 minutes are treated as stale and filtered out at query time.
 */
export const presence = createTable("presence", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  geom: geoPoint("geom").notNull(),
  tripType: routeType("trip_type").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const routesRelations = relations(routes, ({ one, many }) => ({
  creator: one(user, {
    fields: [routes.createdBy],
    references: [user.id],
  }),
  paddles: many(paddles),
}));

export const paddlesRelations = relations(paddles, ({ one }) => ({
  user: one(user, {
    fields: [paddles.userId],
    references: [user.id],
  }),
  route: one(routes, {
    fields: [paddles.routeId],
    references: [routes.id],
  }),
}));

export const poisRelations = relations(pois, ({ one }) => ({
  creator: one(user, {
    fields: [pois.createdBy],
    references: [user.id],
  }),
}));

export const presenceRelations = relations(presence, ({ one }) => ({
  user: one(user, {
    fields: [presence.userId],
    references: [user.id],
  }),
}));
