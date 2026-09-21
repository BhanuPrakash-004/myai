# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM deps AS production-deps
RUN npm prune --omit=dev

# One-shot database maintenance. Migrations never run from page requests.
FROM base AS maintenance
ENV NODE_ENV=production
COPY --from=production-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY migrations ./migrations
COPY scripts/db ./scripts/db
COPY scripts/owner.ts scripts/attachments.ts scripts/worker.ts scripts/indexing.ts scripts/ai-smoke.ts scripts/recovery-validate.ts scripts/purge.ts ./scripts/
COPY src/lib ./src/lib
RUN mkdir -p /app/data/attachments && chown -R node:node /app/data
USER node
CMD ["node", "--import", "tsx", "scripts/db/migrate.ts"]

# Next serves both the frontend and backend route handlers.
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN mkdir -p /app/data/attachments /app/.next && chown -R node:node /app
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
