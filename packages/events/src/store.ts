import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { and, asc, count, eq, gte, inArray, max, min, or, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { newEventId } from "./ids.js";
import { facetsOf, HOLD_OPERATIONS, NO_OUTCOME, type OutcomeEvent, outcomeOf } from "./outcome.js";
import { events, modelSpend } from "./schema.js";
import type { Event, NewEvent, NewSpendRow, RunSummary, SpendRow } from "./types.js";
import { validateNewEvent } from "./validate.js";

export interface EventLogOptions {
  // Path to the SQLite file. Created, and migrated to the latest schema, when opened.
  path: string;
  // Where the migrations live. The default is this package's drizzle/ folder; a bundled build,
  // where import.meta.url no longer points into the package, passes its own copy.
  migrationsFolder?: string;
  // Injected so seeded scenarios and tests get the same timestamps and IDs on every run.
  clock?: () => Date;
  newId?: (now: Date) => string;
}

export interface EventLog {
  append(input: NewEvent): Event;
  get(eventId: string): Event | undefined;
  // One run's events in the order they were appended, which is the order they replay in.
  listRun(runId: string): Event[];
  // Every run, most recent first.
  listRuns(): RunSummary[];
  // Called after each append. Returns a function that unsubscribes.
  subscribe(listener: (event: Event) => void): () => void;
  // The ledger of model calls that belong to no run (`model_spend`, see schema.ts): append a
  // reservation or a settlement, and read one purpose's rows from a time on, oldest first.
  appendSpend(input: NewSpendRow): SpendRow;
  listSpend(purpose: string, since: string): SpendRow[];
  close(): void;
}

export class InvalidEventError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid event: ${problems.join("; ")}`);
    this.name = "InvalidEventError";
  }
}

const defaultMigrations = fileURLToPath(new URL("../drizzle", import.meta.url));

export function openEventLog(options: EventLogOptions): EventLog {
  const sqlite = new Database(options.path);
  // Lets the live view read while a run is writing.
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: options.migrationsFolder ?? defaultMigrations });

  const clock = options.clock ?? (() => new Date());
  const newId = options.newId ?? newEventId;
  const listeners = new Set<(event: Event) => void>();

  const get = (eventId: string): Event | undefined =>
    db.select().from(events).where(eq(events.eventId, eventId)).get();

  return {
    append(input) {
      const problems = validateNewEvent(input);
      const parentId = input.parentId ?? null;
      // A parent from nowhere would break the causal chain the timeline draws, so it's refused.
      if (parentId !== null && !get(parentId)) {
        problems.push(`parentId "${parentId}" is not an event in the log`);
      }
      if (problems.length > 0) throw new InvalidEventError(problems);

      const now = clock();
      const event = db
        .insert(events)
        .values({
          eventId: newId(now),
          parentId,
          runId: input.runId,
          scenarioId: input.scenarioId ?? null,
          ts: now.toISOString(),
          lane: input.lane,
          type: input.type,
          payload: input.payload ?? null,
          provenance: input.provenance,
          costUsd: input.costUsd ?? 0,
          latencyMs: input.latencyMs ?? 0,
        })
        .returning()
        .get();

      for (const listener of listeners) {
        // One broken listener (a dropped websocket, say) mustn't stop the others or the run.
        try {
          listener(event);
        } catch (error) {
          console.error("Event listener failed", error);
        }
      }
      return event;
    },

    get,

    listRun(runId) {
      return db.select().from(events).where(eq(events.runId, runId)).orderBy(asc(events.seq)).all();
    },

    listRuns() {
      const runs = db
        .select({
          runId: events.runId,
          // A run's scenario is set on its events or not at all; max() picks it out of the nulls.
          scenarioId: max(events.scenarioId),
          startedAt: sql<string>`min(${events.ts})`,
          lastEventAt: sql<string>`max(${events.ts})`,
          eventCount: count(),
          costUsd: sql<number>`coalesce(${sum(events.costUsd)}, 0)`,
        })
        .from(events)
        .groupBy(events.runId)
        .orderBy(sql`${min(events.seq)} desc`)
        .all();

      // The events that say how a run ended and what it was reviewed under, for every run in one
      // read.
      const decisive = new Map<string, OutcomeEvent[]>();
      const rows = db
        .select({
          runId: events.runId,
          lane: events.lane,
          type: events.type,
          payload: events.payload,
        })
        .from(events)
        .where(
          or(
            // The calls that open and close the hold, which say whether an escalation is still held.
            and(
              eq(events.lane, "payments"),
              eq(events.type, "payment_call"),
              sql`json_extract(${events.payload}, '$.operation') in (${sql.join(
                HOLD_OPERATIONS.map((operation) => sql`${operation}`),
                sql`, `,
              )})`,
            ),
            and(
              inArray(events.lane, ["review", "human"]),
              inArray(events.type, [
                "review_started",
                "review_finished",
                "review_failed",
                "enforced",
                "human_decision",
              ]),
            ),
            and(eq(events.lane, "arena"), eq(events.type, "run_started")),
          ),
        )
        .orderBy(asc(events.seq))
        .all();
      for (const row of rows) {
        const list = decisive.get(row.runId);
        if (list) list.push(row);
        else decisive.set(row.runId, [row]);
      }

      return runs.map((run) => {
        const mine = decisive.get(run.runId) ?? [];
        return {
          ...run,
          ...(mine.length > 0 ? outcomeOf(mine) : NO_OUTCOME),
          ...facetsOf(mine),
        };
      });
    },

    appendSpend(input) {
      const row = db
        .insert(modelSpend)
        .values({
          purpose: input.purpose,
          callId: input.callId,
          kind: input.kind,
          ts: clock().toISOString(),
          costUsd: input.costUsd,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          latencyMs: input.latencyMs ?? 0,
          error: input.error ?? null,
        })
        .returning()
        .get();
      return row;
    },

    listSpend(purpose, since) {
      return db
        .select()
        .from(modelSpend)
        .where(and(eq(modelSpend.purpose, purpose), gte(modelSpend.ts, since)))
        .orderBy(asc(modelSpend.seq))
        .all();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      listeners.clear();
      sqlite.close();
    },
  };
}
