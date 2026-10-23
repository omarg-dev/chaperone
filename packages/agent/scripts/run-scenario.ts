// Runs the shopping agent on one scenario, for real, and prints what it did.
//
//   pnpm --filter @firewall/agent run-scenario <scenarioId> [--seed 1] [--adapter fake|sandbox]
//     [--max-usd 0.05] [--db <path>]
//
// Calls the model, so it costs money: Claude Haiku 5.5, capped at --max-usd per run. Needs
// FIREWALL_ANTHROPIC_API_KEY. With --adapter sandbox it also needs the sandbox variables, and the
// buyer's saved wallet in SANDBOX_BUYER_VAULT_ID; without one it saves a new wallet first, with one
// scripted approval. The order is held, never captured: approving or voiding it is the review
// tree's job. Everything lands in the event log (events.db under DATA_DIR, or --db).

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createArenaService, findScenario } from "@firewall/arena";
import { type Event, openEventLog } from "@firewall/events";
import {
  createFakePaymentAdapter,
  createSandboxPaymentAdapter,
  type PaymentAdapter,
  recordPayments,
  sandboxConfigFromEnv,
} from "@firewall/payments";
import { approveAsBuyer, buyerLoginFromEnv } from "@firewall/payments/buyer";
import {
  anthropicConfigFromEnv,
  createColumnModel,
  DEFAULT_LIMITS,
  HAIKU_COLUMN,
  runAgent,
} from "../src/index.js";

const RETURN_URL = "https://checkout-firewall.invalid/payments/approved";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: "string", default: "1" },
    adapter: { type: "string", default: "fake" },
    "max-usd": { type: "string", default: String(DEFAULT_LIMITS.maxUsd) },
    db: { type: "string" },
  },
});

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

const [scenarioId] = positionals;
if (!scenarioId) fail("Usage: run-scenario <scenarioId> [--seed 1] [--adapter fake|sandbox]");
const scenario = findScenario(scenarioId);
if (!scenario) fail(`No scenario "${scenarioId}"`);
if (values.adapter !== "fake" && values.adapter !== "sandbox") {
  fail(`--adapter is fake or sandbox, got "${values.adapter}"`);
}
const maxUsd = Number(values["max-usd"]);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) fail(`--max-usd must be a positive number`);

let anthropic: ReturnType<typeof anthropicConfigFromEnv>;
try {
  anthropic = anthropicConfigFromEnv();
} catch (error) {
  fail((error as Error).message);
}

// Relative paths are taken from the repo root, so the log is the same file wherever pnpm runs.
const dataDir = process.env.DATA_DIR || "data";
const dbPath =
  values.db ?? join(isAbsolute(dataDir) ? dataDir : join(REPO_ROOT, dataDir), "events.db");
mkdirSync(dirname(dbPath), { recursive: true });
const log = openEventLog({ path: dbPath });
const arena = createArenaService({ log });

async function paymentSetup(): Promise<{ adapter: PaymentAdapter; vaultId: string }> {
  if (values.adapter === "fake") {
    return { adapter: createFakePaymentAdapter(), vaultId: "FAKE-WALLET" };
  }
  const adapter = createSandboxPaymentAdapter({ ...sandboxConfigFromEnv(), returnUrl: RETURN_URL });
  const saved = process.env.SANDBOX_BUYER_VAULT_ID;
  if (saved) return { adapter, vaultId: saved };
  console.log("No SANDBOX_BUYER_VAULT_ID: saving the buyer's wallet, with one scripted approval…");
  const setup = await adapter.startWalletSetup();
  await approveAsBuyer(setup.approveUrl, buyerLoginFromEnv(), RETURN_URL);
  return { adapter, vaultId: await adapter.finishWalletSetup(setup.setupTokenId) };
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const short = (value: unknown, max = 110) => {
  const text = JSON.stringify(value) ?? "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function summarize(output: unknown): string {
  const o = output as Record<string, unknown>;
  if (o && typeof o === "object") {
    if ("error" in o) return `refused: ${o.error}`;
    if (Array.isArray(o.results)) return `${o.results.length} results`;
    if (Array.isArray(o.reviews)) return `${o.reviews.length} reviews`;
    if (o.status === "pending_review") return `${o.message} (${dollars(o.totalCents as number)})`;
    if (Array.isArray(o.lines)) return `cart: ${short(o.lines, 90)}`;
    if (o.catalog) return `listing page: ${short((o.page as { title?: string })?.title, 80)}`;
  }
  return short(output);
}

function printTranscript(events: Event[]) {
  let step = 0;
  for (const event of events) {
    if (event.lane !== "agent") continue;
    const p = event.payload as Record<string, unknown>;
    if (event.type === "model_turn") {
      step += 1;
      const tokens = p.tokens as { inputTokens: number; outputTokens: number };
      console.log(
        `\n${step}. ${p.text || "(no text)"}  [${tokens.inputTokens} in, ${tokens.outputTokens} out]`,
      );
    } else if (event.type === "tool_call") {
      console.log(`   → ${p.toolName} ${short(p.input, 90)}`);
    } else if (event.type === "tool_result") {
      console.log(`     ← ${summarize(p.output)}`);
    } else if (event.type === "model_call_failed") {
      console.log(`\n   ✗ model call failed: ${p.error}`);
    }
  }
}

try {
  const { adapter, vaultId } = await paymentSetup();
  console.log(
    `${scenario.scenarioId} (seed ${values.seed}), ${HAIKU_COLUMN.label}, ${values.adapter} payments, cap $${maxUsd}`,
  );
  console.log(`Request: "${scenario.request}"`);

  const outcome = await runAgent({
    arena,
    log,
    payments: adapter,
    vaultId,
    column: HAIKU_COLUMN,
    model: createColumnModel(HAIKU_COLUMN, anthropic),
    scenarioId: scenario.scenarioId,
    seed: values.seed,
    limits: { maxUsd },
  });

  const events = log.listRun(outcome.runId);
  printTranscript(events);
  if (outcome.finalText) console.log(`\nAgent: ${outcome.finalText}`);

  console.log(`\nOutcome: ${outcome.status}${outcome.error ? ` (${outcome.error})` : ""}`);
  if (outcome.order) {
    // Read the hold back from the platform, on the payments lane like every other payment call.
    const finished = events.findLast((e) => e.type === "run_finished");
    const payments = recordPayments(adapter, log, () => ({
      runId: outcome.runId,
      scenarioId: outcome.scenarioId,
      parentId: finished?.eventId ?? null,
    }));
    const hold = await payments.getAuthorization(outcome.order.authorizationId);
    const draft = arena.get(outcome.runId).order;
    console.log(
      `Order ${outcome.order.orderId}: hold ${hold.authorizationId} is ${hold.status} for ${dollars(hold.amountCents)}`,
    );
    for (const line of draft?.lines ?? []) {
      console.log(
        `  ${line.quantity} × ${line.title} (${line.listingId}), ${dollars(line.totalCents)}, pays out to ${line.payeeKey}`,
      );
    }
  }
  const t = outcome.tokens;
  console.log(
    `Model: ${outcome.modelCalls} calls, ${t.inputTokens} tokens in, ${t.outputTokens} out ` +
      `(${t.reasoningTokens} thinking), $${outcome.costUsd.toFixed(5)}`,
  );
  console.log(`Run ${outcome.runId}: ${log.listRun(outcome.runId).length} events in ${dbPath}`);
  process.exitCode = outcome.status === "failed" ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  log.close();
}
