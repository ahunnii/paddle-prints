import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import type { LineString } from "geojson";
import { z } from "zod";

import { routes } from "@paddle-prints/db/schema";
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

/** One oriented step of the assembled path, used to derive per-leg flow direction. */
interface FlowStep {
  /** How the edge geometry was traversed: forward (downstream) or reversed (upstream). */
  forward: boolean;
  /** Geodesic length of this (oriented) step in metres. */
  lengthM: number;
  /** OSM waterway class of the edge (`river` | `stream` | `canal`). */
  waterway: string | null;
}

/** The assembled-geometry shape returned by both the same-edge and pgRouting queries. */
interface AssemblyRow {
  geojson: string | null;
  gtype: string | null;
  distance_m: number | null;
  /** Per-step orientation details, in path order, for building {@link FlowLeg}s. */
  steps: FlowStep[] | null;
}

/** A contiguous stretch of the route paddled in one flow direction, in metres from the start. */
interface FlowLeg {
  startM: number;
  endM: number;
  direction: "downstream" | "upstream" | "unknown";
}

interface LatLng {
  lng: number;
  lat: number;
}

/**
 * Collapse the ordered oriented steps into flow legs, accumulating cumulative metres and merging
 * contiguous same-direction steps. Forward traversal = paddling downstream, reversed = upstream;
 * a `canal`-class edge has no reliable digitised flow direction, so it reports `unknown`.
 */
function stepsToLegs(steps: FlowStep[]): FlowLeg[] {
  const legs: FlowLeg[] = [];
  let cumM = 0;
  for (const step of steps) {
    const direction: FlowLeg["direction"] =
      step.waterway === "canal"
        ? "unknown"
        : step.forward
          ? "downstream"
          : "upstream";
    const startM = cumM;
    cumM += step.lengthM;
    const last = legs[legs.length - 1];
    if (last && last.direction === direction) {
      last.endM = cumM;
    } else {
      legs.push({ startM, endM: cumM, direction });
    }
  }
  return legs;
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
): {
  snappedA: LatLng;
  snappedB: LatLng;
  geometry: LineString;
  distanceM: number;
  legs: FlowLeg[];
} {
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
    legs: stepsToLegs(row.steps ?? []),
  };
}

// --- USGS live river conditions ---------------------------------------------

/** The shape returned by {@link riversRouter.conditions} when a gauge is found. */
interface RiverConditions {
  siteName: string;
  siteId: string;
  dischargeCfs: number | null;
  gaugeHeightFt: number | null;
  observedAt: string;
  distanceKm: number;
}

/** Degrees of padding added around a route's bbox when searching for nearby gauges. */
const USGS_BBOX_PAD_DEG = 0.15;
/** USGS caps a bBox query at 1x1 degrees here (well under its own area limit). */
const USGS_BBOX_MAX_DEG = 1;
/** Cache USGS responses for 15 minutes -- instantaneous values update every ~15-60 min. */
const USGS_CACHE_TTL_MS = 15 * 60 * 1000;
/** Abort a slow USGS request rather than hang the tRPC call. */
const USGS_TIMEOUT_MS = 8000;

/** A USGS bBox (west,south,east,north), already padded and clamped, to 7 decimal places. */
interface UsgsBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Module-level cache of parsed USGS site lists, keyed by the rounded bbox string. */
const usgsCache = new Map<string, { at: number; sites: UsgsSite[] }>();

/** A single gauge site distilled from the USGS timeSeries payload. */
interface UsgsSite {
  siteId: string;
  siteName: string;
  lat: number;
  lng: number;
  dischargeCfs: number | null;
  gaugeHeightFt: number | null;
  observedAt: string | null;
}

/** Great-circle distance in kilometres between two lng/lat points. */
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/** Pad a route bbox by {@link USGS_BBOX_PAD_DEG} then clamp each side to {@link USGS_BBOX_MAX_DEG}. */
function padBbox(b: UsgsBbox): UsgsBbox {
  const clampSpan = (lo: number, hi: number): [number, number] => {
    let min = lo - USGS_BBOX_PAD_DEG;
    let max = hi + USGS_BBOX_PAD_DEG;
    if (max - min > USGS_BBOX_MAX_DEG) {
      const mid = (min + max) / 2;
      min = mid - USGS_BBOX_MAX_DEG / 2;
      max = mid + USGS_BBOX_MAX_DEG / 2;
    }
    return [min, max];
  };
  const [minLng, maxLng] = clampSpan(b.minLng, b.maxLng);
  const [minLat, maxLat] = clampSpan(b.minLat, b.maxLat);
  return { minLng, minLat, maxLng, maxLat };
}

