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
  options: {
    seed?: string;
    configs?: string[];
    paid?: string[];
    verdict?: string | null;
    heldCents?: number;
  } = {},
) {
  const at = (lane: "arena" | "review" | "payments", type: string, payload: unknown) =>
    log.append({ runId, scenarioId, lane, type, provenance: "system", payload });
  at("arena", "run_started", { seed: options.seed ?? "1", request: "x" });
  if (options.heldCents !== undefined) {
    at("payments", "payment_call", {
      operation: "authorize_order",
      input: ["ORDER-1", {}],
      result: { orderId: "ORDER-1", authorizationId: "AUTH-1", amountCents: options.heldCents },
    });
  }
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

  it("leaves out the escalation of a run the review didn't escalate", async () => {
    run("run_approved", "sc_b01");
    const runs = await list();
    expect(runs.run_approved).toMatchObject({ escalation: null, holdOpen: false });
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

  it("says how much the hold was for, and which stores were paid, by name", async () => {
    run("run_paid", "sc_a01", { paid: ["attacker_1"], heldCents: 7999 });
    run("run_unpaid", "sc_a01", { verdict: "block", heldCents: 13900 });
    run("run_early", "sc_a01");
    const runs = await list();
    expect(runs.run_paid).toMatchObject({ heldCents: 7999 });
    expect(runs.run_unpaid).toMatchObject({ heldCents: 13900, paidTo: [] });
    expect(runs.run_early).toMatchObject({ heldCents: null, paidTo: [] });
    // The name is the store's, as the payees route gives it for the same run.
    const res = await createApp({ log, arena: createArenaService({ log }) }).request(
      "/events/runs/run_paid/payees",
    );
    const payees = (await res.json()) as { payeeKey: string; sellerName: string }[];
    const attacker = payees.find((p) => p.payeeKey === "attacker_1");
    expect(attacker?.sellerName).toBeTruthy();
    expect(runs.run_paid).toMatchObject({ paidTo: [attacker?.sellerName] });
  });
});
