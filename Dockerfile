# syntax=docker/dockerfile:1

# Build: install the whole workspace, build the web app, and bundle the server (with the web app's
# files beside it) into one folder.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# Fetch packages from the lockfile alone first, so this layer stays cached until it changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
# The trailing "..." builds the server's dependencies first, which includes the web app.
RUN pnpm install --offline --frozen-lockfile && pnpm --filter "@firewall/server..." build
# better-sqlite3 stays outside the bundle (it loads a native binary from its own folder). Keep its
# JavaScript and its prebuilt Linux binaries; the C++ sources and other platforms aren't needed.
RUN src="$(readlink -f apps/server/node_modules/better-sqlite3)" \
  && mkdir -p /out/node_modules/better-sqlite3/prebuilds \
  && cp -R "$src/package.json" "$src/lib" /out/node_modules/better-sqlite3/ \
  && cp "$src"/prebuilds/linux-*.node /out/node_modules/better-sqlite3/prebuilds/

# Run: the bundle, its migrations, the web app and better-sqlite3, as the non-root node user
# (uid 1000, which owns data/ on the server).
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /out/node_modules ./node_modules
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
