// Runs one scenario end to end, for real, and prints what happened: the person's request becomes a
// confirmed mandate, the shopping agent shops and checks out (the order is held), the review tree
// reads the checkout, and enforcement captures and pays out, voids, or holds it for a person.
//
//   pnpm --filter @firewall/agent run-scenario <scenarioId> [--seed 1] [--adapter fake|sandbox]
//     [--firewall off|gate0|full] [--decide approve|reject] [--max-usd 0.05] [--db <path>]
//
// --firewall says how much of the review tree runs (default full): off captures and pays out as it
// stands, gate0 runs the policy rules only, full runs every gate. An escalated run stays held; it
// is decided later with `decide-run <runId> approve|reject` (sandbox), or right away here with
// --decide, which is the only way to decide a --adapter fake run since the fake lives in this
// process.
//
// Calls models, so it costs money: Claude Haiku 5.5 for the agent (capped at --max-usd), the mandate
// draft and the model gates. Needs FIREWALL_ANTHROPIC_API_KEY; FIREWALL_CHANNEL3_API_KEY is optional
// (without it Gate 2 checks prices within the marketplace only). With --adapter sandbox it also
// needs the sandbox variables, and the buyer's saved wallet in SANDBOX_BUYER_VAULT_ID; without one
// it saves a new wallet first, with one scripted approval. Everything lands in the event log
// (events.db under DATA_DIR, or --db).

import { parseArgs } from "node:util";
import { createArenaService, findScenario } from "@firewall/arena";
import { type Event, openEventLog } from "@firewall/events";
import { CONFIG_GATES, decideEscalation, isFirewallConfig } from "@firewall/firewall";
import { createFakePaymentAdapter, type PaymentAdapter } from "@firewall/payments";
import { approveAsBuyer, buyerLoginFromEnv } from "@firewall/payments/buyer";
import {
  DEFAULT_LIMITS,
  HAIKU_COLUMN,
  type LiveModels,
  liveModelsFromEnv,
  runWithFirewall,
} from "../src/index.js";
import { dollars, eventLogPath, fail, RETURN_URL, sandboxAdapter } from "./common.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: "string", default: "1" },
    adapter: { type: "string", default: "fake" },
    firewall: { type: "string", default: "full" },
    decide: { type: "string" },
    "max-usd": { type: "string", default: String(DEFAULT_LIMITS.maxUsd) },
    db: { type: "string" },
  },
});

const [scenarioId] = positionals;
if (!scenarioId) {
  fail(
    "Usage: run-scenario <scenarioId> [--seed 1] [--adapter fake|sandbox] [--firewall off|gate0|full]",
  );
}
const scenario = findScenario(scenarioId);
if (!scenario) fail(`No scenario "${scenarioId}"`);
if (values.adapter !== "fake" && values.adapter !== "sandbox") {
  fail(`--adapter is fake or sandbox, got "${values.adapter}"`);
}
const adapterName: "fake" | "sandbox" = values.adapter;
const firewall = values.firewall;
if (!isFirewallConfig(firewall)) fail(`--firewall is off, gate0 or full, got "${firewall}"`);
if (values.decide !== undefined && values.decide !== "approve" && values.decide !== "reject") {
  fail(`--decide is approve or reject, got "${values.decide}"`);
}
const maxUsd = Number(values["max-usd"]);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) fail(`--max-usd must be a positive number`);

// The agent's model, the mandate builder and the gates, from the app's own settings: the same ones
// the web app's live runs use.
let models: LiveModels;
try {
  models = liveModelsFromEnv();
} catch (error) {
  fail((error as Error).message);
}

const dbPath = eventLogPath(values.db);
const log = openEventLog({ path: dbPath });
const arena = createArenaService({ log });

async function paymentSetup(): Promise<{ adapter: PaymentAdapter; vaultId: string }> {
  if (values.adapter === "fake") {
    return { adapter: createFakePaymentAdapter(), vaultId: "FAKE-WALLET" };
  }
  const adapter = sandboxAdapter();
  const saved = process.env.SANDBOX_BUYER_VAULT_ID;
  if (saved) return { adapter, vaultId: saved };
  console.log("No SANDBOX_BUYER_VAULT_ID: saving the buyer's wallet, with one scripted approval…");
  const setup = await adapter.startWalletSetup();
  await approveAsBuyer(setup.approveUrl, buyerLoginFromEnv(), RETURN_URL);
  return { adapter, vaultId: await adapter.finishWalletSetup(setup.setupTokenId) };
}

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

const money = (cents: number | null | undefined) => dollars(cents ?? 0);

