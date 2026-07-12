/**
 * GET /api/trips/[routeId]/tiles — per-trip offline map extract.
 *
 * Streams back a small `.pmtiles` archive covering only the corridor around one saved route, so the
 * mobile app can download it to the device and render the nav map from `pmtiles://file://<path>`
 * with zero network. The heavy statewide `michigan.pmtiles` never leaves the server; we carve out a
 * ~1.5 km-buffered bounding box with the `pmtiles extract` CLI (go-pmtiles), which is fast (a Huron
 * corridor extract is ~1.4 MB in ~17 ms) and produces a self-contained archive (maxzoom 14, matching
 * the web offline zoom cap; MapLibre overzooms beyond).
 *
 * Security: the ONLY client-supplied input is `routeId`, validated as a UUID before it touches the
 * shell. The archive path and bbox are all server-derived; nothing user-controlled is ever
 * interpolated into the `execFile` argv (and `execFile` doesn't spawn a shell anyway).
 *
 * Caching: routes are immutable once created (they can be deleted but never edited — see
 * `routesRouter` in packages/api, which exposes only `create`/`delete`, no update), so the extract
 * for a given `routeId` is deterministic. We key the cache file by `${routeId}.pmtiles` under the OS
 * tmpdir and reuse it if present. A per-routeId in-flight map collapses concurrent requests (double
 * taps) onto a single extraction.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@paddle-prints/auth";
import { db } from "@paddle-prints/db";
import { routes } from "@paddle-prints/db/schema";

const execFileAsync = promisify(execFile);

/** ~1.5 km at Michigan's latitude — matches the corridor the web offline download uses. */
const BBOX_BUFFER_DEG = 0.015;

const routeIdSchema = z.string().uuid();

/** Where the statewide source archive lives. Absolute paths are used as-is; a relative value is
 * resolved against the process cwd (apps/web in dev; the container workdir in prod). */
function archivePath(): string {
  const configured = process.env.TILES_ARCHIVE_PATH ?? "../../tiles/data/michigan.pmtiles";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

/** Cache dir for per-route extracts. Immutable per routeId, so a plain tmpdir file is safe to reuse. */
const cacheDir = path.join(tmpdir(), "paddle-prints-extracts");

/** In-flight extractions keyed by routeId, so concurrent requests share one `pmtiles extract` run. */
const inFlight = new Map<string, Promise<string>>();

/** [minLng, minLat, maxLng, maxLat] of the route coords, expanded by a ~1.5 km buffer. */
function bboxFor(coords: [number, number][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    minLng - BBOX_BUFFER_DEG,
    minLat - BBOX_BUFFER_DEG,
    maxLng + BBOX_BUFFER_DEG,
    maxLat + BBOX_BUFFER_DEG,
  ];
}

/** Error surfaced when the `pmtiles` binary isn't installed on the host — mapped to a 501. */
class PmtilesBinaryMissingError extends Error {}

/**
 * Produce (or reuse) the cached extract for `routeId`, returning its absolute path. Extraction goes
 * to a temp file first, then atomically renames into place, so a crashed/half-written extract can
 * never be served as a complete archive.
 */
async function ensureExtract(
  routeId: string,
  bbox: [number, number, number, number],
): Promise<string> {
  const outPath = path.join(cacheDir, `${routeId}.pmtiles`);
  if (existsSync(outPath)) return outPath;

  const existing = inFlight.get(routeId);
  if (existing) return existing;

  const job = (async () => {
    await mkdir(cacheDir, { recursive: true });
    const tmpPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;
    const bboxArg = `--bbox=${bbox.join(",")}`;
    try {
      await execFileAsync("pmtiles", ["extract", archivePath(), tmpPath, bboxArg]);
      await rename(tmpPath, outPath);
      return outPath;
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "ENOENT" &&
        // ENOENT from a missing binary names `pmtiles`; a missing *source archive* also throws, but
        // that's a server misconfig we still want surfaced as a 500, not a 501.
        /pmtiles/.test((err as { path?: string }).path ?? "pmtiles") &&
        !(err as { path?: string }).path?.endsWith(".pmtiles")
      ) {
        throw new PmtilesBinaryMissingError(
          "The `pmtiles` binary is not installed on the server.",
        );
      }
      throw err;
    }
  })();

  inFlight.set(routeId, job);
  try {
    return await job;
  } finally {
    inFlight.delete(routeId);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { routeId: rawRouteId } = await params;
  const parsed = routeIdSchema.safeParse(rawRouteId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid route id" }, { status: 400 });
  }
  const routeId = parsed.data;

  const [route] = await db
    .select({ geom: routes.geom })
    .from(routes)
    .where(eq(routes.id, routeId));

  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  const coords = route.geom.coordinates as [number, number][];
  if (coords.length < 2) {
    return NextResponse.json({ error: "Route has no geometry" }, { status: 422 });
  }

  let extractPath: string;
  try {
    extractPath = await ensureExtract(routeId, bboxFor(coords));
  } catch (err) {
    if (err instanceof PmtilesBinaryMissingError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    console.error(`trip tiles extract failed for ${routeId}:`, err);
    return NextResponse.json(
      { error: "Failed to build offline tiles" },
      { status: 500 },
    );
  }

  const bytes = await readFile(extractPath);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${routeId}.pmtiles"`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
