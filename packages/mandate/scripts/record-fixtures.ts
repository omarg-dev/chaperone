// Records the builder's answer to every scenario's request (the attack scenarios' requests are the person's own, honest ones), once, against the live model,
// and saves each response under fixtures/requests/ for the tests to replay.
//
//   pnpm --filter @firewall/mandate record-fixtures
//
// Costs money: one Claude Haiku 5.5 call per benign scenario (a fraction of a cent in all). Needs
// FIREWALL_ANTHROPIC_API_KEY. Re-run it only when the prompt, the schema or the scenarios change;
// the tests say when that has happened. It stops at the first call that fails, without retrying.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "@firewall/arena";
import {
  anthropicConfigFromEnv,
  arenaVocabulary,
  compareWithIntent,
  createAnthropicClient,
  createMandateBuilder,
  dollars,
  MandateBuildError,
} from "../src/index.js";
import { type RecordedResponse, requestSha256 } from "../src/recorded.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/requests");

let lastBody: unknown = null;
const recordingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const response = await fetch(url, init);
  lastBody = await response
    .clone()
    .json()
    .catch(() => null);
  return response;
}) as typeof fetch;

const vocabulary = arenaVocabulary();
const builder = createMandateBuilder({
  client: createAnthropicClient(anthropicConfigFromEnv(), { fetch: recordingFetch, maxRetries: 0 }),
  vocabulary,
});

mkdirSync(FIXTURES, { recursive: true });
let totalCost = 0;
let exact = 0;
for (const scenario of SCENARIOS) {
  lastBody = null;
  const save = () => {
    const fixture: RecordedResponse = {
      scenarioId: scenario.scenarioId,
      requestText: scenario.request,
      recordedAt: new Date().toISOString(),
      requestSha256: requestSha256(builder.request(scenario.request)),
      response: lastBody,
    };
    writeFileSync(
      join(FIXTURES, `${scenario.scenarioId}.json`),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
  };
  try {
    const result = await builder.draft(scenario.request);
    save();
    totalCost += result.costUsd;
    const accuracy = compareWithIntent(result.draft, scenario.intent);
    if (accuracy.exact) exact += 1;
    console.log(
      `${scenario.scenarioId} ${accuracy.verdict}: ${result.tokens.inputTokens} in, ` +
        `${result.tokens.outputTokens} out (${result.thinkingTokens ?? "?"} thinking), ` +
        `$${result.costUsd.toFixed(6)}, ${result.latencyMs} ms`,
    );
    for (const field of accuracy.fields.filter((f) => f.direction !== "same")) {
      console.log(
        `  ${field.field} ${field.direction}: wanted ${JSON.stringify(field.intent)}, got ${JSON.stringify(field.mandate)}`,
      );
    }
    if (result.draft.unmapped.length > 0)
      console.log(`  unmapped: ${result.draft.unmapped.join(" | ")}`);
    if (result.draft.maxUnitPriceCents !== null)
      console.log(`  ceiling ${dollars(result.draft.maxUnitPriceCents)}`);
  } catch (error) {
    if (error instanceof MandateBuildError && error.code !== "api_error") {
      save();
      totalCost += error.details.costUsd ?? 0;
      console.log(
        `${scenario.scenarioId} failed (${error.code}): ${error.message}`,
        error.details.problems ?? "",
      );
      continue;
    }
    console.error(`${scenario.scenarioId}: ${error instanceof Error ? error.message : error}`);
    console.error("Stopping without retrying.");
    process.exit(1);
  }
}
console.log(`\n${exact} of ${SCENARIOS.length} exactly right, $${totalCost.toFixed(6)} in all`);
