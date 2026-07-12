import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { LineString } from "geojson";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

/** A `{ lng, lat }` coordinate, validated to real-world ranges. */
const latLng = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

/** Snap a tap to a river only if it lands within this many metres of a centreline. */
const SNAP_RADIUS_M = 300;

/** Refuse absurdly long river routes (~93 miles); the UI surfaces this as "split it up". */
const MAX_DISTANCE_M = 150_000;

/**
 * One snapped tap: the nearest `waterway_edges` row within {@link SNAP_RADIUS_M},
 * the fractional position along it, that edge's geodesic length, and the on-river point.
 * `edge_id` is returned as text to dodge JS bigint precision loss.
 */
interface SnapRow {
  pid: number;
  edge_id: string;
  fraction: number;
  cost_m: number;
  snap_lng: number;
  snap_lat: number;
}

/** The assembled-geometry shape returned by both the same-edge and pgRouting queries. */
interface AssemblyRow {
  geojson: string | null;
  gtype: string | null;
  distance_m: number | null;
}

interface LatLng {
  lng: number;
  lat: number;
}

function snapTooFar(which: "A" | "B"): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: "SNAP_TOO_FAR",
    cause: `Point ${which} is not within ${SNAP_RADIUS_M}m of a river`,
  });
}

/**
 * Turn a raw assembly result into the endpoint's response, converting the PostGIS
 * failure/edge cases into typed tRPC errors the client keys off of by `message`.
 */
function finalize(
  row: AssemblyRow | undefined,
  snappedA: LatLng,
  snappedB: LatLng,
): { snappedA: LatLng; snappedB: LatLng; geometry: LineString; distanceM: number } {
  // Empty pgRouting result -> the two points aren't connected on the graph.
  if (!row || row.geojson == null || row.distance_m == null) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "NO_PATH",
      cause: "The two points are not connected along the waterway graph",
    });
  }

  // A correctly-oriented assembly is always a single LineString. A MultiLineString means an
  // orientation/connectivity bug slipped through -- fail loudly rather than return a broken route.
  if (row.gtype !== "ST_LineString") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `River path assembly produced ${row.gtype ?? "no geometry"} instead of a single LineString`,
    });
  }

  if (row.distance_m > MAX_DISTANCE_M) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "TOO_LONG",
      cause: `River path is ${Math.round(row.distance_m)}m, over the ${MAX_DISTANCE_M}m limit`,
    });
  }

  return {
    snappedA,
    snappedB,
    geometry: JSON.parse(row.geojson) as LineString,
    distanceM: row.distance_m,
  };
}

