import { Hono } from "hono";
import { version } from "./version.js";

// The HTTP app without a listening socket, so tests can call it directly.
export function createApp() {
  const app = new Hono();

  // Polled by the Docker HEALTHCHECK and by the deploy workflow after a release.
  app.get("/health", (c) => c.json({ status: "ok", version }));

  return app;
}
