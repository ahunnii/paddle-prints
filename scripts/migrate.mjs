// Runs at container startup (before `node server.js`). Ensures the PostGIS/pgRouting extensions
// exist and applies any pending drizzle migrations. Plain Node/ESM so it can run without the
// Next.js build pipeline inside the runtime image.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

async function main() {
  console.log("[migrate] ensuring postgis/pgrouting extensions exist...");
  await sql`CREATE EXTENSION IF NOT EXISTS postgis;`;
  await sql`CREATE EXTENSION IF NOT EXISTS pgrouting;`;

  console.log("[migrate] applying drizzle migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });

  console.log("[migrate] done");
  await sql.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
