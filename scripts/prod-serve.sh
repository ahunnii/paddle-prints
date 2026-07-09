#!/usr/bin/env bash
# Serve the standalone production build locally, mirroring what the Dockerfile does.
# Usage: pnpm build && ./scripts/prod-serve.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d .next/standalone ] || { echo "No standalone build. Run: pnpm build" >&2; exit 1; }

rm -rf .next/standalone/public .next/standalone/.next/static
cp -R public .next/standalone/public
cp -R .next/static .next/standalone/.next/static

set -a
source .env
set +a

exec node .next/standalone/server.js
