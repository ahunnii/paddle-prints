#!/usr/bin/env bash
# Serves ./tiles/data over HTTP on :8080 with CORS + Range support, using the
# repo's Caddyfile. Used for local dev so the map can fetch michigan.pmtiles.
set -euo pipefail

cd "$(dirname "$0")/.."

exec docker run --rm -p 8080:80 \
  -v "$PWD/tiles/data:/srv" \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine
