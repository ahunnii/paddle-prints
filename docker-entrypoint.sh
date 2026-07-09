#!/bin/sh
set -e

echo "[entrypoint] running database migrations..."
node scripts/migrate.mjs

echo "[entrypoint] starting server..."
exec node server.js
