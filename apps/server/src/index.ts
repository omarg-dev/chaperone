import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createArenaService } from "@firewall/arena";
import { openEventLog } from "@firewall/events";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { version } from "./version.js";

const { port, dataDir } = readConfig(process.env);

// The bundled build ships the event log's migrations next to itself (see build.mjs). Run from
// source, there's no such folder and the events package finds its own.
const bundled = fileURLToPath(new URL("./drizzle", import.meta.url));
mkdirSync(dataDir, { recursive: true });
const log = openEventLog({
  path: join(dataDir, "events.db"),
  ...(existsSync(bundled) && { migrationsFolder: bundled }),
});
const arena = createArenaService({ log });

// The web app: the bundled build ships it next to itself (see build.mjs). Run from source, the
// folder the web app builds into is used when it exists, so `pnpm --filter @firewall/web build`
// followed by `pnpm dev` serves the whole thing from one port.
const bundledWeb = fileURLToPath(new URL("./web", import.meta.url));
const builtWeb = fileURLToPath(new URL("../../web/dist", import.meta.url));
const webDir = [bundledWeb, builtWeb].find((dir) => existsSync(join(dir, "index.html")));

const server = serve(
  { fetch: createApp({ log, arena, ...(webDir && { webDir }) }).fetch, port },
  (info) => {
    console.log(`Server ${version} listening on http://localhost:${info.port}`);
  },
);

// `docker compose up -d` stops the old container with SIGTERM; close cleanly instead of being killed.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => {
      log.close();
      process.exit(0);
    });
  });
}
