import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type LiveModels, liveModelsFromEnv } from "@firewall/agent";
import { createArenaService } from "@firewall/arena";
import { openEventLog } from "@firewall/events";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { eventLogOptions } from "./open-log.js";
import { paymentSetupFromEnv } from "./payments.js";
import { studioClientFromEnv } from "./studio/client.js";
import { createStudioAiService } from "./studio/service.js";
import { version } from "./version.js";

const {
  port,
  dataDir,
  resultsDir: configuredResults,
  liveDailyUsd,
  studioDailyUsd,
  agStudioLicenseKey,
} = readConfig(process.env);

const log = openEventLog(eventLogOptions(dataDir));
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

// The dashboard assistant (AG Studio's AI) runs on the same key, with a cap of its own. Without the
// key it is off and the dashboard says so.
const studioClient = studioClientFromEnv(process.env);
if (studioClient.offReason) console.warn(studioClient.offReason);
const studioAi = createStudioAiService({
  log,
  client: studioClient.client,
  ...(studioClient.offReason && { offReason: studioClient.offReason }),
  capUsd: studioDailyUsd,
});

const server = serve(
  {
    fetch: createApp({
      log,
      arena,
      payments,
      live: { models, capUsd: liveDailyUsd },
      resultsDir,
      ...(webDir && { webDir }),
      studio: { licenseKey: agStudioLicenseKey, ai: studioAi },
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
