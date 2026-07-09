#!/usr/bin/env bash
# =============================================================================
# Paddle Prints -- Michigan waterway routing-graph ETL
# =============================================================================
# Turns the Michigan OSM extract into a routable pgRouting edge graph
# (`waterway_edges`) so the app can snap two tapped points to rivers and
# return the along-river path + distance via pgr_withPoints (undirected).
#
# Pipeline:
#   1. Locate a Michigan OSM extract (reuse the tile build's copy if present,
#      else download from Geofabrik into a scratch dir).
#   2. osmium tags-filter -> keep only linear waterway=river,stream,canal ways.
#   3. osmium cat          -> convert the filtered .pbf to .osm (XML) for
#                             osm2pgrouting.
#   4. osm2pgrouting       -> load + split ways at shared OSM nodes (this is
#                             what makes confluences routable).
#   5. psql etl-waterways.sql -> build the clean `waterway_edges` table
#                             (geodesic cost_m, GIST + topology indexes) and
#                             drop the raw osm2pgrouting scaffolding.
#   6. Validation queries   -> row/component counts + three routing spot-checks.
#
# Idempotent: safe to re-run. osm2pgrouting is invoked with --clean and the
# SQL DROPs everything IF EXISTS first.
#
# Usage:
#   ./scripts/etl-waterways.sh                 # reads DATABASE_URL from .env
#   DATABASE_URL=postgres://... ./scripts/etl-waterways.sh
#   ./scripts/etl-waterways.sh postgres://...  # or pass the URL as $1
#
# Running against PROD (Coolify) over an SSH tunnel -- see the README's
# "### River routing data" section.
# =============================================================================
set -euo pipefail

# --- paths -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Reuse the tile build's Michigan extract if present (READ-ONLY), else download.
SOURCE_PBF="${REPO_ROOT}/tiles/data/sources/michigan.osm.pbf"
GEOFABRIK_URL="https://download.geofabrik.de/north-america/us/michigan-latest.osm.pbf"

# Scratch dir for all intermediates -- never written into tiles/ or the repo.
WORK_DIR="${ETL_WORK_DIR:-${TMPDIR:-/tmp}/paddle-prints-etl}"

MAPCONFIG="${SCRIPT_DIR}/mapconfig_waterways.xml"
POSTPROCESS_SQL="${SCRIPT_DIR}/etl-waterways.sql"

# --- pretty logging ----------------------------------------------------------
log()  { printf '\033[1;36m[etl]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[etl] WARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[etl] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- resolve DATABASE_URL ----------------------------------------------------
# Precedence: $1 arg > env DATABASE_URL > .env file.
DATABASE_URL="${1:-${DATABASE_URL:-}}"
if [[ -z "${DATABASE_URL}" && -f "${REPO_ROOT}/.env" ]]; then
  # Grab DATABASE_URL from .env, stripping optional quotes.
  DATABASE_URL="$(grep -E '^\s*DATABASE_URL=' "${REPO_ROOT}/.env" | head -n1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']\s*$//')"
fi
[[ -n "${DATABASE_URL}" ]] || die "DATABASE_URL not set (pass as arg, env, or .env)."

# --- parse DATABASE_URL into libpq parts (osm2pgrouting takes discrete flags) -
# postgresql://user:pass@host:port/dbname
proto_stripped="${DATABASE_URL#*://}"
creds="${proto_stripped%%@*}"
hostpart="${proto_stripped#*@}"
DB_USER="${creds%%:*}"
DB_PASS="${creds#*:}"; [[ "${DB_PASS}" == "${creds}" ]] && DB_PASS=""
hostport="${hostpart%%/*}"
DB_NAME="${hostpart#*/}"; DB_NAME="${DB_NAME%%\?*}"   # strip any ?params
DB_HOST="${hostport%%:*}"
DB_PORT="${hostport#*:}"; [[ "${DB_PORT}" == "${hostport}" ]] && DB_PORT="5432"

# --- tool checks -------------------------------------------------------------
need_tool() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' not found. Install with: $2"
}
need_tool osmium         "brew install osmium-tool"
need_tool osm2pgrouting  "brew install osm2pgrouting"
need_tool psql           "brew install libpq  (and add its bin to PATH)"

[[ -f "${MAPCONFIG}" ]]       || die "missing mapconfig: ${MAPCONFIG}"
[[ -f "${POSTPROCESS_SQL}" ]] || die "missing post-process SQL: ${POSTPROCESS_SQL}"

