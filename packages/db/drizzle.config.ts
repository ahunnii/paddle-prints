import { config } from "dotenv";
import { type Config } from "drizzle-kit";

config({ path: "../../.env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export default {
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  dialect: "postgresql",
  dbCredentials: { url: DATABASE_URL },
  tablesFilter: ["paddle-prints_*", "user", "session", "account", "verification"],
} satisfies Config;
