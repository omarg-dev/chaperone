import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Lane, Provenance } from "./types.js";

// The append-only event log. Live view, history, replay and the dashboard all read from here.
// Updates and deletes are refused by triggers (see the custom migration in drizzle/).
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull().unique(),
    parentId: text("parent_id"),
    runId: text("run_id").notNull(),
    scenarioId: text("scenario_id"),
    ts: text("ts").notNull(),
    lane: text("lane").$type<Lane>().notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }),
    provenance: text("provenance").$type<Provenance>().notNull(),
    costUsd: real("cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
  },
  (t) => [index("events_run_seq").on(t.runId, t.seq)],
);
