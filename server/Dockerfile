# syntax=docker/dockerfile:1

# Per-service targets even though there is one service today (blueprint §7.1): adding
# apps/api later is a copy of the last stage, not a restructure of this file.

# ---- base: the only place an OS patch has to land ----
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: install the whole workspace against the lockfile ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY libs/common/package.json ./libs/common/package.json
RUN npm ci

# ---- build: compile once; libs/common is transpiled into the app ----
FROM deps AS build
COPY . .
# next/font downloads Manrope here and serves it from our own origin, so a visitor to the
# privacy notice makes zero third-party requests while reading a page that says there are
# no third-party recipients. This step needs network; that failure is loud and acceptable.
RUN npm run build -w @peraplano/web

# ---- runtime-base: hardening shared by every service target ----
FROM base AS runtime-base
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# -G nodejs matters: without it busybox adduser drops the user into `nogroup`, and the
# COPY --chown=nextjs:nodejs below then grants a group the process is not a member of.
# Verified by `docker exec ... id` on a build that omitted it: gid=65533(nogroup).
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 -G nodejs nextjs

# ---- web ----
FROM runtime-base AS web
# npm workspaces put the standalone entrypoint at apps/web/server.js with hoisted
# node_modules at the root — not the flat server.js a single-package Next app emits.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
# /api/health answers 200 with status "degraded" when compliance values are missing, so a
# half-configured dev container reports honestly instead of restart-looping. In production
# the container never reaches that state: instrumentation.ts exits 1 before the server
# accepts a request, so a misconfigured production container dies rather than reports.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---- api_deps: the same install as `deps`, plus apps/api ----
# Deliberately a separate stage rather than an extra COPY in `deps`: `deps` and `build` are
# on the critical path of the shipped web image, and nothing about adding a backend is worth
# a chance of changing what that image installs. `npm ci` is verified to succeed against a
# lockfile whose apps/api entry has no directory on disk, so `deps` needs no edit at all.
# Fold this back into `deps` once api and web actually deploy together.
FROM base AS api_deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY libs/common/package.json ./libs/common/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

# ---- api_build: tsc the api workspace to apps/api/dist ----
FROM api_deps AS api_build
COPY . .
RUN npm run build -w @peraplano/api

# ---- api ----
FROM runtime-base AS api
# Hoisted workspace install: apps/api/dist/server.js resolves its deps from /app/node_modules,
# so the whole tree comes along rather than a per-package copy.
COPY --from=api_build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=api_build --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=api_build --chown=nextjs:nodejs /app/apps/api/package.json ./apps/api/package.json
COPY --from=api_build --chown=nextjs:nodejs /app/apps/api/dist ./apps/api/dist
USER nextjs
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
