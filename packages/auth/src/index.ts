import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { z } from "zod";

import { db } from "@paddle-prints/db";

const envSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  INVITE_CODE: z.string().min(1),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
});

// Mirror apps/web/src/env.js: hard validation at module load, with a
// SKIP_ENV_VALIDATION escape hatch so `next build` (Docker builder stage sets
// SKIP_ENV_VALIDATION=1 with no auth env present) doesn't blow up when Next
// evaluates this module during build/page-data collection.
const env = process.env.SKIP_ENV_VALIDATION
  ? (process.env as unknown as z.infer<typeof envSchema>)
  : envSchema.parse(process.env);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 365, // 1 year
    updateAge: 60 * 60 * 24, // 1 day
  },
  plugins: [expo()],
  trustedOrigins: [
    "paddleprints://",
    ...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const inviteCode = (ctx.body as { inviteCode?: unknown } | undefined)
          ?.inviteCode;

        if (inviteCode !== env.INVITE_CODE) {
          throw new APIError("BAD_REQUEST", {
            message: "Invalid invite code",
          });
        }
      }
    }),
  },
});

export type Session = typeof auth.$Infer.Session;
