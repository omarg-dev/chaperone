// Records Gate 1's extractor on every fixture case, once, against the live model, and saves each
// case's calls under fixtures/ for the tests to replay.
//
//   pnpm --filter @firewall/firewall record-fixtures [case ...]
//
// Costs money: one Claude Haiku 5.5 call per listing page read (eight in all, well under a cent).
// Needs FIREWALL_ANTHROPIC_API_KEY. Re-run it only when the prompt, the schema or a case changes;
// the tests say when that has happened. It stops at the first call that fails, without retrying.

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicConfigFromEnv, createAnthropicClient, requestSha256 } from "@firewall/mandate";
import { createExtractor } from "../src/extractor.js";
import { extractionVocabulary } from "../src/facts.js";
import { FIXTURE_CASES, runCase } from "../src/fixture-cases.js";
import { runGate1 } from "../src/gate1.js";
import type { RecordedCall, RecordedCase } from "../src/recorded.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const wanted = process.argv.slice(2);
const config = anthropicConfigFromEnv();

let total = 0;
for (const c of FIXTURE_CASES.filter((c) => wanted.length === 0 || wanted.includes(c.name))) {
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

  const run = runCase(c);
  try {
    const extractor = createExtractor({
      client: createAnthropicClient(config, { fetch: recordingFetch, maxRetries: 0 }),
      vocabulary: extractionVocabulary(run.catalog),
    });
    const gate = await runGate1(run.runId, run.catalog, { log: run.log, extractor });
    if (failed) {
      console.error(`${c.name}: a call failed (${failed}). Stopping without retrying.`);
      process.exit(1);
    }
    const recording: RecordedCase = { case: c.name, recordedAt: new Date().toISOString(), calls };
    writeFileSync(join(FIXTURES, `${c.name}.json`), `${JSON.stringify(recording, null, 2)}\n`);
    total += gate.costUsd;
    console.log(
      `${c.name}: ${gate.result.verdict} (${calls.length} calls, ${gate.tokens.inputTokens} in, ` +
        `${gate.tokens.outputTokens} out, $${gate.costUsd.toFixed(6)}, ${gate.latencyMs} ms)`,
    );
    for (const reason of gate.result.reasons) console.log(`  ${reason}`);
    for (const review of gate.reviews) {
      if (review.extraction.status === "failed") {
        console.log(`  ${review.listingId} extraction failed: ${review.extraction.code}`);
      }
      if (review.facts.quotesDropped > 0) {
        console.log(`  ${review.listingId}: ${review.facts.quotesDropped} quotes dropped`);
      }
    }
  } finally {
    run.close();
  }
}
console.log(`\n$${total.toFixed(6)} in all`);
