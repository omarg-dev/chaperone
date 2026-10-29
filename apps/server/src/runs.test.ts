import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaService } from "@firewall/arena";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// The run list over HTTP, on a real SQLite event log in a temp folder: what the history page
// filters on that the log alone can't say (is the scenario an attack, did an attacker get paid).

let dir: string;
let log: EventLog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "server-runs-"));
  log = openEventLog({ path: join(dir, "events.db") });
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

const list = async () => {
  const app = createApp({ log, arena: createArenaService({ log }) });
  const res = await app.request("/events/runs");
  expect(res.status).toBe(200);
  const runs = (await res.json()) as Record<string, unknown>[];
  return Object.fromEntries(runs.map((r) => [r.runId as string, r]));
};

// A run the way the pipeline leaves it, reduced to the events the list reads.
function run(
  runId: string,
  scenarioId: string | null,
  options: { seed?: string; configs?: string[]; paid?: string[]; verdict?: string | null } = {},
) {
  const at = (lane: "arena" | "review", type: string, payload: unknown) =>
    log.append({ runId, scenarioId, lane, type, provenance: "system", payload });
  at("arena", "run_started", { seed: options.seed ?? "1", request: "x" });
  for (const config of options.configs ?? ["full"]) {
    at("review", "review_started", { config });
    at("review", "review_finished", { config, verdict: options.verdict ?? "approve" });
  }
  if (options.paid) {
    at("review", "enforced", {
      money: "captured",
      payouts: options.paid.map((payeeKey) => ({ payeeKey, amountCents: 5000 })),
    });
  }
}

describe("GET /events/runs", () => {
  it("says whether the scenario is an attack, from the arena", async () => {
    run("run_attack", "sc_a01");
    run("run_benign", "sc_b01");
    run("run_unknown", "sc_nope");
    run("run_none", null);
    const runs = await list();
    expect(runs.run_attack).toMatchObject({ kind: "attack" });
    expect(runs.run_benign).toMatchObject({ kind: "benign" });
    expect(runs.run_unknown).toMatchObject({ kind: null });
    expect(runs.run_none).toMatchObject({ kind: null });
  });

  it("says an attacker was paid when a payout went to one of the scenario's attackers", async () => {
    run("run_paid", "sc_a01", { configs: ["off"], paid: ["attacker_1"], verdict: null });
    run("run_honest", "sc_a01", { paid: ["seller_2"] });
    run("run_voided", "sc_a01", { verdict: "block" });
    const runs = await list();
    expect(runs.run_paid).toMatchObject({ attackerPaid: true });
    expect(runs.run_honest).toMatchObject({ attackerPaid: false });
    expect(runs.run_voided).toMatchObject({ attackerPaid: false });
  });

  it("never guesses a payee's role: a scenario the arena doesn't know has no known attackers", async () => {
    run("run_unknown", "sc_nope", { paid: ["attacker_1"] });
    run("run_no_scenario", null, { paid: ["attacker_1"] });
    const runs = await list();
    expect(runs.run_unknown).toMatchObject({ attackerPaid: false });
    expect(runs.run_no_scenario).toMatchObject({ attackerPaid: false });
  });

  it("lists the configurations a run was reviewed under, in order, and its seed, not who was paid", async () => {
    run("run_cell", "sc_b01", { seed: "7", configs: ["off", "gate0", "full"] });
    const runs = await list();
    expect(runs.run_cell).toMatchObject({
      seed: "7",
      reviews: ["off", "gate0", "full"],
      verdict: "approve",
      decidedBy: "review",
    });
    expect(runs.run_cell).not.toHaveProperty("paidPayees");
  });
});
