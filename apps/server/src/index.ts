import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { version } from "./version.js";

const { port } = readConfig(process.env);

const server = serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`Server ${version} listening on http://localhost:${info.port}`);
});

// `docker compose up -d` stops the old container with SIGTERM; close cleanly instead of being killed.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
