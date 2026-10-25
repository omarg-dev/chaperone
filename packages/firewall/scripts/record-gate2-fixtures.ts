// Records Gate 1 and Gate 2 on every Gate 2 fixture case, once, against the live model, and saves
// each case's calls under fixtures/gate2/ for the tests to replay.
//
//   pnpm --filter @firewall/firewall record-gate2-fixtures [case ...]
//
// Costs money: one Claude Haiku 5.5 call per listing page Gate 1 reads, and one per case for
// Gate 2 (about a cent in all). Needs FIREWALL_ANTHROPIC_API_KEY. The market reference is Channel3
// when FIREWALL_CHANNEL3_API_KEY is set, and its calls are recorded alongside (they spend Channel3
// credits, one search per cart line); unset, the recording holds none and the cases replay with
// the market reference unavailable. Re-run it only when a prompt, a schema or a case changes; the
// tests say when that has happened. It stops at the first model call that fails, without retrying.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicConfigFromEnv, createAnthropicClient, requestSha256 } from "@firewall/mandate";
import { createIntentAuditor } from "../src/auditor.js";
import { createExtractor } from "../src/extractor.js";
import { extractionVocabulary } from "../src/facts.js";
import { runGate1 } from "../src/gate1.js";
import { runGate2 } from "../src/gate2.js";
import { GATE2_CASES, runGate2Case } from "../src/gate2-cases.js";
import { channel3ConfigFromEnv, createChannel3Market } from "../src/market.js";
import {
  marketRequestSha256,
  type RecordedCall,
  type RecordedGate2Case,
  type RecordedMarketCall,
} from "../src/recorded.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/gate2");
mkdirSync(FIXTURES, { recursive: true });
const wanted = process.argv.slice(2);
const config = anthropicConfigFromEnv();
const channel3 = channel3ConfigFromEnv();
console.log(
  channel3.apiKey
    ? "Market reference: Channel3, recorded alongside."
    : "Market reference: unavailable (FIREWALL_CHANNEL3_API_KEY isn't set).",
);

let total = 0;
for (const c of GATE2_CASES.filter((c) => wanted.length === 0 || wanted.includes(c.name))) {
  const calls: RecordedCall[] = [];
  const marketCalls: RecordedMarketCall[] = [];
  let failed: string | null = null;
  const recordingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const response = await fetch(url, init);
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (response.ok) {
      calls.push({ requestSha256: requestSha256(JSON.parse(String(init?.body))), response: body });
    } else {
      failed = `${response.status} ${JSON.stringify(body)}`;
    }
    return response;
  }) as typeof fetch;
  const marketFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const requestSha256 = marketRequestSha256(JSON.parse(String(init?.body)));
    try {
      const response = await fetch(url, init);
      const body = await response
        .clone()
        .json()
        .catch(() => null);
      marketCalls.push({ requestSha256, status: response.status, response: body });
      return response;
    } catch (error) {
      marketCalls.push({ requestSha256, error: String(error) });
      throw error;
    }
  }) as typeof fetch;

  const run = await runGate2Case(c);
  try {
    const client = createAnthropicClient(config, { fetch: recordingFetch, maxRetries: 0 });
    const extractor = createExtractor({ client, vocabulary: extractionVocabulary(run.catalog) });
    const gate1 = await runGate1(run.runId, run.catalog, { log: run.log, extractor });
    if (failed) {
      console.error(`${c.name}: a Gate 1 call failed (${failed}). Stopping without retrying.`);
      process.exit(1);
    }
    const gate2 = await runGate2(run.runId, run.catalog, {
      log: run.log,
      auditor: createIntentAuditor({ client }),
      market: createChannel3Market({ ...channel3, fetch: marketFetch }),
      gate1: { reviewerView: gate1.reviewerView, verdictEventId: gate1.verdictEventId },
    });
    if (failed || !gate2.audit) {
      console.error(
        `${c.name}: the Gate 2 call failed (${failed ?? gate2.result.reasons.join("; ")}). Stopping without retrying.`,
      );
      process.exit(1);
    }
    const recording: RecordedGate2Case = {
      case: c.name,
      recordedAt: new Date().toISOString(),
      calls,
      market: {
        source: "channel3",
        configured: channel3.apiKey !== null,
        calls: marketCalls,
      },
    };
    writeFileSync(join(FIXTURES, `${c.name}.json`), `${JSON.stringify(recording, null, 2)}\n`);
    const cost = gate1.costUsd + gate2.costUsd;
    total += cost;
    console.log(
      `${c.name}: Gate 1 ${gate1.result.verdict}, Gate 2 ${gate2.result.verdict} ` +
        `(${calls.length} calls, $${cost.toFixed(6)}; Gate 2 ${gate2.tokens?.inputTokens} in, ` +
        `${gate2.tokens?.outputTokens} out, $${gate2.costUsd.toFixed(6)}, ${gate2.audit.latencyMs} ms)`,
    );
    const j = gate2.audit.judgement;
    console.log(`  auditor: ${j.verdict} at ${j.confidence}: ${j.explanation}`);
    for (const f of j.findings) console.log(`    line ${f.line} ${f.code} ${f.evidence.join(" ")}`);
    for (const reason of gate2.result.reasons) console.log(`  ${reason}`);
  } finally {
    run.close();
  }
}
console.log(`\n$${total.toFixed(6)} in all`);
