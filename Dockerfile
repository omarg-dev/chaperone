# syntax=docker/dockerfile:1

# Build: install the whole workspace and bundle the server into one file.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# Fetch packages from the lockfile alone first, so this layer stays cached until it changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
# Only the server and what it depends on: other packages' native modules need a compiler this
# image doesn't have, and the server doesn't use them yet.
RUN pnpm install --offline --frozen-lockfile --filter @firewall/server... \
  && pnpm --filter @firewall/server build

# Run: the bundle only, as the non-root node user (uid 1000, which owns data/ on the server).
FROM node:22-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/apps/server/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
