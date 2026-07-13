import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTableCreator,
  primaryKey,
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
 * How demanding a route is to paddle.
 */
export const routeDifficulty = pgEnum("route_difficulty", [
  "easy",
  "moderate",
  "challenging",
  "hard",
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
    // Per-leg paddling direction along the route, in route order. Each leg spans the metre
    // range [startM, endM) measured from the start of `geom`. Only populated for river routes.
    flowLegs: jsonb("flow_legs").$type<
      { startM: number; endM: number; direction: "downstream" | "upstream" | "unknown" }[]
    >(),
    description: text("description"),
    difficulty: routeDifficulty("difficulty"),
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
    difficulty: routeDifficulty("difficulty"),
    guestNames: jsonb("guest_names").$type<string[]>(),
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

/**
 * A named crew ("team") whose membership scopes the "teams" feed filter. Lightweight by design:
 * any signed-in user may add or remove members; only the creator may delete the team.
 */
export const teams = createTable("teams", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Membership rows for `teams`. Composite PK keeps a user from being added to a team twice. */
export const teamMembers = createTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    addedBy: text("added_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_members_userId_idx").on(table.userId),
  ],
);

/** A comment left on a paddle. `id` is client-generated for the same offline-idempotency reason. */
export const paddleComments = createTable(
  "paddle_comments",
  {
    id: uuid("id").primaryKey(),
    paddleId: uuid("paddle_id")
      .notNull()
      .references(() => paddles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("paddle_comments_paddleId_idx").on(table.paddleId)],
);

/** An emoji reaction on a paddle. Composite PK = one row per (paddle, user, emoji). */
export const paddleReactions = createTable(
  "paddle_reactions",
  {
    paddleId: uuid("paddle_id")
      .notNull()
      .references(() => paddles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paddleId, table.userId, table.emoji] }),
  ],
);

/** A user's private bookmark of a paddle. Composite PK = one pin per (user, paddle). */
export const paddlePins = createTable(
  "paddle_pins",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    paddleId: uuid("paddle_id")
      .notNull()
      .references(() => paddles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.paddleId] })],
);

/** Registered co-paddlers on a trip (guests without accounts go in `paddles.guestNames`). */
export const paddleCrew = createTable(
  "paddle_crew",
  {
    paddleId: uuid("paddle_id")
      .notNull()
      .references(() => paddles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paddleId, table.userId] }),
    index("paddle_crew_userId_idx").on(table.userId),
  ],
);

export const teamsRelations = relations(teams, ({ one, many }) => ({
  creator: one(user, {
    fields: [teams.createdBy],
    references: [user.id],
  }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(user, {
    fields: [teamMembers.userId],
    references: [user.id],
  }),
}));

export const paddleCommentsRelations = relations(paddleComments, ({ one }) => ({
  paddle: one(paddles, {
    fields: [paddleComments.paddleId],
    references: [paddles.id],
  }),
  user: one(user, {
    fields: [paddleComments.userId],
    references: [user.id],
  }),
}));

export const paddleReactionsRelations = relations(paddleReactions, ({ one }) => ({
  paddle: one(paddles, {
    fields: [paddleReactions.paddleId],
    references: [paddles.id],
  }),
  user: one(user, {
    fields: [paddleReactions.userId],
    references: [user.id],
  }),
}));

export const paddlePinsRelations = relations(paddlePins, ({ one }) => ({
  paddle: one(paddles, {
    fields: [paddlePins.paddleId],
    references: [paddles.id],
  }),
  user: one(user, {
    fields: [paddlePins.userId],
    references: [user.id],
  }),
}));

export const paddleCrewRelations = relations(paddleCrew, ({ one }) => ({
  paddle: one(paddles, {
    fields: [paddleCrew.paddleId],
    references: [paddles.id],
  }),
  user: one(user, {
    fields: [paddleCrew.userId],
    references: [user.id],
  }),
}));

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
