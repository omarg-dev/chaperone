// Builds a mandate from a request and asks you to confirm it.
//
//   pnpm --filter @firewall/mandate build-mandate "Buy me a tactile mechanical keyboard under $120"
//     [--run <runId>] [--db <path>]
//
// One Claude Haiku 5.5 call drafts the mandate (about a twentieth of a cent). Needs
// FIREWALL_ANTHROPIC_API_KEY. You then accept it, edit a field, or reject it; accepting locks it.
// Everything lands in the event log (events.db under DATA_DIR, or --db), under --run or a new run.

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openEventLog } from "@firewall/events";
import {
  anthropicConfigFromEnv,
  arenaVocabulary,
  buildMandate,
  createAnthropicClient,
  createMandateBuilder,
  MandateBuildError,
  terminalPerson,
} from "../src/index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { run: { type: "string" }, db: { type: "string" } },
});

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

const requestText = positionals.join(" ").trim();
if (!requestText)
  fail('Usage: build-mandate "<what you want bought>" [--run <runId>] [--db <path>]');

let config: ReturnType<typeof anthropicConfigFromEnv>;
try {
  config = anthropicConfigFromEnv();
} catch (error) {
  fail((error as Error).message);
}

// Relative paths are taken from the repo root, so the log is the same file wherever pnpm runs.
const dataDir = process.env.DATA_DIR || "data";
const dbPath =
  values.db ?? join(isAbsolute(dataDir) ? dataDir : join(REPO_ROOT, dataDir), "events.db");
mkdirSync(dirname(dbPath), { recursive: true });
const log = openEventLog({ path: dbPath });
const runId = values.run ?? `run_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

const vocabulary = arenaVocabulary();
const builder = createMandateBuilder({ client: createAnthropicClient(config), vocabulary });
// Answers are read as a stream of lines rather than with rl.question, which drops lines that
// arrive before it's called: piped answers would all arrive during the model call and be lost.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
class NoAnswer extends Error {}
const person = terminalPerson(
  {
    async ask(question) {
      process.stdout.write(question);
      const next = await lines.next();
      if (next.done) throw new NoAnswer();
      if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`);
      return next.value;
    },
    print: (text) => console.log(text),
  },
  vocabulary,
);

console.log(`Drafting a mandate (run ${runId})…`);
try {
  const outcome = await buildMandate({ log, runId, vocabulary }, { builder, requestText, person });
  const { result } = outcome.drafted;
  const spend = `${result.tokens.inputTokens} in, ${result.tokens.outputTokens} out, $${result.costUsd.toFixed(6)}`;
  if (outcome.outcome === "locked") {
    console.log(`\nLocked ${outcome.mandate.mandateId}: ${outcome.mandate.hash}`);
    console.log(`Event ${outcome.event.eventId} in ${dbPath}. The draft cost ${spend}.`);
  } else {
    console.log(`\nRejected${outcome.reason ? `: ${outcome.reason}` : ""}. Nothing was locked.`);
    console.log(`The draft cost ${spend}.`);
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof MandateBuildError) {
    const problems = error.details.problems?.map((p) => `\n  - ${p}`).join("") ?? "";
    fail(`Couldn't draft a mandate (${error.code}): ${error.message}${problems}`);
  }
  if (error instanceof NoAnswer) fail("\nNo answer. Nothing was locked.", 1);
  throw error;
} finally {
  rl.close();
  log.close();
}
