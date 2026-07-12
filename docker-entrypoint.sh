#!/bin/sh
set -e

# Runs migrations (which also ensure the postgis/pgrouting extensions exist) before starting the
# Next.js standalone server. Paths are relative to the image WORKDIR (/app), matching the monorepo
# layout reproduced by Next's standalone output.
echo "[entrypoint] running database migrations..."
node packages/db/migrate.mjs

echo "[entrypoint] starting server..."
exec node apps/web/server.js
