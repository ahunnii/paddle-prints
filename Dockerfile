# syntax=docker/dockerfile:1

# Production image for the @paddle-prints/web Next.js app in a pnpm + Turborepo monorepo.
# Built by Coolify from docker-compose.yml (service `app`, context `.`, this default Dockerfile).
#
# Strategy: `turbo prune` produces a minimal subtree for @paddle-prints/web (its own source plus
# the workspace packages it depends on) so the Docker layer cache only busts when those actually
# change. We then install from the pruned lockfile, build with Next's `output: "standalone"`, and
# assemble a slim non-root runtime.

# ---- base: shared toolchain ----
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

# ---- pruner: compute the pruned monorepo for the web app ----
# turbo@2.5.8 is pinned (not a floating tag) so builds are reproducible. `--docker` splits the
# output into out/json (package.json files + pruned pnpm-lock.yaml + pnpm-workspace.yaml, for a
# cache-friendly install layer) and out/full (full source of the pruned packages).
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.5.8 prune @paddle-prints/web --docker

# ---- deps: full (dev+prod) install for the build, from the pruned manifests ----
# out/json carries pnpm-workspace.yaml (which holds `nodeLinker: hoisted`) and the pruned
# lockfile, so --frozen-lockfile installs exactly the pinned versions into a flat node_modules.
FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
RUN pnpm install --frozen-lockfile

# ---- prod-deps: production-only install for the runtime (drizzle-orm + postgres for migrate.mjs) ----
# Next's standalone output only traces what the app imports, so it never bundles the migration
# script's deps. This flat, hoisted prod node_modules provides drizzle-orm + postgres for
# packages/db/migrate.mjs at container start.
FROM base AS prod-deps
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
RUN pnpm install --frozen-lockfile --prod

# ---- builder: build the Next.js app ----
FROM base AS builder
WORKDIR /app
# node_modules + installed manifests first, then overlay the actual source.
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ ./
# `tooling/` holds the shared tsconfig base (apps/web/tsconfig.json extends
# ../../tooling/typescript/base.json by relative path). It is NOT a workspace dependency, so
# `turbo prune` does not copy it -- without this, `next build`'s type-check step fails to resolve
# the extended config. Copy it straight from the full checkout in the pruner stage.
COPY --from=pruner /app/tooling ./tooling
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they must be provided
# as build args -- runtime env vars are too late for anything the browser reads.
ARG NEXT_PUBLIC_TILES_URL
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_TILES_URL=$NEXT_PUBLIC_TILES_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
# The web `build` script runs `dotenv -e ../../.env -- next build`; dotenv-cli errors on a missing
# env file. There is no .env in the image (it is git/docker-ignored), so create an empty one at the
# workspace root (../../.env from apps/web resolves to /app/.env).
RUN touch .env
RUN pnpm turbo build --filter=@paddle-prints/web

# ---- runner: minimal runtime image ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Install go-pmtiles (the `pmtiles` CLI) so the /api/trips/[routeId]/tiles route can carve per-trip
# offline extracts from the mounted statewide archive at request time. Pinned for reproducibility.
# The published Linux build is a statically linked Go binary (CGO disabled), so it runs on this
# Alpine/musl image unmodified. `uname -m` reports x86_64 / aarch64; map the latter to the release's
# `arm64` asset name.
ARG PMTILES_VERSION=1.31.0
RUN set -eux; \
  case "$(uname -m)" in \
    x86_64) PMTILES_ARCH=x86_64 ;; \
    aarch64 | arm64) PMTILES_ARCH=arm64 ;; \
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;; \
  esac; \
  wget -qO /tmp/pmtiles.tar.gz \
    "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${PMTILES_ARCH}.tar.gz"; \
  tar -xzf /tmp/pmtiles.tar.gz -C /usr/local/bin pmtiles; \
  rm /tmp/pmtiles.tar.gz; \
  chmod +x /usr/local/bin/pmtiles; \
  /usr/local/bin/pmtiles version

# Layering (create-t3-turbo style): lay down the prod node_modules first as a baseline, then
# overlay the standalone output on top. The standalone bundle ships its own minimal, precisely
# traced node_modules (next/react/sharp/...) which win on any file conflict -- and since both trees
# come from the same pruned lockfile the versions are identical, so the overlap is harmless. What
# the standalone tree omits (drizzle-orm + postgres, needed only by migrate.mjs) survives from the
# prod-deps baseline. Order matters: prod-deps node_modules must be copied BEFORE the standalone.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Standalone reproduces the monorepo layout: this yields /app/apps/web/server.js plus the traced
# /app/node_modules, /app/package.json, and /app/packages/*/package.json.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone/ ./

# Static assets and public/ are not part of standalone and must be copied to the paths the
# standalone server.js expects (relative to apps/web).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Migration assets for the startup migration script (run before the server boots).
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/migrate.mjs ./packages/db/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/drizzle ./packages/db/drizzle

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
