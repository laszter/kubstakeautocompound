# KUB Stake Auto-Compound — one Dockerfile, two runtime targets:
#   docker build --target web    -t kubstake-web .     → Next.js standalone server (port 3000)
#   docker build --target worker -t kubstake-worker .  → worker + migrate + healthcheck bundles
# Normally built via `docker compose build` (see docker-compose.yml).
#
# No secrets are used at build time: `next build` reads no env (env is validated lazily /
# at server start), and the worker bundles read env only when they run.

ARG NODE_IMAGE=node:26-slim

# ---------------------------------------------------------------------------------------
# base — shared runtime base (Node 26 has no corepack → npm only)
# ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------------------
# deps — install all workspace deps (incl. dev: next, typescript, esbuild) from the lockfile.
# Only manifests are copied so this layer is cached until a package.json / lockfile changes.
# ---------------------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --no-audit --no-fund

# ---------------------------------------------------------------------------------------
# build — full source on top of deps (host node_modules/.next/dist are excluded by .dockerignore)
# ---------------------------------------------------------------------------------------
FROM deps AS build
COPY . .

# Separate build stages so the worker image does not depend on the web compile (and vice versa);
# BuildKit only runs the stages a target needs.
FROM build AS build-worker
# esbuild → apps/worker/dist/{worker,migrate,healthcheck}.cjs (only pg-native external → no node_modules needed)
RUN npm run build -w @kubstake/worker

FROM build AS build-web
# next build (output: 'standalone') → apps/web/.next/standalone/apps/web/server.js
RUN npm run build -w @kubstake/web

# ---------------------------------------------------------------------------------------
# web — Next.js standalone server
# ---------------------------------------------------------------------------------------
FROM base AS web
ENV HOSTNAME=0.0.0.0 \
    PORT=3000
# standalone = server.js + traced node_modules (linux natives: @node-rs/argon2, sharp, ...)
COPY --from=build-web /app/apps/web/.next/standalone ./
# standalone does not include static assets / public → copy them next to the server
COPY --from=build-web /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web /app/apps/web/public ./apps/web/public
# app files stay root-owned (read-only for the runtime user); only Next's cache dir is writable
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------------------
# worker — worker loop (default CMD); compose also runs `node dist/migrate.cjs` (one-shot)
# and `node dist/healthcheck.cjs` (healthcheck) from this image
# ---------------------------------------------------------------------------------------
FROM base AS worker
ENV MIGRATIONS_DIR=/app/drizzle
COPY --from=build-worker /app/apps/worker/package.json ./package.json
COPY --from=build-worker /app/apps/worker/dist ./dist
COPY --from=build-worker /app/packages/db/drizzle ./drizzle
USER node
CMD ["node", "dist/worker.cjs"]