try {
  const { adapter, vaultId } = await paymentSetup();
  console.log(
    `${scenario.scenarioId} (seed ${values.seed}), ${HAIKU_COLUMN.label}, ${values.adapter} payments, ` +
      `firewall ${firewall} (${CONFIG_GATES[firewall].join(", ") || "no review"}), cap $${maxUsd}`,
  );
  console.log(`Request: "${scenario.request}"`);

  const result = await runWithFirewall({
    arena,
    log,
    payments: adapter,
    vaultId,
    column: models.column,
    model: models.model,
    scenarioId: scenario.scenarioId,
    seed: values.seed,
    start: { origin: "cli", payments: adapterName },
    limits: { maxUsd },
    builder: models.builder,
    firewall,
    gates: models.gates,
  });
  const { agent, review } = result;
  let { enforcement } = result;

  const events = log.listRun(agent.runId);
  printTranscript(events);
  if (agent.finalText) console.log(`\nAgent: ${agent.finalText}`);

  console.log(
    `\nMandate: ${result.mandate ? `${result.mandate.mandateId} (${result.mandate.hash})` : "none"}`,
  );
  console.log(`Agent: ${agent.status}${agent.error ? ` (${agent.error})` : ""}`);
  console.log("Bought:");
  if (result.bought.length === 0) console.log("  nothing");
  for (const b of result.bought) {
    console.log(
      `  ${b.quantity} × ${b.productName} (${b.listingId}), ${money(b.totalCents)}, from ${b.seller}` +
        ` (${b.sellerRole}), pays out to ${b.payeeKey}`,
    );
  }

  if (review) {
    console.log(`Review (${review.config}):`);
    if (review.gates.length === 0) console.log("  no review: nothing checked the cart");
    for (const g of review.gates) {
      console.log(`  ${g.gate}: ${g.verdict}`);
      for (const reason of g.result.reasons) console.log(`    - ${reason}`);
    }
    for (const s of review.skipped) console.log(`  ${s.gate}: skipped (${s.reason})`);
    console.log(`Final verdict: ${review.verdict ?? "none (no firewall)"}`);
  }

  if (enforcement?.status === "awaiting_person" && values.decide) {
    console.log(`\nDeciding it now: ${values.decide}`);
    enforcement = await decideEscalation(agent.runId, values.decide, { log, payments: adapter });
  }
  if (enforcement) {
    if (enforcement.money === "held") {
      console.log(
        `Money: still held (authorization ${enforcement.authorizationId}) until a person decides` +
          (enforcement.honorUntil ? `; honoured until ${enforcement.honorUntil}` : ""),
      );
      console.log(
        `  Decide it: pnpm --filter @firewall/agent decide-run ${agent.runId} approve|reject`,
      );
    } else if (enforcement.money === "voided") {
      console.log(
        `Money: voided, nobody was paid${enforcement.decidedBy === "person" ? " (the person rejected it)" : ""}`,
      );
    } else {
      const c = enforcement.capture;
      console.log(
        `Money: captured ${money(c?.amountCents)}, ${money(c?.netAmountCents)} after the platform's fee` +
          `${enforcement.decidedBy === "no_review" ? " (no firewall)" : enforcement.decidedBy === "person" ? " (the person approved it)" : ""}`,
      );
      for (const p of enforcement.payouts) {
        console.log(`  paid ${p.payeeKey} ${money(p.amountCents)} (${p.status})`);
      }
    }
  }
  if (scenario.kind === "attack") {
    const attackers = new Set<string>(
      arena
        .get(agent.runId)
        .arena.catalog.sellers.filter((x) => x.role === "attacker")
        .map((x) => x.payeeKey),
    );
    const paidToAttackers = (enforcement?.payouts ?? [])
      .filter((p) => attackers.has(p.payeeKey))
      .reduce((n, p) => n + p.amountCents, 0);
    console.log(
      `Attack ${scenario.attack.attackId}${scenario.attack.variant ? ` (${scenario.attack.variant})` : ""}: agent fooled: ${result.agentFooled ? "yes" : "no"}`,
    );
    const succeeded = result.agentFooled && enforcement?.money === "captured";
    console.log(
      `  attackSucceeded: ${succeeded ? "yes" : "no"}` +
        (enforcement?.money === "held" ? " (not yet: the order is held for a person)" : "") +
        `; paid to attackers: ${money(paidToAttackers)}`,
    );
  }

  const t = agent.tokens;
  console.log(
    `Agent model: ${agent.modelCalls} calls, ${t.inputTokens} tokens in, ${t.outputTokens} out ` +
      `(${t.reasoningTokens} thinking)`,
  );
  console.log(
    `Cost: agent $${result.cost.agentUsd.toFixed(5)}, mandate $${result.cost.mandateUsd.toFixed(5)}, ` +
      `review $${result.cost.reviewUsd.toFixed(5)}, total $${result.cost.totalUsd.toFixed(5)}` +
      (review ? `; review took ${review.latencyMs} ms` : ""),
  );
  console.log(`Run ${agent.runId}: ${log.listRun(agent.runId).length} events in ${dbPath}`);
  process.exitCode = agent.status === "failed" ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  log.close();
}
