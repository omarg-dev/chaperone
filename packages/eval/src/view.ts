import { z } from "zod";

// What a reader of a results file takes from it: the shape `buildResults` writes (results.ts), read
// back and validated. The server serves these through `GET /eval/results`, and the dashboard draws
// them, so this file imports no Node module and nothing a browser couldn't bundle.
//
// It is the reader's view, not a copy of every field: a cell carries each gate's reasons and each
// bought line, which a headline page doesn't draw, and zod drops keys the schema doesn't name, so a
// file of 400 KB reaches the browser as a fraction of that. What it does name, it checks, so a file
// from another version, or one edited by hand, is refused with a reason instead of drawn wrong.
// `view.test.ts` parses what `buildResults` writes and the committed first matrix, so a field the
// writer renames fails there.
//
// The web app draws these types, so this file imports nothing but zod: not the firewall (its index
// pulls in every gate and the model SDKs) and not types.ts (which reaches them through its types).
// What it would have taken from them, the schema version, the firewall configurations and the
// verdicts, is written out below, and `view.test.ts` checks each against the original.

// The harness's `SCHEMA_VERSION`, `FIREWALL_CONFIGS`, the gates' `GATES` and their `VERDICTS`.
export const SCHEMA_VERSION_READ = 1;
export const CONFIGS_READ = ["off", "gate0", "full"] as const;
export const GATES_READ = ["gate0", "gate1", "gate2", "gate3"] as const;
export const VERDICTS_READ = ["approve", "escalate", "block"] as const;

const nullable = <T extends z.ZodType>(type: T) => type.nullable();

const column = z.object({ columnId: z.string(), label: z.string(), modelId: z.string() });

export const PAYMENT_ADAPTERS = ["fake", "sandbox"] as const;

const meta = z.object({
  // A file written by another version of the harness is refused, rather than half-read.
  schemaVersion: z.literal(SCHEMA_VERSION_READ),
  paymentAdapter: z.enum(PAYMENT_ADAPTERS),
  adapterNote: z.string(),
  column,
  gateModel: z.string(),
  scenarios: z.array(z.string()),
  seeds: z.array(z.string()),
  startedAt: z.string(),
  finishedAt: z.string(),
  date: z.string(),
  maxUsd: z.number(),
  spentUsd: z.number(),
  stoppedBySpendCap: z.boolean(),
  notStarted: z.array(z.object({ scenarioId: z.string(), seed: z.string(), column: z.string() })),
  moneyNote: z.string(),
});

const config = z.enum(CONFIGS_READ);
const money = z.enum(["captured", "voided", "held", "none"]);

const configMetrics = z.object({
  config,
  runs: z.number(),
  reviewFailed: z.number(),
  attackRuns: z.number(),
  attackFooled: z.number(),
  attackSuccesses: z.number(),
  attackSuccessRate: nullable(z.number()),
  benignRuns: z.number(),
  benignCorrectBlocks: z.number(),
  cleanCarts: z.number(),
  cleanBlocked: z.number(),
  falseBlockRate: nullable(z.number()),
  cleanEscalated: z.number(),
  falseEscalationRate: nullable(z.number()),
  escalated: z.number(),
  escalationRate: nullable(z.number()),
  verdicts: z.object({
    approve: z.number(),
    escalate: z.number(),
    block: z.number(),
    none: z.number(),
  }),
  money: z.object({ captured: z.number(), voided: z.number(), held: z.number(), none: z.number() }),
  gatesCostUsd: z.number(),
  gatesCostPerRunUsd: nullable(z.number()),
  latencyMs: z.object({
    mean: nullable(z.number()),
    p50: nullable(z.number()),
    p95: nullable(z.number()),
    max: nullable(z.number()),
  }),
});

const metrics = z.object({
  runs: z.object({
    cells: z.number(),
    errors: z.number(),
    noCheckout: z.number(),
    attack: z.number(),
    benign: z.number(),
  }),
  fooled: z.object({ count: z.number(), rate: nullable(z.number()) }),
  cost: z.object({ totalUsd: z.number() }),
  configs: z.array(configMetrics),
});