/** USGS wants at most 7 decimal places in bBox coordinates. */
const round7 = (n: number): string => n.toFixed(7);

/** Minimal typed view of the parts of the USGS instantaneous-values JSON we read. */
interface UsgsResponse {
  value?: {
    timeSeries?: {
      sourceInfo?: {
        siteName?: string;
        siteCode?: { value?: string }[];
        geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } };
      };
      variable?: { variableCode?: { value?: string }[] };
      values?: { value?: { value?: string; dateTime?: string }[] }[];
    }[];
  };
}

/**
 * Fetch and parse active USGS gauges within `bbox`, grouping the 00060 (discharge, cfs) and 00065
 * (gauge height, ft) parameter series per site. Cached for {@link USGS_CACHE_TTL_MS}; any network
 * or parse failure yields an empty list (never throws to the client).
 */
async function fetchUsgsSites(bbox: UsgsBbox): Promise<UsgsSite[]> {
  const bboxStr = [
    round7(bbox.minLng),
    round7(bbox.minLat),
    round7(bbox.maxLng),
    round7(bbox.maxLat),
  ].join(",");

  const cached = usgsCache.get(bboxStr);
  if (cached && Date.now() - cached.at < USGS_CACHE_TTL_MS) {
    return cached.sites;
  }

  const url =
    `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bboxStr}` +
    `&parameterCd=00060,00065&siteStatus=active`;

  let json: UsgsResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(USGS_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`USGS conditions request failed: HTTP ${res.status}`);
      return [];
    }
    json = (await res.json()) as UsgsResponse;
  } catch (err) {
    console.warn("USGS conditions request errored:", err);
    return [];
  }

  const bySite = new Map<string, UsgsSite>();
  for (const ts of json.value?.timeSeries ?? []) {
    const siteId = ts.sourceInfo?.siteCode?.[0]?.value;
    const geo = ts.sourceInfo?.geoLocation?.geogLocation;
    if (!siteId || geo?.latitude == null || geo.longitude == null) continue;

    const paramCd = ts.variable?.variableCode?.[0]?.value;
    const series = ts.values?.[0]?.value ?? [];
    const latest = series[series.length - 1];
    if (!latest || latest.value == null) continue;
    const num = Number(latest.value);
    // USGS uses -999999 as a no-data sentinel.
    if (!Number.isFinite(num) || num <= -999999) continue;

    let site = bySite.get(siteId);
    if (!site) {
      site = {
        siteId,
        siteName: ts.sourceInfo?.siteName ?? siteId,
        lat: geo.latitude,
        lng: geo.longitude,
        dischargeCfs: null,
        gaugeHeightFt: null,
        observedAt: null,
      };
      bySite.set(siteId, site);
    }

    if (paramCd === "00060") site.dischargeCfs = num;
    else if (paramCd === "00065") site.gaugeHeightFt = num;

    // Track the most recent observation time across the site's parameters.
    if (latest.dateTime && (!site.observedAt || latest.dateTime > site.observedAt)) {
      site.observedAt = latest.dateTime;
    }
  }

  const sites = [...bySite.values()];
  usgsCache.set(bboxStr, { at: Date.now(), sites });
  return sites;
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

        // Both taps land on (near enough) the same fraction of the same edge:
        // ST_LineSubstring would degenerate to a Point instead of a LineString. Rather than a
        // 500 from `finalize`'s gtype check, tell the paddler the same way we tell them their
        // two points aren't connected -- NO_PATH's copy ("switch to waypoint mode" / different
        // points) fits and needs no separate client handling.
        if (Math.abs(fa - fb) < 1e-9) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "NO_PATH",
            cause: "Put-in and take-out snapped to the same point on the river",
          });
        }

        const sameEdge = (await ctx.db.execute(sql`
          WITH sub AS (
            SELECT
              CASE
                WHEN ${fa}::float8 <= ${fb}::float8
                  THEN ST_LineSubstring(geom, ${fa}::float8, ${fb}::float8)
                  ELSE ST_Reverse(ST_LineSubstring(geom, ${fb}::float8, ${fa}::float8))
              END AS line,
              -- fa <= fb means we paddle along the edge's stored (downstream) direction.
              (${fa}::float8 <= ${fb}::float8) AS forward,
              waterway
            FROM waterway_edges
            WHERE id = ${snapA.edge_id}::bigint
          )
          SELECT
            ST_AsGeoJSON(line)                                    AS geojson,
            ST_GeometryType(line)                                 AS gtype,
            (${snapA.cost_m}::float8 * abs(${fb}::float8 - ${fa}::float8)) AS distance_m,
            json_build_array(json_build_object(
              'forward', forward,
              'lengthM', ST_Length(line::geography),
              'waterway', waterway
            ))                                                    AS steps
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
                   w.geom, w.source, w.target, w.waterway, fr.fa, fr.fb
            FROM steps s
            JOIN waterway_edges w ON w.id = s.edge
            CROSS JOIN fr
            WHERE s.edge <> -1  -- the terminal row (edge = -1) carries no geometry
          ),
          -- Orient every segment so its start touches the previous segment's end. The forward flag
          -- is the non-ST_Reverse branch of the same CASE: forward = downstream, reversed = upstream.
          oriented AS (
            SELECT path_seq, waterway,
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
              END AS g,
              CASE
                WHEN from_node = -1 THEN (to_node = target)
                WHEN to_node = -2 THEN (from_node = source)
                ELSE (from_node = source)
              END AS forward
            FROM seg
          ),
          measured AS (
            SELECT path_seq, waterway, g, forward,
                   ST_Length(g::geography) AS length_m
            FROM oriented
          ),
          merged AS (
            SELECT ST_MakeLine(g ORDER BY path_seq) AS line FROM measured
          )
          SELECT
            ST_AsGeoJSON((SELECT line FROM merged))    AS geojson,
            ST_GeometryType((SELECT line FROM merged)) AS gtype,
            (SELECT max(agg_cost) FROM route)          AS distance_m,
            (SELECT json_agg(json_build_object(
               'forward', forward,
               'lengthM', length_m,
               'waterway', waterway
             ) ORDER BY path_seq) FROM measured)       AS steps
        `)) as unknown as AssemblyRow[];
      });

      return finalize(assembled[0], snappedA, snappedB);
    }),

  /**
   * Live USGS gauge conditions for a river route: the nearest active gauge's latest discharge
   * (cfs) and gauge height (ft). Returns `null` for non-river routes or when no gauge is found;
   * network errors degrade to `null` rather than throwing.
   */
  conditions: protectedProcedure
    .input(z.object({ routeId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<RiverConditions | null> => {
      // Pull the route's type, bbox, and midpoint in one shot.
      const rows = (await ctx.db.execute(sql`
        SELECT
          ${routes.type}                                   AS type,
          ST_XMin(${routes.geom})                          AS min_lng,
          ST_YMin(${routes.geom})                          AS min_lat,
          ST_XMax(${routes.geom})                          AS max_lng,
          ST_YMax(${routes.geom})                          AS max_lat,
          ST_X(ST_LineInterpolatePoint(${routes.geom}, 0.5)) AS mid_lng,
          ST_Y(ST_LineInterpolatePoint(${routes.geom}, 0.5)) AS mid_lat
        FROM ${routes}
        WHERE ${routes.id} = ${input.routeId}
      `)) as unknown as {
        type: string;
        min_lng: number;
        min_lat: number;
        max_lng: number;
        max_lat: number;
        mid_lng: number;
        mid_lat: number;
      }[];

      const route = rows[0];
      if (!route) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Route not found" });
      }
      if (route.type !== "river") return null;

      const bbox = padBbox({
        minLng: route.min_lng,
        minLat: route.min_lat,
        maxLng: route.max_lng,
        maxLat: route.max_lat,
      });
      const midpoint: LatLng = { lng: route.mid_lng, lat: route.mid_lat };

      const sites = await fetchUsgsSites(bbox);
      if (sites.length === 0) return null;

      // Pick the gauge nearest the route's midpoint.
      let nearest = sites[0]!;
      let nearestKm = haversineKm(midpoint, { lng: nearest.lng, lat: nearest.lat });
      for (const site of sites.slice(1)) {
        const km = haversineKm(midpoint, { lng: site.lng, lat: site.lat });
        if (km < nearestKm) {
          nearest = site;
          nearestKm = km;
        }
      }

      return {
        siteName: nearest.siteName,
        siteId: nearest.siteId,
        dischargeCfs: nearest.dischargeCfs,
        gaugeHeightFt: nearest.gaugeHeightFt,
        observedAt: nearest.observedAt ?? new Date().toISOString(),
        distanceKm: nearestKm,
      };
    }),
});
