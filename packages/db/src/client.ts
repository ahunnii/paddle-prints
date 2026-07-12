import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as authSchema from "./auth-schema";
import * as schema from "./schema";

// SKIP_ENV_VALIDATION lets `next build` collect page data without a database configured
// (Docker builder stage); the connection below is lazy, so nothing dials until first query.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && !process.env.SKIP_ENV_VALIDATION) {
  throw new Error("DATABASE_URL is not set");
}

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(DATABASE_URL ?? "");
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema: { ...schema, ...authSchema } });
