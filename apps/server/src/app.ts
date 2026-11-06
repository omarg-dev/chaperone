import { type ArenaService, ShopError } from "@firewall/arena";
import { type EventLog, InvalidEventError } from "@firewall/events";
import type { PaymentAdapter } from "@firewall/payments";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { arenaRoutes } from "./routes/arena.js";
import { evalRoutes } from "./routes/eval.js";
import { eventRoutes } from "./routes/events.js";
import { version } from "./version.js";
import { webHandler } from "./web.js";

export interface AppDependencies {
  log: EventLog;
  arena: ArenaService;
  // What a person's decision on an escalated run is carried out through (the sandbox adapter in
  // production). Unset, the decision route answers 503 with `paymentsUnavailable`.
  payments?: PaymentAdapter;
  paymentsUnavailable?: string;
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
