#!/usr/bin/env node
// =============================================================================
// Paddle Prints -- river routing SQL checks (scripts/test-rivers-route.mjs)
// =============================================================================
// Exercises the exact SQL the `rivers.route` tRPC endpoint runs, but straight
// against the dev DB via the `postgres` driver (no Next/tRPC/jest). Mirrors the
// router's three code paths -- snap, same-edge shortcut, pgr_withPoints assembly
// -- and asserts distances, single-LineString geometry, endpoint placement, and
// the SNAP_TOO_FAR / NO_PATH failure cases.
//
//   pnpm test:rivers        (reads DATABASE_URL from .env)
// =============================================================================
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- resolve DATABASE_URL (env > .env) --------------------------------------
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(join(HERE, "..", ".env"), "utf8");
  const m = envText.match(/^\s*DATABASE_URL=\s*["']?([^"'\n]+?)["']?\s*$/m);
  if (!m) throw new Error("DATABASE_URL not found in env or .env");
  return m[1];
}

const sql = postgres(resolveDatabaseUrl(), { max: 1 });

const SNAP_RADIUS_M = 300;
const MAX_DISTANCE_M = 150_000;

// --- geodesic distance between two [lng,lat] points, in metres --------------
function haversineM(aLng, aLat, bLng, bLat) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function finalize(row, snappedA, snappedB) {
  if (!row || row.geojson == null || row.distance_m == null) {
    return { error: "NO_PATH" };
  }
  if (row.gtype !== "ST_LineString") {
    return { error: "ASSEMBLY", gtype: row.gtype };
  }
  if (row.distance_m > MAX_DISTANCE_M) {
    return { error: "TOO_LONG", distanceM: row.distance_m };
  }
  return {
    snappedA,
    snappedB,
    geometry: JSON.parse(row.geojson),
    distanceM: row.distance_m,
  };
}

// Faithful port of the `rivers.route` resolver's SQL, path for path.
async function routeRivers(a, b) {
  const snapRows = await sql`
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
  `;

  const snapA = snapRows.find((r) => r.pid === 1);
  const snapB = snapRows.find((r) => r.pid === 2);
  if (!snapA) return { error: "SNAP_TOO_FAR", which: "A" };
  if (!snapB) return { error: "SNAP_TOO_FAR", which: "B" };

  const snappedA = { lng: snapA.snap_lng, lat: snapA.snap_lat };
  const snappedB = { lng: snapB.snap_lng, lat: snapB.snap_lat };

  // Same-edge shortcut.
  if (snapA.edge_id === snapB.edge_id) {
    const fa = snapA.fraction;
    const fb = snapB.fraction;
    const [row] = await sql`
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
        ST_AsGeoJSON(line)    AS geojson,
        ST_GeometryType(line) AS gtype,
        (${snapA.cost_m}::float8 * abs(${fb}::float8 - ${fa}::float8)) AS distance_m
      FROM sub
    `;
    return finalize(row, snappedA, snappedB);
  }

  // Multi-edge: pgr_withPoints + oriented assembly under a 10s timeout.
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '10s'`;
    return tx`
      WITH
      fr AS (
        SELECT ${snapA.edge_id}::bigint  AS ea_id,
               ${snapB.edge_id}::bigint  AS eb_id,
               ${snapA.fraction}::float8 AS fa,
               ${snapB.fraction}::float8 AS fb
      ),
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
        WHERE s.edge <> -1
      ),
      oriented AS (
        SELECT path_seq,
          CASE
            WHEN from_node = -1 THEN
              CASE WHEN to_node = target THEN ST_LineSubstring(geom, fa, 1)
                   ELSE ST_Reverse(ST_LineSubstring(geom, 0, fa)) END
            WHEN to_node = -2 THEN
              CASE WHEN from_node = source THEN ST_LineSubstring(geom, 0, fb)
                   ELSE ST_Reverse(ST_LineSubstring(geom, fb, 1)) END
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
    `;
  });

  return finalize(rows[0], snappedA, snappedB);
}

// --- tiny assertion harness -------------------------------------------------
let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? `  -- ${detail}` : ""}`);
  }
}

function endpoints(res) {
  const c = res.geometry.coordinates;
  return { first: c[0], last: c[c.length - 1] };
}