const gateName = z.enum(GATES_READ);

// How each gate spoke inside one setting's review: its verdict, what it cost and how long it took.
// Its reasons aren't kept, which are sentences the gate's code wrote for the run view to show.
const gate = z.object({
  gate: gateName,
  verdict: z.enum(VERDICTS_READ),
  costUsd: z.number(),
  latencyMs: z.number(),
});

const outcome = z.object({
  config,
  verdict: nullable(z.enum(VERDICTS_READ)),
  money,
  toAttackersCents: z.number(),
  // The gates that ran, in order, and the ones the tree didn't reach (and why: a block ends it).
  gates: z.array(gate),
  skipped: z.array(z.object({ gate: gateName, reason: z.string() })),
  costUsd: z.number(),
  latencyMs: z.number(),
  failed: nullable(z.string()),
});

const cell = z.object({
  input: z.object({ scenarioId: z.string(), seed: z.string(), column: z.string() }),
  run: z.object({
    scenarioId: z.string(),
    seed: z.string(),
    runId: nullable(z.string()),
    status: z.enum(["checked_out", "no_checkout", "error"]),
    kind: z.enum(["benign", "attack"]),
    // Attack and harm names are the arena's; a new attack shouldn't make old files unreadable.
    attack: nullable(
      z.object({ attackId: z.string(), variant: nullable(z.string()), harm: z.string() }),
    ),
    fooled: z.boolean(),
    clean: z.boolean(),
    cause: nullable(z.string()),
  }),
  outcomes: z.array(outcome),
  costUsd: z.number(),
});

export const resultsViewSchema = z.object({
  meta,
  metrics,
  cells: z.array(cell),
});

export type ResultsView = z.infer<typeof resultsViewSchema>;
export type ResultsMetaView = ResultsView["meta"];
export type ConfigMetricsView = ResultsView["metrics"]["configs"][number];
export type CellView = ResultsView["cells"][number];
export type OutcomeView = CellView["outcomes"][number];

export type ParsedResults = { ok: true; results: ResultsView } | { ok: false; error: string };

// Reads a results file's text. A file that isn't JSON, or isn't the shape above, says why in one
// sentence, naming the first thing wrong.
export function parseResults(text: string): ParsedResults {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file isn't valid JSON." };
  }
  const parsed = resultsViewSchema.safeParse(json);
  if (parsed.success) return { ok: true, results: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` (at ${issue.path.join(".")})` : "";
  return { ok: false, error: `The file isn't a results file this version reads${where}.` };
}

// One line of the list of results: what the dashboard's picker shows, and what every view of a
// result has to state (adapter, model column, gate model, seeds, date).
export interface ResultsSummary {
  // The file's name without `.json`, which is also what `GET /eval/results/:name` takes.
  name: string;
  paymentAdapter: ResultsMetaView["paymentAdapter"];
  column: ResultsMetaView["column"];
  gateModel: string;
  seeds: string[];
  // The scenarios the matrix ran, so a page can tell our own set from a held-out one.
  scenarios: string[];
  date: string;
  startedAt: string;
}

export const summarize = (name: string, meta: ResultsMetaView): ResultsSummary => ({
  name,
  paymentAdapter: meta.paymentAdapter,
  column: meta.column,
  gateModel: meta.gateModel,
  seeds: meta.seeds,
  scenarios: meta.scenarios,
  date: meta.date,
  startedAt: meta.startedAt,
});

// Newest first by when the matrix started, then by name so two files of one minute keep an order.
export const newestFirst = (a: ResultsSummary, b: ResultsSummary) =>
  b.startedAt.localeCompare(a.startedAt) || b.name.localeCompare(a.name);

// A name a results file can be asked for by. Letters, digits, dots, dashes and underscores, and not
// starting with a dot: no path separator, no `..`, so it can only ever name a file in the folder.
export const RESULTS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const isResultsName = (name: string) => RESULTS_NAME.test(name);
