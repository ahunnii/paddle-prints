/**
 * POST /api/avatars — upload the signed-in user's avatar.
 *
 * Accepts a multipart/form-data body with a single `file` field, normalizes it with sharp
 * (auto-orient, square-crop to 256×256, re-encode as WebP), and writes it to
 * `${UPLOADS_DIR}/avatars/<userId>.webp` (one file per user, overwritten on each upload). The user
 * row's `image` column is then pointed at the cache-busted serve URL so clients pick up the new
 * avatar immediately. The file is served back out by `app/api/avatars/[userId]/route.ts`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { auth } from "@paddle-prints/auth";
import { db } from "@paddle-prints/db";
import { user } from "@paddle-prints/db/auth-schema";

import { env } from "~/env";

export const runtime = "nodejs";

/** Reject anything larger than this before we hand it to sharp. */
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "File must be an image" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be 5MB or smaller" },
      { status: 400 },
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  const output = await sharp(input)
    .rotate()
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 82 })
    .toBuffer();

  const dir = path.join(env.UPLOADS_DIR, "avatars");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${session.user.id}.webp`), output);

  const url = `/api/avatars/${session.user.id}?v=${Date.now()}`;
  await db
    .update(user)
    .set({ image: url, updatedAt: new Date() })
    .where(eq(user.id, session.user.id));

  return NextResponse.json({ url }, { status: 200 });
}
