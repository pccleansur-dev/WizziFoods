# syntax=docker/dockerfile:1.7
#
# One Dockerfile, three images (build with --target):
#   docker build --target api    -t platform-api    .
#   docker build --target worker -t platform-worker .
#   docker build --target web    -t platform-web    \
#     --build-arg NEXT_PUBLIC_APP_URL=... --build-arg NEXT_PUBLIC_API_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... .
#
# The web bakes its public addresses at build time (Next.js inlines NEXT_PUBLIC_*), so those
# four are build arguments. Everything secret is a RUNTIME variable and never enters an image.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm CI=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

# ---- dependencies (cached while the lockfile does not change) --------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/infra/package.json packages/infra/
COPY packages/integrations/package.json packages/integrations/
COPY packages/observability/package.json packages/observability/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

# ---- api ------------------------------------------------------------------------------
FROM source AS build-api
RUN pnpm exec turbo run build --filter=@platform/api...
RUN pnpm --filter @platform/api deploy --prod --legacy /out/api

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production API_PORT=3001
WORKDIR /app
COPY --from=build-api /out/api ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- worker ---------------------------------------------------------------------------
FROM source AS build-worker
RUN pnpm exec turbo run build --filter=@platform/worker...
RUN pnpm --filter @platform/worker deploy --prod --legacy /out/worker

FROM node:24-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build-worker /out/worker ./
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.WORKER_METRICS_PORT+'/metrics').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- web ------------------------------------------------------------------------------
FROM source AS build-web
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 \
    APP_ENV=production LOG_LEVEL=info WEB_METRICS_PORT=9466
RUN pnpm exec turbo run build --filter=@platform/web...

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build-web --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/acceso').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
