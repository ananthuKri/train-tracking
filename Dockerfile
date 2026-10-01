# syntax=docker/dockerfile:1.7
# Multi-stage build: one image runs the API (which also serves the built web app) or the worker.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build -w @railtrack/api && npm run build -w @railtrack/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The Prisma CLI is kept (with its engines, downloaded by its install script) so the API can run `migrate deploy`.
RUN npm ci --omit=dev --ignore-scripts -w @railtrack/api && npm install --no-save prisma@7.10.0 && npm cache clean --force
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build /app/apps/web/dist apps/web/dist
WORKDIR /app/apps/api
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8000/api/health || exit 1
CMD ["node", "dist/server.js"]
