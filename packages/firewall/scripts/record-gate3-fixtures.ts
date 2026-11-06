// Records Gate 3 on every Gate 3 fixture case, once, against the live model, and saves each case's
// calls under fixtures/gate3/ for the tests to replay.
//
//   pnpm --filter @firewall/firewall record-gate3-fixtures [case ...]
//
// Costs money: one Claude Haiku 5.5 call per case for Gate 3, and one per listing page Gate 1
// reads for the cases whose Gate 1 answers aren't in another recording (about a tenth of a cent
// each). Gate 1 of the other cases is replayed from Gate 2's or Gate 1's recordings, so Gate 3 is
// asked about exactly the facts those recordings hold. Needs FIREWALL_ANTHROPIC_API_KEY, and
// FIREWALL_ANTHROPIC_BASE_URL if the default isn't the endpoint to use; the environment's own
// ANTHROPIC_* variables are never read. Re-run it only when a prompt, a schema or a case changes;
// the tests say when that has happened. It stops at the first model call that fails, without
// retrying.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicConfigFromEnv, createAnthropicClient, requestSha256 } from "@firewall/mandate";
import { createExtractor } from "../src/extractor.js";
import { extractionVocabulary } from "../src/facts.js";
import { runGate1 } from "../src/gate1.js";
import { runGate3 } from "../src/gate3.js";
import { GATE3_CASES, runGate3Case } from "../src/gate3-cases.js";
import { type RecordedCall, type RecordedCase, replayByRequest } from "../src/recorded.js";
import { gate3Calls } from "../src/test-helpers.js";
import { createTraceAuditor } from "../src/trace-auditor.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/gate3");
mkdirSync(FIXTURES, { recursive: true });
const wanted = process.argv.slice(2);
const config = anthropicConfigFromEnv();

let total = 0;
for (const c of GATE3_CASES.filter((c) => wanted.length === 0 || wanted.includes(c.name))) {
  const calls: RecordedCall[] = [];
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

  const run = await runGate3Case(c);
  try {
    const live = createAnthropicClient(config, { fetch: recordingFetch, maxRetries: 0 });
    // Gate 1 from the recording that holds it, or live when this case's own recording must.
    const gate1Client = c.gate1From
      ? createAnthropicClient(config, {
          fetch: replayByRequest(gate3Calls(c, false)).fetch,
          maxRetries: 0,
        })
      : live;
    const extractor = createExtractor({
      client: gate1Client,
      vocabulary: extractionVocabulary(run.catalog),
    });
    const gate1 = await runGate1(run.runId, run.catalog, { log: run.log, extractor });
    if (failed) {
      console.error(`${c.name}: a Gate 1 call failed (${failed}). Stopping without retrying.`);
      process.exit(1);
    }
    const gate3 = await runGate3(run.runId, run.catalog, {
      log: run.log,
      auditor: createTraceAuditor({ client: live }),
      gate1: { reviewerView: gate1.reviewerView, verdictEventId: gate1.verdictEventId },
    });
    if (failed || !gate3.audit) {
      console.error(
        `${c.name}: the Gate 3 call failed (${failed ?? gate3.result.reasons.join("; ")}). Stopping without retrying.`,
      );
      process.exit(1);
    }
    const recording: RecordedCase = { case: c.name, recordedAt: new Date().toISOString(), calls };
    writeFileSync(join(FIXTURES, `${c.name}.json`), `${JSON.stringify(recording, null, 2)}\n`);
    const cost = (c.gate1From ? 0 : gate1.costUsd) + gate3.costUsd;
    total += cost;
    console.log(
      `${c.name}: Gate 1 ${gate1.result.verdict}, Gate 3 ${gate3.result.verdict} ` +
        `(${calls.length} calls, $${cost.toFixed(6)}; Gate 3 ${gate3.tokens?.inputTokens} in, ` +
        `${gate3.tokens?.outputTokens} out, $${gate3.costUsd.toFixed(6)}, ${gate3.audit.latencyMs} ms)`,
    );
    const j = gate3.audit.judgement;
    console.log(`  auditor: ${j.verdict} at ${j.confidence}: ${j.explanation}`);
    for (const f of j.findings) console.log(`    line ${f.line} ${f.code} ${f.evidence.join(" ")}`);
    for (const reason of gate3.result.reasons) console.log(`  ${reason}`);
  } finally {
    run.close();
  }
}
console.log(`\n$${total.toFixed(6)} in all`);
