# The admin panel. Build from the repository root:
#   docker build -f apps/admin/Dockerfile --build-arg API_URL=https://api.eventseva.in -t eventseva-admin .
# API_URL is where the panel's /api rewrite sends requests; Next writes it into the build, so changing it
# means rebuilding. The panel holds no secrets: admins log in with their own password and 2FA.
FROM node:22-slim

# pnpm is fetched once here, into a folder the runtime user can read, so starting needs no download.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core packages/core
COPY packages/app-shared packages/app-shared
COPY apps/admin apps/admin

# Public values, also written into the build (see apps/admin/.env.example).
ARG API_URL=http://localhost:3000
ARG NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=keidpig5
ARG NEXT_PUBLIC_SUPPORT_EMAIL=support@eventseva.in
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter @eventseva/admin... \
 && pnpm --filter @eventseva/core build \
 && API_URL=$API_URL NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=$NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    pnpm --filter @eventseva/admin build \
 && chown -R node:node apps/admin/.next

ENV NODE_ENV=production
WORKDIR /app/apps/admin
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3001/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
