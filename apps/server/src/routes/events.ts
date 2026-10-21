import type { EventLog } from "@firewall/events";
import { Hono } from "hono";

// Read-only access to the event log: the run list, and one run's events in replay order.
export function eventRoutes(log: EventLog) {
  return new Hono()
    .get("/runs", (c) => c.json(log.listRuns()))
    .get("/runs/:runId", (c) => c.json(log.listRun(c.req.param("runId"))));
}
