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

// The ledger of model calls made outside any run: today, the dashboard assistant's (AG Studio's AI,
// `POST /studio/ai`). A run's calls carry their cost on their own events; these have no run to
// belong to, and putting them on the event log would make each one a run in every run list. A call
// is written twice, append-only like the log: a `reserve` row with the most it could cost before it
// is sent, and a `settle` row with what it did cost once it answered (or 0 when it failed). A day's
// spend is the settled costs plus every reservation never settled, so a crash mid-call still counts
// the call at its worst, and a restart can't lose what was spent.
export const modelSpend = sqliteTable(
  "model_spend",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    // Which feature spent it, so each one's cap counts only its own calls.
    purpose: text("purpose").notNull(),
    callId: text("call_id").notNull(),
    kind: text("kind").$type<"reserve" | "settle">().notNull(),
    ts: text("ts").notNull(),
    costUsd: real("cost_usd").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    // Set on a settle row when the call failed: what went wrong, in the API's words.
    error: text("error"),
  },
  (t) => [index("model_spend_purpose_ts").on(t.purpose, t.ts)],
);
