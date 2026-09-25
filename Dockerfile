# syntax=docker/dockerfile:1
# AI Job Agent — one build, two runtime images:
#   --target api  → Express API, BullMQ workers, scheduler, migrations (same image, different command)
#   --target web  → Next.js dashboard (standalone server)

# The lockfile was generated with npm 11; node:22-alpine ships npm 10.
FROM node:22-alpine AS base
RUN npm install -g npm@11.6.2 && npm cache clean --force
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into Next's rewrite table; only used if a request reaches Next without Caddy in front.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @jobagent/api && npm run build -w @jobagent/web

# Runtime dependencies of the API only (no Next.js, React, TypeScript, test tooling).
FROM base AS api-deps
RUN npm ci --omit=dev -w @jobagent/api --include-workspace-root=false && npm cache clean --force

FROM node:22-alpine AS api
ENV NODE_ENV=production \
    PORT=4000 \
    INTERNAL_PORT=4001 \
    STORAGE_LOCAL_DIR=/data/uploads
WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=api-deps /app/package.json ./
COPY apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000 4001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM node:22-alpine AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
