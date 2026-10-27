# The API server. Build from the repository root:
#   docker build -f apps/backend/Dockerfile -t eventseva-api .
# Configure with environment variables (see apps/backend/.env.example); secrets are never baked in.
# On start it applies pending migrations, then serves on $PORT (default 3000).
FROM node:22-slim

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core packages/core
COPY apps/backend apps/backend
COPY database database

RUN pnpm install --frozen-lockfile --filter @eventseva/backend... \
 && pnpm --filter @eventseva/core build \
 && pnpm --filter @eventseva/backend build

ENV NODE_ENV=production
WORKDIR /app/apps/backend
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "pnpm migrate && node dist/main.js"]