async function main() {
  // Test coordinates (all validated against the dev graph).
  const ARGO = { lng: -83.7485, lat: 42.2935 }; // Huron put-in near Argo
  const GALLUP = { lng: -83.719, lat: 42.2837 }; // Huron take-out near Gallup Park
  const SAME_A = { lng: -83.75213, lat: 42.30191 }; // frac ~0.30 on Huron edge 78260
  const SAME_B = { lng: -83.75021, lat: 42.3025 }; // frac ~0.36 on the same edge
  const MILL_CREEK = { lng: -83.89, lat: 42.33 }; // tributary of the Huron
  const HURON_MAIN = { lng: -83.7485, lat: 42.2935 };
  const FARM_FIELD = { lng: -84.2, lat: 42.5 }; // ~1.2km from any waterway
  const GRAND_LANSING = { lng: -84.5498, lat: 42.7328 }; // on the Grand River, a disconnected system

  // --- 1. Argo -> Gallup: same-river multi-edge route -----------------------
  console.log("1. Argo -> Gallup (Huron, multi-edge)");
  {
    const res = await routeRivers(ARGO, GALLUP);
    check("no error", !res.error, JSON.stringify(res));
    if (!res.error) {
      check("single LineString", res.geometry.type === "LineString", res.geometry.type);
      check(
        `distance ~3.5-3.7km (got ${Math.round(res.distanceM)}m)`,
        res.distanceM >= 3450 && res.distanceM <= 3750,
      );
      const { first, last } = endpoints(res);
      const startOff = haversineM(first[0], first[1], res.snappedA.lng, res.snappedA.lat);
      const endOff = haversineM(last[0], last[1], res.snappedB.lng, res.snappedB.lat);
      check(`starts at snapped A (${startOff.toFixed(1)}m)`, startOff <= 50);
      check(`ends at snapped B (${endOff.toFixed(1)}m)`, endOff <= 50);
    }
  }

  // --- 2. Same-edge shortcut ------------------------------------------------
  console.log("2. Two points ~170m apart on one edge (same-edge shortcut)");
  {
    const res = await routeRivers(SAME_A, SAME_B);
    check("no error", !res.error, JSON.stringify(res));
    if (!res.error) {
      check("single LineString", res.geometry.type === "LineString", res.geometry.type);
      check(
        `short distance 100-300m (got ${Math.round(res.distanceM)}m)`,
        res.distanceM >= 100 && res.distanceM <= 300,
      );
      const { first, last } = endpoints(res);
      const startOff = haversineM(first[0], first[1], res.snappedA.lng, res.snappedA.lat);
      const endOff = haversineM(last[0], last[1], res.snappedB.lng, res.snappedB.lat);
      check(`starts at snapped A (${startOff.toFixed(1)}m)`, startOff <= 50);
      check(`ends at snapped B (${endOff.toFixed(1)}m)`, endOff <= 50);
    }
  }

  // --- 3. Reversed direction gives same distance + reversed line ------------
  console.log("3. Reversed direction (Gallup -> Argo)");
  {
    const fwd = await routeRivers(ARGO, GALLUP);
    const rev = await routeRivers(GALLUP, ARGO);
    check("both routed", !fwd.error && !rev.error);
    if (!fwd.error && !rev.error) {
      check(
        `same distance (fwd ${Math.round(fwd.distanceM)}m, rev ${Math.round(rev.distanceM)}m)`,
        Math.abs(fwd.distanceM - rev.distanceM) < 1,
      );
      const fwdEnds = endpoints(fwd);
      const revEnds = endpoints(rev);
      // Reversed route should start where the forward route ended, and vice-versa.
      const startFlip = haversineM(revEnds.first[0], revEnds.first[1], fwdEnds.last[0], fwdEnds.last[1]);
      const endFlip = haversineM(revEnds.last[0], revEnds.last[1], fwdEnds.first[0], fwdEnds.first[1]);
      check(`reversed line starts at forward end (${startFlip.toFixed(1)}m)`, startFlip <= 5);
      check(`reversed line ends at forward start (${endFlip.toFixed(1)}m)`, endFlip <= 5);
    }
  }

  // --- 4. Confluence crossing (tributary -> main stem) ----------------------
  console.log("4. Mill Creek -> Huron main stem (crosses a confluence)");
  {
    const res = await routeRivers(MILL_CREEK, HURON_MAIN);
    check("no error", !res.error, JSON.stringify(res));
    if (!res.error) {
      check("single LineString", res.geometry.type === "LineString", res.geometry.type);
      check(
        `distance ~22.2km (got ${(res.distanceM / 1000).toFixed(2)}km)`,
        res.distanceM >= 21000 && res.distanceM <= 23500,
      );
    }
  }

  // --- 5. SNAP_TOO_FAR ------------------------------------------------------
  console.log("5. Point in a farm field -> SNAP_TOO_FAR");
  {
    const res = await routeRivers(FARM_FIELD, HURON_MAIN);
    check("error is SNAP_TOO_FAR", res.error === "SNAP_TOO_FAR", JSON.stringify(res));
    check("identifies point A", res.which === "A", JSON.stringify(res));
  }

  // --- 6. NO_PATH -----------------------------------------------------------
  console.log("6. Huron -> Grand River (disconnected systems) -> NO_PATH");
  {
    const res = await routeRivers(HURON_MAIN, GRAND_LANSING);
    check("error is NO_PATH", res.error === "NO_PATH", JSON.stringify(res));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