export const riversRouter = createTRPCRouter({
  /**
   * Route two tapped points along the river graph.
   *
   * 1. Snap each tap to the nearest waterway centreline within 300m (else SNAP_TOO_FAR).
   * 2. If both land on the same edge, cut that edge directly (no pgRouting needed).
   * 3. Otherwise run `pgr_withPoints` (undirected) and stitch the partial first/last edges
   *    plus full intermediate edges into a single, correctly-oriented A->B LineString.
   */
  route: protectedProcedure
    .input(z.object({ a: latLng, b: latLng }))
    .query(async ({ ctx, input }) => {
      const { a, b } = input;

      // --- 1. Snap both taps ------------------------------------------------
      // CROSS JOIN LATERAL drops any tap with no edge inside the 300m guard, so a missing
      // pid unambiguously identifies which point failed to snap.
      const snapRows = (await ctx.db.execute(sql`
        WITH input(pid, g) AS (
          VALUES
            (1, ST_SetSRID(ST_MakePoint(${a.lng}, ${a.lat}), 4326)),
            (2, ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326))
        )
        SELECT
          i.pid::int                          AS pid,
          e.id::text                          AS edge_id,
          ST_LineLocatePoint(e.geom, i.g)     AS fraction,
          e.cost_m                            AS cost_m,
          ST_X(ST_ClosestPoint(e.geom, i.g))  AS snap_lng,
          ST_Y(ST_ClosestPoint(e.geom, i.g))  AS snap_lat
        FROM input i
        CROSS JOIN LATERAL (
          SELECT id, cost_m, geom
          FROM waterway_edges
          WHERE ST_DWithin(geom::geography, i.g::geography, ${SNAP_RADIUS_M})
          ORDER BY geom <-> i.g
          LIMIT 1
        ) e
      `)) as unknown as SnapRow[];

      const snapA = snapRows.find((r) => r.pid === 1);
      const snapB = snapRows.find((r) => r.pid === 2);

      if (!snapA) throw snapTooFar("A");
      if (!snapB) throw snapTooFar("B");

      const snappedA: LatLng = { lng: snapA.snap_lng, lat: snapA.snap_lat };
      const snappedB: LatLng = { lng: snapB.snap_lng, lat: snapB.snap_lat };

      // --- 2. Same-edge special case ---------------------------------------
      // Both taps on one edge: cut the sub-line directly and orient it A->B. pgRouting can't
      // route between two points on the same edge with no intervening vertex anyway.
      if (snapA.edge_id === snapB.edge_id) {
        const fa = snapA.fraction;
        const fb = snapB.fraction;
        const sameEdge = (await ctx.db.execute(sql`
          WITH sub AS (
            SELECT CASE
                     WHEN ${fa}::float8 <= ${fb}::float8
                       THEN ST_LineSubstring(geom, ${fa}::float8, ${fb}::float8)
                       ELSE ST_Reverse(ST_LineSubstring(geom, ${fb}::float8, ${fa}::float8))
                   END AS line
            FROM waterway_edges
            WHERE id = ${snapA.edge_id}::bigint
          )
          SELECT
            ST_AsGeoJSON(line)                                    AS geojson,
            ST_GeometryType(line)                                 AS gtype,
            (${snapA.cost_m}::float8 * abs(${fb}::float8 - ${fa}::float8)) AS distance_m
          FROM sub
        `)) as unknown as AssemblyRow[];

        return finalize(sameEdge[0], snappedA, snappedB);
      }

      // --- 3. Multi-edge routing + geometry assembly -----------------------
      // Wrapped in a transaction purely to scope a 10s statement_timeout to the pgRouting query.
      const assembled = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);

        return (await tx.execute(sql`
          WITH
          fr AS (
            SELECT ${snapA.edge_id}::bigint  AS ea_id,
                   ${snapB.edge_id}::bigint  AS eb_id,
                   ${snapA.fraction}::float8 AS fa,
                   ${snapB.fraction}::float8 AS fb
          ),
          -- pgr_withPoints "points SQL": POSITIVE pids with EXPLICIT casts (untyped literals
          -- silently yield zero virtual points -> a false NO_PATH). Routed as -pid (-1, -2).
          points AS (
            SELECT format(
              'SELECT 1::bigint AS pid, %s::bigint AS edge_id, %s::float8 AS fraction UNION ALL SELECT 2::bigint, %s::bigint, %s::float8',
              ea_id, fa, eb_id, fb
            ) AS q
            FROM fr
          ),
          route AS (
            SELECT r.path_seq, r.node, r.edge, r.agg_cost
            FROM points,
                 pgr_withPoints(
                   'SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost FROM waterway_edges',
                   points.q,
                   -1, -2,
                   directed := false,
                   details := false
                 ) r
          ),
          -- Each row's node is the vertex we're at; edge is the one traversed to LEAVE it.
          -- The next row's node is the vertex we arrive at -- this pair fixes each edge's direction.
          steps AS (
            SELECT r.path_seq,
                   r.node                                  AS from_node,
                   lead(r.node) OVER (ORDER BY r.path_seq) AS to_node,
                   r.edge
            FROM route r
          ),
          seg AS (
            SELECT s.path_seq, s.from_node, s.to_node,
                   w.geom, w.source, w.target, fr.fa, fr.fb
            FROM steps s
            JOIN waterway_edges w ON w.id = s.edge
            CROSS JOIN fr
            WHERE s.edge <> -1  -- the terminal row (edge = -1) carries no geometry
          ),
          -- Orient every segment so its start touches the previous segment's end.
          oriented AS (
            SELECT path_seq,
              CASE
                -- first edge: enter at fraction fa, exit toward the next vertex
                WHEN from_node = -1 THEN
                  CASE WHEN to_node = target THEN ST_LineSubstring(geom, fa, 1)
                       ELSE ST_Reverse(ST_LineSubstring(geom, 0, fa)) END
                -- last edge: come from the previous vertex, exit at fraction fb
                WHEN to_node = -2 THEN
                  CASE WHEN from_node = source THEN ST_LineSubstring(geom, 0, fb)
                       ELSE ST_Reverse(ST_LineSubstring(geom, fb, 1)) END
                -- intermediate edge: orient source->target so it starts at from_node
                ELSE
                  CASE WHEN from_node = source THEN geom
                       ELSE ST_Reverse(geom) END
              END AS g
            FROM seg
          ),
          merged AS (
            SELECT ST_MakeLine(g ORDER BY path_seq) AS line FROM oriented
          )
          SELECT
            ST_AsGeoJSON(line)                AS geojson,
            ST_GeometryType(line)             AS gtype,
            (SELECT max(agg_cost) FROM route) AS distance_m
          FROM merged
        `)) as unknown as AssemblyRow[];
      });

      return finalize(assembled[0], snappedA, snappedB);
    }),
});
