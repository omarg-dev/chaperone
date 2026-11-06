import type { LiveModels } from "@firewall/agent";
import { type ArenaService, ShopError } from "@firewall/arena";
import { type EventLog, InvalidEventError } from "@firewall/events";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createLiveService } from "./live/service.js";
import type { PaymentSetup } from "./payments.js";
import { arenaRoutes } from "./routes/arena.js";
import { evalRoutes } from "./routes/eval.js";
import { eventRoutes } from "./routes/events.js";
import { liveRoutes } from "./routes/live.js";
import { version } from "./version.js";
import { webHandler } from "./web.js";

export interface AppDependencies {
  log: EventLog;
  arena: ArenaService;
  // The one payment adapter the server moves money through: a live run holds its cart on it, and a
  // person's decision on an escalated run is carried out on the same instance (the sandbox adapter
  // when its variables are set, otherwise one in-memory fake). Unset, live runs are off and the
  // decision route answers 503 with `paymentsUnavailable`.
  payments?: PaymentSetup;
  paymentsUnavailable?: string;
  // Live runs from the web app. `models` is null (or the field unset) when the server has no model
  // key: live runs are then off, and the page says so. `capUsd` is FIREWALL_LIVE_DAILY_USD.
  live?: { models: LiveModels | null; capUsd: number; now?: () => Date };
  // The folder of the eval's results files (`RESULTS_DIR`), served read-only. Unset, the server has
  // none to serve and `/eval/results` says so (an empty list, not available).
  resultsDir?: string;
  // The built web app's folder. Unset (or missing), the server is the API alone.
  webDir?: string;
}

const SHOP_STATUS: Record<ShopError["code"], ContentfulStatusCode> = {
  not_found: 404,
  invalid: 400,
  out_of_stock: 409,
  empty_cart: 409,
};

// The HTTP app without a listening socket, so tests can call it directly.
export function createApp({
  log,
  arena,
  payments,
  paymentsUnavailable,
  live,
  resultsDir,
  webDir,
}: AppDependencies) {
  const app = new Hono();

  // Polled by the Docker HEALTHCHECK and by the deploy workflow after a release.
  app.get("/health", (c) => c.json({ status: "ok", version }));
  app.route("/arena", arenaRoutes(arena));
  app.route(
    "/events",
    eventRoutes(log, {
      ...(payments && { payments }),
      ...(paymentsUnavailable && { paymentsUnavailable }),
    }),
  );

  // Built here, from the same `payments` the decision route gets, so a live run and a decision on
  // it can never be on two adapters.
  app.route(
    "/live",
    liveRoutes(
      createLiveService({
        log,
        arena,
        models: live?.models ?? null,
        payments: payments ?? null,
        // No setting is no live runs: a cap nobody chose is not one to spend against.
        capUsd: live?.capUsd ?? 0,
        ...(live?.now && { now: live.now }),
      }),
    ),
  );

  app.route("/eval", evalRoutes(resultsDir ?? null));

  if (webDir) app.notFound(webHandler(webDir));

  app.onError((error, c) => {
    if (error instanceof ShopError) {
      return c.json({ error: error.code, message: error.message }, SHOP_STATUS[error.code]);
    }
    if (error instanceof InvalidEventError) {
      return c.json({ error: "invalid_event", message: error.message }, 400);
    }
    console.error(error);
    return c.json({ error: "internal", message: "Something went wrong on the server" }, 500);
  });

  return app;
}
