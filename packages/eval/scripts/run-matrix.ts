// Runs the eval matrix locally and writes a results file.
//
//   pnpm --filter @firewall/eval run-matrix --scenarios <ids|all|attacks|benign> --seeds 1,2
//     --column haiku [--adapter fake|sandbox] [--max-usd 0.5] [--concurrency 3] [--dry-run]
//     [--out <dir>] [--agent-max-usd 0.05]
//
// One cell is one scenario, one seed and one agent column. The agent runs once per cell, and the
// firewall off, Gate 0 only and the full tree each review that same recorded checkout. Every run's
// events go into one event log file next to the results (`<name>.events.db`), and the results are
// `<name>.json` (every cell, every configuration) and `<name>.md` (a short summary), under the
// repo's `results/` folder. Both files state the payment adapter, the model column, the gate model,
// the seeds and the date.
//
// Calls models, so it costs money: --dry-run prints the cell count and expected cost and spends
// nothing; --max-usd (default $0.50) stops the matrix starting new cells once it is spent. Needs
// FIREWALL_ANTHROPIC_API_KEY (the gates run on it in every column), and the column's own key for
// --column openai (FIREWALL_OPENAI_API_KEY) or gemini (FIREWALL_GEMINI_API_KEY); FIREWALL_CHANNEL3_API_KEY is optional. --adapter sandbox also needs the
// sandbox variables (see run-scenario in @firewall/agent).

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  AGENT_COLUMNS,
  type AgentColumn,
  columnConfigFromEnv,
  createColumnModel,
  DEFAULT_LIMITS,
  resolveColumn,
} from "@firewall/agent";
import { createArenaService } from "@firewall/arena";
import { openEventLog } from "@firewall/events";
import {
  AUDITOR_MODEL,
  channel3ConfigFromEnv,
  createChannel3Market,
  createExtractor,
  createIntentAuditor,
  createTraceAuditor,
  EXTRACTOR_MODEL,
  extractionVocabulary,
} from "@firewall/firewall";
import {
  arenaVocabulary,
  createAnthropicClient,
  createMandateBuilder,
  anthropicConfigFromEnv as gateConfigFromEnv,
} from "@firewall/mandate";
import {
  createFakePaymentAdapter,
  createSandboxPaymentAdapter,
  type PaymentAdapter,
  sandboxConfigFromEnv,
} from "@firewall/payments";
import { approveAsBuyer, buyerLoginFromEnv } from "@firewall/payments/buyer";
import {
  buildResults,
  type CellContext,
  estimateMatrix,
  type PaymentAdapterName,
  parseSeeds,
  planMatrix,
  renderMarkdown,
  resultsName,
  runAndEvaluateCell,
  runMatrix,
  selectScenarios,
  writeResults,
} from "../src/index.js";

const RETURN_URL = "https://checkout-firewall.invalid/payments/approved";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    scenarios: { type: "string" },
    seeds: { type: "string", default: "1" },
    column: { type: "string", default: "haiku" },
    adapter: { type: "string", default: "fake" },
    "max-usd": { type: "string", default: "0.5" },
    "agent-max-usd": { type: "string", default: String(DEFAULT_LIMITS.maxUsd) },
    concurrency: { type: "string", default: "3" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.scenarios) {
  fail(
    "Usage: run-matrix --scenarios <ids|all|attacks|benign> [--seeds 1,2] [--column haiku|openai|gemini] " +
      "[--adapter fake|sandbox] [--max-usd 0.5] [--concurrency 3] [--dry-run]",
  );
}
if (values.adapter !== "fake" && values.adapter !== "sandbox") {
  fail(`--adapter is fake or sandbox, got "${values.adapter}"`);
}
const adapterName: PaymentAdapterName = values.adapter;

