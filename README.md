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

### Deploying to Coolify

1. **Create the resource.** In Coolify, add a new "Docker Compose" resource pointing at this repo's `docker-compose.yml`. It provisions the three services above as one stack, sharing a project network.
2. **Set environment variables** on the App service (see the table above): `DATABASE_URL` (point at the compose Postgres service, e.g. `postgresql://user:pass@db:5432/paddle_prints`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your public app URL), `INVITE_CODE`, `NEXT_PUBLIC_TILES_URL` (your public tiles subdomain), and `NEXT_PUBLIC_APP_URL`.
3. **Point subdomains** at the App and Tiles services (e.g. `paddle-prints.app` → App on 3000, `tiles.paddle-prints.app` → Tiles on 80) via Coolify's proxy/domain settings.
4. **Run migrations** once the App service is up: `pnpm db:migrate` (via Coolify's terminal/exec into the App container, or an SSH tunnel to the DB as below with `drizzle-kit migrate` run locally against it).
5. **Ship the map tiles.** The `michigan.pmtiles` file isn't built by the compose stack — build it locally (see the tiles build docs) and `scp` it to the Tiles service's persistent volume on the Coolify host, e.g.:
   ```bash
   scp tiles/data/michigan.pmtiles user@your-coolify-host:/path/to/tiles-volume/michigan.pmtiles
   ```
6. **Load the river routing graph.** `scripts/etl-waterways.sh` needs direct Postgres access, which isn't exposed publicly — open an SSH tunnel to the DB container first, then run the ETL against the tunnel (see "River routing data" below for the exact commands). Budget ~68 MB of DB growth and a few minutes of load time.
7. **Smoke test**: visit the app subdomain, register with the invite code, confirm the map tiles load and a river route can be drawn.

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
- [x] **Phase 1**: Interactive map tiles & zoom
- [x] **Phase 2**: Waypoint routes & editing
- [x] **Phase 3**: River-aware routing & snapping
- [x] **Phase 4**: Live trip recording
- [x] **Phase 5**: Points of interest (beaches, take-outs)
- [x] **Phase 6**: Offline map caching
- [x] **Phase 7**: ETA predictions & polish

## First paddle checklist

Before your first trip on the water:

1. **Install to your Home Screen.** In Safari, tap Share → "Add to Home Screen". Opening Paddle Prints from the Home Screen icon (not a Safari tab) is what unlocks reliable offline storage and background GPS on iOS.
2. **Allow location, "While Using".** The first time you tap Start, iOS will prompt for location access — allow it. If you ever need to fix this later: Settings → Privacy & Security → Location Services → Paddle Prints → While Using.
3. **Download your route on WiFi.** Open the route you plan to paddle and tap "Download for offline" before you leave signal — it caches the map tiles for that corridor.
4. **Airplane-mode test.** With the route downloaded, switch the phone to Airplane Mode and open the route again: the map should still render and Start should still work. This is the real test that you're ready to paddle somewhere with no signal — turn Airplane Mode back off before you actually go.
