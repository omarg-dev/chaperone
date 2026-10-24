// A person's decision on an escalated run, on the sandbox: approve captures the held payment and
// pays each seller, reject voids it.
//
//   pnpm --filter @firewall/agent decide-run <runId> approve|reject [--note "why"] [--db <path>]
//
// The decision is written to the event log's human lane (provenance user) and then carried out by
// the same enforcement code as every other verdict. Running it again changes nothing. A hold that
// has outlived its three-day honour period is reauthorized first. The in-memory fake keeps its
// state in the process that made it, so a fake run is decided there instead, with
// `run-scenario --decide`. Needs the sandbox variables.

import { parseArgs } from "node:util";
import { openEventLog } from "@firewall/events";
import { decideEscalation } from "@firewall/firewall";
import { dollars, eventLogPath, fail, sandboxAdapter } from "./common.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { db: { type: "string" }, note: { type: "string" } },
});
const [runId, answer] = positionals;
if (!runId || (answer !== "approve" && answer !== "reject")) {
  fail('Usage: decide-run <runId> approve|reject [--note "why"] [--db <path>]');
}

const log = openEventLog({ path: eventLogPath(values.db) });
try {
  if (log.listRun(runId).length === 0) fail(`No run "${runId}" in ${eventLogPath(values.db)}`);
  const done = await decideEscalation(runId, answer, {
    log,
    payments: sandboxAdapter(),
    ...(values.note && { note: values.note }),
  });
  if (done.status === "already_enforced") console.log("Already decided; nothing was done now.");
  console.log(
    done.money === "captured"
      ? `Approved: captured ${dollars(done.capture?.amountCents ?? 0)} (${dollars(done.capture?.netAmountCents ?? 0)} after fees) and paid out:`
      : "Rejected: the hold was voided, so nobody was paid.",
  );
  for (const p of done.payouts)
    console.log(`  ${p.payeeKey}: ${dollars(p.amountCents)} (${p.status})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  log.close();
}
