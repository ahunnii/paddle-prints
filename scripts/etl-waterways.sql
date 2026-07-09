-- =============================================================================
-- Paddle Prints -- river routing post-process
-- =============================================================================
-- Turns the raw osm2pgrouting output (`ways`, `ways_vertices_pgr`, and the
-- osm_* config tables) into a single, self-contained routable edge table:
-- `waterway_edges`. A later tRPC endpoint feeds this table to pgr_withPoints
-- (undirected) to snap two tapped points to rivers and return the along-river
-- path + distance.
--
-- Everything here is idempotent: re-running the ETL DROPs and rebuilds cleanly.
--
-- WHY a single edge table (no separate vertices table):
--   pgr_withPoints() and pgr_connectedComponents() -- the only pgRouting
--   functions this feature uses -- both take an *edges SQL* query and derive
--   the vertex set from the edges' source/target ids themselves. Neither needs
--   a materialised vertices table. osm2pgrouting's ways_vertices_pgr and the
--   osm_* config tables are therefore dropped at the end as clutter. The
--   integer source/target ids assigned by osm2pgrouting are preserved verbatim
--   in waterway_edges, so the graph topology (including split-at-confluence
--   connectivity) is fully intact.
--
-- cost model: cost_m = true geodesic length in metres (ST_Length over
--   geography). The routing endpoint uses cost_m for BOTH cost and
--   reverse_cost so the graph is symmetric / undirected (a river can be
--   paddled either way for routing/measuring purposes).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Build the clean edge table from osm2pgrouting output.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS waterway_edges CASCADE;

CREATE TABLE waterway_edges (
    id       bigint PRIMARY KEY,
    source   bigint NOT NULL,
    target   bigint NOT NULL,
    name     text,
    waterway text NOT NULL,          -- 'river' | 'stream' | 'canal'
    geom     geometry(LineString, 4326) NOT NULL,
    cost_m   double precision NOT NULL  -- geodesic length, metres
);

-- osm2pgrouting 3.0 schema: ways(id, tag_id, name, source, target, geom);
-- the waterway class name lives in configuration.tag_value, joined via tag_id.
INSERT INTO waterway_edges (id, source, target, name, waterway, geom, cost_m)
SELECT
    w.id                                 AS id,
    w.source                             AS source,
    w.target                             AS target,
    NULLIF(w.name, '')                   AS name,
    c.tag_value                          AS waterway,
    w.geom                               AS geom,
    ST_Length(w.geom::geography)         AS cost_m
FROM ways w
JOIN configuration c ON c.tag_id = w.tag_id
-- Defensive: only keep the linear waterway classes we mapped, drop any
-- zero-length / null-geometry degenerate edges that would break routing.
WHERE c.tag_value IN ('river', 'stream', 'canal')
  AND w.geom IS NOT NULL
  AND ST_NPoints(w.geom) >= 2
  AND w.source IS NOT NULL
  AND w.target IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Indexes for snapping (GIST on geom) and routing (source/target lookups).
-- ---------------------------------------------------------------------------
CREATE INDEX waterway_edges_geom_gist ON waterway_edges USING GIST (geom);
CREATE INDEX waterway_edges_source_idx ON waterway_edges (source);
CREATE INDEX waterway_edges_target_idx ON waterway_edges (target);

ANALYZE waterway_edges;

-- ---------------------------------------------------------------------------
-- 3. Drop the raw osm2pgrouting scaffolding -- waterway_edges is now the
--    single source of truth for routing. (IF EXISTS keeps this idempotent.)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS ways CASCADE;
DROP TABLE IF EXISTS ways_vertices_pgr CASCADE;
DROP TABLE IF EXISTS pointsofinterest CASCADE;
DROP TABLE IF EXISTS configuration CASCADE;
-- --addnodes tables (only present if that flag is used; harmless otherwise)
DROP TABLE IF EXISTS osm_nodes CASCADE;
DROP TABLE IF EXISTS osm_ways CASCADE;
DROP TABLE IF EXISTS osm_relations CASCADE;
-- Legacy osm2pgrouting 2.x config tables (no-op on 3.0)
DROP TABLE IF EXISTS osm_way_classes CASCADE;
DROP TABLE IF EXISTS osm_way_types CASCADE;

-- Drop any leftover osm2pgrouting temp/build tables (e.g. __ways1234).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename LIKE '\_\_ways%'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', t);
  END LOOP;
END $$;

COMMIT;
