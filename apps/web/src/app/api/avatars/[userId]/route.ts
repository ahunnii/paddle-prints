/**
 * GET /api/avatars/[userId] — serve a user's uploaded avatar.
 *
 * Streams `${UPLOADS_DIR}/avatars/<userId>.webp` back with a long immutable cache header. The URL
 * written to `user.image` (see the POST handler) is cache-busted with a `?v=<timestamp>` query
 * param, so a fresh upload is picked up even though the underlying file path is stable.
 *
 * Security: `userId` is the only client-supplied input and is validated against a strict charset
 * before being joined into a filesystem path, so it can never contain `/` or `..` path-traversal
 * segments.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { env } from "~/env";

export const runtime = "nodejs";

/** Better-auth user ids are alphanumeric + `_`/`-`; anything else is a path-traversal attempt. */
const USER_ID_RE = /^[A-Za-z0-9_-]+$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  if (!USER_ID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const filePath = path.join(env.UPLOADS_DIR, "avatars", `${userId}.webp`);

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