// A column by its short name (haiku, openai, gemini) or its ID.
const column: AgentColumn | undefined = resolveColumn(values.column ?? "");
if (!column) {
  fail(
    `No agent column "${values.column}". Columns: ${AGENT_COLUMNS.map((c) => `${c.shortName} (${c.columnId})`).join(", ")}`,
  );
}
const positive = (name: string, text: string | undefined): number => {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number`);
  return n;
};
const maxUsd = positive("max-usd", values["max-usd"]);
const agentMaxUsd = positive("agent-max-usd", values["agent-max-usd"]);
const concurrency = Math.floor(positive("concurrency", values.concurrency));

let scenarios: ReturnType<typeof selectScenarios>;
let seeds: string[];
try {
  scenarios = selectScenarios(values.scenarios);
  seeds = parseSeeds(values.seeds);
} catch (error) {
  fail((error as Error).message);
}
const cells = planMatrix(scenarios, seeds, column.columnId);
const estimate = estimateMatrix(cells, column);

console.log(
  `${estimate.cells} cells (${scenarios.length} scenarios x ${seeds.length} seeds), ${column.label}, ` +
    `${adapterName} payments, gates on ${EXTRACTOR_MODEL}`,
);
console.log(
  `Expected cost about $${estimate.expectedUsd.toFixed(4)} ($${estimate.perCellUsd.toFixed(4)} a cell); ` +
    `cap $${maxUsd}, per-run agent cap $${agentMaxUsd}`,
);
if (estimate.expectedUsd > maxUsd) {
  console.log(
    `The cap is below the expected cost: the matrix will stop early, after about ${Math.floor(maxUsd / estimate.perCellUsd)} cells.`,
  );
}
if (values["dry-run"]) {
  console.log("Dry run: nothing was spent.");
  process.exit(0);
}
if (AUDITOR_MODEL !== EXTRACTOR_MODEL) fail("The gates must run on one model");

let agentConfig: ReturnType<typeof columnConfigFromEnv>;
let gatesConfig: ReturnType<typeof gateConfigFromEnv>;
try {
  // The column's own key (the OpenAI and Gemini columns refuse to run without theirs, naming the
  // variable) and, always, the Anthropic key the gates run on.
  agentConfig = columnConfigFromEnv(column);
  gatesConfig = gateConfigFromEnv();
} catch (error) {
  fail((error as Error).message);
}

const startedAt = new Date();
const name = resultsName(startedAt, adapterName, column.columnId);
const dataDir = values.out ?? "results";
const outDir = isAbsolute(dataDir) ? dataDir : join(REPO_ROOT, dataDir);
mkdirSync(outDir, { recursive: true });
const eventLogPath = join(outDir, `${name}.events.db`);
const log = openEventLog({ path: eventLogPath });
const arena = createArenaService({ log });
const client = createAnthropicClient(gatesConfig);
const builder = createMandateBuilder({ client, vocabulary: arenaVocabulary() });
const model = createColumnModel(column, agentConfig);

// The fake is made fresh for every cell, so cells share nothing. The sandbox adapter is one client.
async function paymentSetup(): Promise<() => { payments: PaymentAdapter; vaultId: string }> {
  if (adapterName === "fake") {
    return () => ({ payments: createFakePaymentAdapter(), vaultId: "FAKE-WALLET" });
  }
  const adapter = createSandboxPaymentAdapter({ ...sandboxConfigFromEnv(), returnUrl: RETURN_URL });
  let vaultId = process.env.SANDBOX_BUYER_VAULT_ID;
  if (!vaultId) {
    console.log(
      "No SANDBOX_BUYER_VAULT_ID: saving the buyer's wallet, with one scripted approval…",
    );
    const setup = await adapter.startWalletSetup();
    await approveAsBuyer(setup.approveUrl, buyerLoginFromEnv(), RETURN_URL);
    vaultId = await adapter.finishWalletSetup(setup.setupTokenId);
  }
  const saved = vaultId;
  return () => ({ payments: adapter, vaultId: saved });
}

try {
  const payment = await paymentSetup();
  const context = (): CellContext => ({
    arena,
    log,
    ...payment(),
    builder,
    modelFor: () => model,
    limits: { maxUsd: agentMaxUsd },
    gates: (catalog) => ({
      extractor: createExtractor({ client, vocabulary: extractionVocabulary(catalog) }),
      auditor: createIntentAuditor({ client }),
      traceAuditor: createTraceAuditor({ client }),
      market: createChannel3Market(channel3ConfigFromEnv()),
    }),
  });

  const matrix = await runMatrix(cells, (input) => runAndEvaluateCell(input, context()), {
    concurrency,
    maxUsd,
    estimateUsd: estimate.perCellUsd,
    onCell: (result, progress) => {
      const full = result.outcomes.find((o) => o.config === "full");
      console.log(
        `[${progress.done}/${progress.total}] ${result.input.scenarioId} seed ${result.input.seed}: ` +
          `${result.run.status}${result.run.fooled ? ", agent fooled" : ""}` +
          `${full ? `, full: ${full.verdict ?? "none"}` : ""}, $${result.costUsd.toFixed(4)} ` +
          `(total $${progress.spentUsd.toFixed(4)})`,
      );
    },
  });

  const results = buildResults({
    paymentAdapter: adapterName,
    column: { columnId: column.columnId, label: column.label, modelId: column.modelId },
    gateModel: EXTRACTOR_MODEL,
    scenarios: scenarios.map((s) => s.scenarioId),
    seeds,
    startedAt,
    finishedAt: new Date(),
    eventLog: `${name}.events.db`,
    concurrency,
    maxUsd,
    matrix,
  });
  const written = writeResults(outDir, name, results);
  console.log(`\n${renderMarkdown(results)}`);
  if (matrix.stoppedBySpendCap) {
    console.log(
      `Stopped at the $${maxUsd} cap: ${matrix.notStarted.length} cells were not started.`,
    );
  }
  console.log(
    `Results: ${written.jsonPath}\n         ${written.markdownPath}\nEvents:  ${eventLogPath}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  log.close();
}