# psql helper that carries the password + full URL.
psql_run() { PGPASSWORD="${DB_PASS}" psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"; }

log "target db   : ${DB_NAME} @ ${DB_HOST}:${DB_PORT} (user ${DB_USER})"
log "scratch dir : ${WORK_DIR}"
mkdir -p "${WORK_DIR}"

# Sanity: PostGIS + pgRouting must be present.
log "checking PostGIS + pgRouting extensions..."
psql_run -tAc "SELECT postgis_version();" >/dev/null || die "PostGIS not available on target DB."
psql_run -tAc "SELECT extversion FROM pg_extension WHERE extname='pgrouting';" | grep -q . \
  || die "pgRouting extension not installed on target DB (CREATE EXTENSION pgrouting;)."

# --- 1. locate the source extract -------------------------------------------
IN_PBF=""
if [[ -f "${SOURCE_PBF}" ]]; then
  log "reusing existing Michigan extract (read-only): ${SOURCE_PBF}"
  IN_PBF="${SOURCE_PBF}"
else
  IN_PBF="${WORK_DIR}/michigan-latest.osm.pbf"
  if [[ -f "${IN_PBF}" ]]; then
    log "reusing previously downloaded extract: ${IN_PBF}"
  else
    log "no local extract found; downloading from Geofabrik..."
    curl -fSL --retry 3 -o "${IN_PBF}.tmp" "${GEOFABRIK_URL}" \
      || die "download failed: ${GEOFABRIK_URL}"
    mv "${IN_PBF}.tmp" "${IN_PBF}"
    log "downloaded: ${IN_PBF} ($(du -h "${IN_PBF}" | cut -f1))"
  fi
fi

# --- 2. filter to linear navigable waterways --------------------------------
FILTERED_PBF="${WORK_DIR}/waterways.osm.pbf"
log "filtering to linear waterway=river,stream,canal ..."
# w/ = ways only (excludes riverbank *relations/areas*); linear centerlines only.
osmium tags-filter --overwrite \
  "${IN_PBF}" \
  w/waterway=river,stream,canal \
  -o "${FILTERED_PBF}"
log "filtered extract: $(du -h "${FILTERED_PBF}" | cut -f1)"

# --- 3. convert to .osm (XML) for osm2pgrouting -----------------------------
FILTERED_OSM="${WORK_DIR}/waterways.osm"
log "converting filtered .pbf -> .osm (XML) ..."
osmium cat --overwrite "${FILTERED_PBF}" -o "${FILTERED_OSM}"
log "xml extract: $(du -h "${FILTERED_OSM}" | cut -f1)"

# --- 4. load with osm2pgrouting (splits ways at shared nodes) ----------------
log "loading with osm2pgrouting (this splits ways at confluences) ..."
osm2pgrouting \
  --file     "${FILTERED_OSM}" \
  --conf     "${MAPCONFIG}" \
  --dbname   "${DB_NAME}" \
  --username "${DB_USER}" \
  --host     "${DB_HOST}" \
  --port     "${DB_PORT}" \
  --password "${DB_PASS}" \
  --clean \
  --no-index    # skip osm2pgrouting's own indexes; we build our own in SQL

# --- 5. post-process into waterway_edges ------------------------------------
log "post-processing -> waterway_edges (geodesic cost, indexes, drop raw) ..."
psql_run -f "${POSTPROCESS_SQL}"

# --- 6. validation -----------------------------------------------------------
log "================ VALIDATION ================"

log "row + component counts ..."
psql_run <<'SQL'
\pset footer off
SELECT 'edges'            AS metric, count(*)::text AS value FROM waterway_edges
UNION ALL
SELECT 'distinct_names',  count(DISTINCT name)::text FROM waterway_edges
UNION ALL
SELECT 'by_type: river',  count(*)::text FROM waterway_edges WHERE waterway='river'
UNION ALL
SELECT 'by_type: stream', count(*)::text FROM waterway_edges WHERE waterway='stream'
UNION ALL
SELECT 'by_type: canal',  count(*)::text FROM waterway_edges WHERE waterway='canal'
UNION ALL
SELECT 'total_length_km', round(sum(cost_m)/1000.0)::text FROM waterway_edges;

-- Connected components: expect many thousands (each disjoint river system = 1).
SELECT 'connected_components' AS metric, count(*)::text AS value
FROM (
  SELECT DISTINCT component
  FROM pgr_connectedComponents(
    'SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost FROM waterway_edges'
  )
) c;
SQL

# --- Reusable spot-check function -------------------------------------------
# Snaps two lon/lat points to their nearest edges and routes between them
# with pgr_withPoints (undirected). Prints total cost in km, or NO_PATH.
#
# Args: label  lon1 lat1  lon2 lat2
spot_check() {
  local label="$1" lon1="$2" lat1="$3" lon2="$4" lat2="$5"
  log "spot-check ${label}: (${lon1},${lat1}) -> (${lon2},${lat2})"
  PGPASSWORD="${DB_PASS}" psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -v lon1="${lon1}" -v lat1="${lat1}" -v lon2="${lon2}" -v lat2="${lat2}" <<'SQL'
\pset footer off
WITH pts AS (
  SELECT 1 AS pid, ST_SetSRID(ST_MakePoint(:lon1, :lat1), 4326) AS g
  UNION ALL
  SELECT 2 AS pid, ST_SetSRID(ST_MakePoint(:lon2, :lat2), 4326) AS g
),
-- nearest edge + fractional position along it for each tapped point
snapped AS (
  SELECT p.pid,
         e.id                                   AS edge_id,
         ST_LineLocatePoint(e.geom, p.g)        AS fraction,
         e.name                                 AS on_river,
         round(ST_Distance(e.geom::geography, p.g::geography))::int AS snap_dist_m
  FROM pts p
  CROSS JOIN LATERAL (
    SELECT id, geom, name
    FROM waterway_edges
    ORDER BY geom <-> p.g
    LIMIT 1
  ) e
),
-- Build the pgr_withPoints "points SQL" as a typed rowset. pgRouting's
-- convention: point pids in this rowset are POSITIVE (1, 2); the function
-- then represents each as a virtual vertex with id = -pid, so we route from
-- start_pid -1 to end_pid -2. Casts are required -- untyped literals make
-- pgr_withPoints silently yield no points (and thus a false NO_PATH).
points_sql AS (
  SELECT string_agg(
           format('SELECT %s::bigint AS pid, %s::bigint AS edge_id, %s::float8 AS fraction',
                  pid, edge_id, fraction),
           ' UNION ALL ' ORDER BY pid
         ) AS q
  FROM snapped
),
route AS (
  SELECT sum(r.cost) AS total_cost_m, count(*) AS edges_traversed
  FROM points_sql ps,
       pgr_withPoints(
         'SELECT id, source, target, cost_m AS cost, cost_m AS reverse_cost FROM waterway_edges',
         ps.q,
         -1, -2,
         directed := false
       ) r
)
SELECT
  (SELECT on_river    FROM snapped WHERE pid=1) AS from_river,
  (SELECT snap_dist_m FROM snapped WHERE pid=1) AS from_snap_m,
  (SELECT on_river    FROM snapped WHERE pid=2) AS to_river,
  (SELECT snap_dist_m FROM snapped WHERE pid=2) AS to_snap_m,
  CASE WHEN route.total_cost_m IS NULL THEN 'NO_PATH'
       ELSE round(route.total_cost_m)::text || ' m  (' ||
            round((route.total_cost_m/1000.0)::numeric, 2)::text || ' km)'
  END AS result,
  route.edges_traversed
FROM route;
SQL
}

# Spot-check A -- same-river routing on the Huron near Ann Arbor.
# Argo Cascades put-in -> Gallup Park take-out. Expect a same-river path ~3-4 km.
# (These are the accurate launch coords; the plan's ~(-83.804,42.308) put-in
#  actually sits ~6-7 km upstream near Barton Pond and yields ~13 km -- still a
#  valid same-river path, just a longer stretch. See README / ETL report.)
spot_check "A same-river (Huron: Argo Cascades->Gallup Park)" -83.7485 42.2935 -83.7175 42.2795

# Spot-check B -- confluence routing (tributary -> main stem). Mill Creek joins
# the Huron near Dexter; Mill Creek reaches the rest of the graph ONLY through
# that confluence, so any Mill-Creek -> Huron path must cross it. Expect a path.
spot_check "B confluence (Mill Creek -> Huron main stem)" -83.890 42.330 -83.7485 42.2935

# Spot-check C -- no-path: hydrologically separate systems (Huron vs Grand).
# Expect NO_PATH -- the typed NO_PATH case the API will need. Second point is on
# the Grand River in Lansing (a different river system entirely).
spot_check "C no-path (Huron vs Grand R. @ Lansing)" -83.7485 42.2935 -84.5555 42.7325

log "================ DONE ================"
log "waterway_edges is ready for pgr_withPoints (undirected) snapping."
