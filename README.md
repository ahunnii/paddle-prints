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

## Build Phases

- [x] **Phase 0**: Scaffold + auth setup
- [ ] **Phase 1**: Interactive map tiles & zoom
- [ ] **Phase 2**: Waypoint routes & editing
- [ ] **Phase 3**: River-aware routing & snapping
- [ ] **Phase 4**: Live trip recording
- [ ] **Phase 5**: Points of interest (beaches, take-outs)
- [ ] **Phase 6**: Offline map caching
- [ ] **Phase 7**: ETA predictions & polish
