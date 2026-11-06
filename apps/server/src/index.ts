import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type LiveModels, liveModelsFromEnv } from "@firewall/agent";
import { createArenaService } from "@firewall/arena";
import { openEventLog } from "@firewall/events";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { paymentSetupFromEnv } from "./payments.js";
import { version } from "./version.js";

const { port, dataDir, resultsDir: configuredResults, liveDailyUsd } = readConfig(process.env);

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

// The eval's results files: RESULTS_DIR, or the repo's results/ folder when run from source. The
// bundled build has no such folder next to it, so the dashboard says there are none until
// RESULTS_DIR points at some.
const resultsDir = configuredResults ?? fileURLToPath(new URL("../../../results", import.meta.url));

// The one payment adapter: the sandbox's when its variables are set, otherwise a single fake the
// server owns, so practice runs can be decided from the web app too. A live run from the web app
// and a decision on it go through this same instance (createApp hands it to both).
const { setup: payments, note: paymentsNote } = paymentSetupFromEnv(process.env);
if (paymentsNote) console.warn(paymentsNote);

// Live runs need the app's own model key (FIREWALL_ANTHROPIC_API_KEY). Without it they are off,
// the page says so, and replays and everything else work as before.
let models: LiveModels | null = null;
try {
  models = liveModelsFromEnv(process.env);
} catch (error) {
  console.warn(`Live runs are off. ${error instanceof Error ? error.message : error}`);
}

const server = serve(
  {
    fetch: createApp({
      log,
      arena,
      payments,
      live: { models, capUsd: liveDailyUsd },
      resultsDir,
      ...(webDir && { webDir }),
    }).fetch,
    port,
  },
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
