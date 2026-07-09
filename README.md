# Paddle Prints

A playful Progressive Web App for ~15 friends to log, map, and share paddleboarding trips on Michigan rivers. Built with Next.js, PostGIS, and better-auth.

## Quickstart

```bash
# Install dependencies
pnpm install

# Start the database
./start-database.sh

# Run migrations
pnpm db:migrate

# Serve local map tiles (requires Docker; run in a separate terminal)
pnpm tiles:serve

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string with PostGIS | `postgresql://user:pass@localhost:5432/paddle_prints` |
| `BETTER_AUTH_SECRET` | Secret key for session encryption | `<32+ character random string>` |
| `BETTER_AUTH_URL` | Public URL for auth callbacks | `http://localhost:3000` (dev), `https://paddle-prints.app` (prod) |
| `INVITE_CODE` | Private code to join the app | `<shared with friends>` |
| `NEXT_PUBLIC_TILES_URL` | URL to PMTiles server | `http://localhost/michigan.pmtiles` |
| `NEXT_PUBLIC_APP_URL` | Public app URL for sharing | `https://paddle-prints.app` |

## Deployment

Deploy with Coolify using `docker-compose.yml`:
- **App**: Next.js server (port 3000)
- **Database**: PostgreSQL 16 with PostGIS extension
- **Tiles**: Caddy server (port 80) serving `michigan.pmtiles` with CORS headers

### River routing data

Phase 3 needs a routable graph of Michigan rivers so the app can snap two
tapped points to the nearest waterway and return the along-river path and
distance. `scripts/etl-waterways.sh` builds that graph:

1. Reuses the tile build's Michigan OSM extract
   (`tiles/data/sources/michigan.osm.pbf`, read-only) or downloads a fresh one
   from Geofabrik into a scratch dir when absent.
2. `osmium tags-filter` keeps only linear `waterway=river,stream,canal` ways
   (bank polygons like `riverbank` are excluded — they are not centerlines).
3. `osm2pgrouting` loads the ways and **splits them at shared OSM nodes**, which
   is what makes confluences routable (a tributary's end node lies on the main
   stem, so the two ways share a graph vertex).
4. `scripts/etl-waterways.sql` post-processes the raw output into a single
   self-contained table, **`waterway_edges`** (`id, source, target, name,
   waterway, geom, cost_m`), where `cost_m` is true geodesic length in metres.
   It adds a GIST index on `geom` (for snapping) plus `source`/`target` indexes
   (for routing), then drops all raw osm2pgrouting scaffolding.

The API routes with `pgr_withPoints` (undirected), using `cost_m` for both
`cost` and `reverse_cost`. `pgr_connectedComponents` over the same edge set
gives the typed `NO_PATH` case (two points on separate river systems).

Requires `osmium` and `osm2pgrouting` (`brew install osmium-tool osm2pgrouting`)
and `psql`. Run it against the **dev** DB:

```bash
./scripts/etl-waterways.sh          # reads DATABASE_URL from .env
```

It is idempotent (safe to re-run) and prints validation at the end: row and
connected-component counts plus three routing spot-checks. Current Michigan
build: **130,135 edges, 13,830 components, ~68 MB, ~90 s wall time** (reusing
the local extract; add Geofabrik download time on a cold first run).

Run it against **prod** (Coolify Postgres) over an SSH tunnel — the DB is not
exposed publicly, so forward its port to localhost first:

```bash
# Terminal 1 — tunnel local 55432 -> the Postgres container on the Coolify host.
# (Use the mapped host port for the paddle-prints Postgres service; 5432 shown.)
ssh -N -L 55432:localhost:5432 user@your-coolify-host

# Terminal 2 — point the ETL at the tunnel (creds match the prod DB).
DATABASE_URL="postgresql://<user>:<pass>@localhost:55432/<dbname>" \
  ./scripts/etl-waterways.sh
```

Budget ~68 MB of DB growth and a few minutes of load time on prod.

## Build Phases

- [x] **Phase 0**: Scaffold + auth setup
- [ ] **Phase 1**: Interactive map tiles & zoom
- [ ] **Phase 2**: Waypoint routes & editing
- [ ] **Phase 3**: River-aware routing & snapping
- [ ] **Phase 4**: Live trip recording
- [ ] **Phase 5**: Points of interest (beaches, take-outs)
- [ ] **Phase 6**: Offline map caching
- [ ] **Phase 7**: ETA predictions & polish
