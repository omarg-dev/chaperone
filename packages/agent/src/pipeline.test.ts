import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ArenaService,
  acceptableListings,
  baseCatalog,
  buildArena,
  createArenaService,
  findScenario,
} from "@firewall/arena";
import { type EventLog, openEventLog } from "@firewall/events";
import {
  arenaVocabulary,
  DEFAULT_TOLERANCES,
  lockMandate,
  type MandateBuilder,
  type MandateDraft,
} from "@firewall/mandate";
import { createFakePaymentAdapter, type FakePaymentAdapter } from "@firewall/payments";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HAIKU_COLUMN } from "./columns.js";
import { type PipelineOptions, runWithFirewall } from "./pipeline.js";

// The whole run through the firewall, with scripted agent turns and a scripted mandate builder: no
// model is called. The arena, the fake payment platform, the gates' rules and the event log are real.
// (The model gates are covered over their recordings in @firewall/firewall.)

let dir: string;
let log: EventLog;
let arena: ArenaService;
let fake: FakePaymentAdapter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pipeline-"));
  log = openEventLog({ path: join(dir, "events.db") });
  arena = createArenaService({ log });
  fake = createFakePaymentAdapter();
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

// A builder that drafts the mandate a careful person would: the scenario's own intent.
function builderFor(scenarioId: string): MandateBuilder {
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`no ${scenarioId}`);
  return {
    model: "scripted",
    request: () => {
      throw new Error("not used");
    },
    draft: async (requestText) => {
      const draft: MandateDraft = {
        mandateId: "md_pipeline",
        requestText,
        category: scenario.intent.category,
        constraints: scenario.intent.constraints,
        brandPolicy: { mode: "any_reputable", listed: [], blocked: [] },
        maxUnitPriceCents: scenario.intent.maxUnitPriceCents ?? null,
        quantity: scenario.intent.quantity,
        allowedExtras: [],
        unmapped: [],
        currency: "USD",
        payeePolicy: "verified_sellers_only",
        tolerances: { ...DEFAULT_TOLERANCES },
      };
      return {
        draft,
        model: "scripted",
        tokens: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 },
        thinkingTokens: null,
        costUsd: 0.0001,
        latencyMs: 1,
      };
    },
  };
}

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});
let callNumber = 0;
const turn = (text: string, calls: [string, Record<string, unknown>][]) => ({
  content: [
    { type: "text" as const, text },
    ...calls.map(([toolName, input]) => ({
      type: "tool-call" as const,
      toolCallId: `call_${++callNumber}`,
      toolName,
      input: JSON.stringify(input),
    })),
  ],
  finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
  usage: usage(2_000, 100),
  warnings: [],
});
const done = {
  content: [{ type: "text" as const, text: "Done." }],
  finishReason: { unified: "stop" as const, raw: "end_turn" },
  usage: usage(2_000, 50),
  warnings: [],
};
function buying(listingId: string) {
  const turns = [
    turn("Opening it.", [["view_listing", { listingId }]]),
    turn("Adding it.", [["add_to_cart", { listingId, quantity: 1 }]]),
    turn("Checking out.", [["checkout", {}]]),
    done,
  ];
  let i = 0;
  return new MockLanguageModelV4({
    modelId: HAIKU_COLUMN.modelId,
    doGenerate: async () => turns[Math.min(i++, turns.length - 1)] as (typeof turns)[number],
  });
}

// What a careful shopper would buy: the first listing that meets the scenario's request.
function rightListing(scenarioId: string, seed: string) {
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`no ${scenarioId}`);
  const [listing] = acceptableListings(
    scenario.intent,
    buildArena(scenario, seed, baseCatalog).catalog,
  );
  if (!listing) throw new Error(`${scenarioId} has nothing acceptable to buy`);
  return listing.listingId;
}

// A listing from an attacker's store that a steered agent could end up buying.
function attackerListing(scenarioId: string, seed: string) {
  const role = "attacker";
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`no ${scenarioId}`);
  const { catalog } = buildArena(scenario, seed, baseCatalog);
  const sellers = new Map(catalog.sellers.map((s) => [s.sellerId, s]));
  const found = catalog.listings.find(
    (l) =>
      sellers.get(l.sellerId)?.role === role &&
      catalog.products.find((p) => p.sku === l.sku)?.category === scenario.intent.category,
  );
  if (!found) throw new Error(`${scenarioId} has no ${role} listing`);
  return found.listingId;
}

const options = (
  scenarioId: string,
  listingId: string,
  firewall: PipelineOptions["firewall"],
): PipelineOptions => ({
  arena,
  log,
  payments: fake,
  vaultId: "FAKE-WALLET",
  column: HAIKU_COLUMN,
  model: buying(listingId),
  scenarioId,
  seed: "1",
  builder: builderFor(scenarioId),
  firewall,
});

const payments = (operation: string) =>
  log
    .listRuns()
    .flatMap((r) => log.listRun(r.runId))
    .filter(
      (e) => e.lane === "payments" && (e.payload as { operation: string }).operation === operation,
    );

describe("a whole run through the firewall", () => {
  it("locks the mandate in the run before the agent shops, and the verdict follows the checkout", async () => {
    const result = await runWithFirewall(options("sc_a01", rightListing("sc_a01", "1"), "gate0"));
    const events = log.listRun(result.agent.runId);
    const at = (lane: string, type: string) =>
      events.findIndex((e) => e.lane === lane && e.type === type);
    expect(at("human", "mandate_requested")).toBeLessThan(at("agent", "agent_started"));
    expect(at("mandate", "mandate_locked")).toBeLessThan(at("agent", "agent_started"));
    expect(at("arena", "checkout")).toBeLessThan(at("review", "review_started"));
    expect(at("review", "review_finished")).toBeLessThan(at("review", "enforced"));
    expect(result.mandate?.hash).toBeTruthy();
    expect(result.cost.mandateUsd).toBe(0.0001);
    expect(result.cost.totalUsd).toBeCloseTo(
      result.cost.agentUsd + result.cost.mandateUsd + result.cost.reviewUsd,
      12,
    );
  });

  it("with no firewall, the attacker is paid: the attack succeeds", async () => {
    const result = await runWithFirewall(options("sc_a01", attackerListing("sc_a01", "1"), "off"));
    expect(result.review?.verdict).toBeNull();
    expect(result.enforcement).toMatchObject({ money: "captured", decidedBy: "no_review" });
    expect(result.bought.map((b) => b.sellerRole)).toEqual(["attacker"]);
    expect(result.agentFooled).toBe(true);
    expect(result.attackSucceeded).toBe(true);
    expect(result.paidToAttackersCents).toBeGreaterThan(0);
    expect(payments("capture")).toHaveLength(1);
  });

  it("with Gate 0 on, the same run is voided and the attacker gets nothing", async () => {
    const result = await runWithFirewall(
      options("sc_a01", attackerListing("sc_a01", "1"), "gate0"),
    );
    expect(result.review?.verdict).toBe("block");
    expect(result.enforcement).toMatchObject({ money: "voided", decidedBy: "review" });
    // The agent was fooled, but the cart never paid anybody.
    expect(result.agentFooled).toBe(true);
    expect(result.attackSucceeded).toBe(false);
    expect(result.paidToAttackersCents).toBe(0);
    expect(payments("capture")).toEqual([]);
    expect(fake.balances()).toEqual({});
  });

  it("a benign run the rules approve is captured and paid out, and no attack is claimed", async () => {
    const result = await runWithFirewall(options("sc_b01", rightListing("sc_b01", "1"), "gate0"));
    expect(result.review?.verdict).toBe("approve");
    expect(result.enforcement?.money).toBe("captured");
    expect(result.agentFooled).toBe(false);
    expect(result.attackSucceeded).toBe(false);
    expect(result.paidToAttackersCents).toBe(0);
  });

  it("a run whose agent never checks out has nothing to review or enforce", async () => {
    const stalls = new MockLanguageModelV4({
      modelId: HAIKU_COLUMN.modelId,
      doGenerate: async () => done,
    });
    const result = await runWithFirewall({
      ...options("sc_b01", "unused", "gate0"),
      model: stalls,
    });
    expect(result.agent.status).toBe("no_checkout");
    expect(result.review).toBeNull();
    expect(result.enforcement).toBeNull();
    expect(log.listRun(result.agent.runId).some((e) => e.lane === "review")).toBe(false);
  });

  it("the full firewall without its model gates is refused before anything is enforced", async () => {
    await expect(
      runWithFirewall(options("sc_b01", rightListing("sc_b01", "1"), "full")),
    ).rejects.toThrow(/needs its model gates/);
    expect(payments("capture")).toEqual([]);
  });
});

describe("a run whose mandate the person locked before the agent started", () => {
  // The web app's order of things: the arena run is started, the person confirms the mandate in
  // it, and the pipeline is handed the run and the locked mandate.
  async function lockedRun(scenarioId: string) {
    const run = arena.start(scenarioId, "1", { origin: "web", payments: "fake" });
    const draft = (await builderFor(scenarioId).draft(run.scenario.request)).draft;
    const mandate = lockMandate(draft, {
      vocabulary: arenaVocabulary(),
      confirmedAt: "2026-11-01T12:00:00.000Z",
    });
    log.append({
      runId: run.runId,
      scenarioId,
      lane: "mandate",
      type: "mandate_locked",
      provenance: "system",
      parentId: log.listRun(run.runId)[0]?.eventId ?? null,
      payload: { mandate },
    });
    return { run, mandate };
  }

  it("shops in that run, with that mandate, and writes it no second time", async () => {
    const { run, mandate } = await lockedRun("sc_b01");
    const { builder: _unused, ...rest } = options("sc_b01", rightListing("sc_b01", "1"), "gate0");
    const result = await runWithFirewall({ ...rest, runId: run.runId, lockedMandate: mandate });
    expect(result.agent.runId).toBe(run.runId);
    expect(result.mandate?.hash).toBe(mandate.hash);
    expect(result.cost.mandateUsd).toBe(0);
    const events = log.listRun(run.runId);
    expect(events.filter((e) => e.type === "mandate_locked")).toHaveLength(1);
    expect(events.filter((e) => e.type === "run_started")).toHaveLength(1);
    expect(log.listRuns().filter((r) => r.runId === run.runId)).toHaveLength(1);
    expect(result.review?.verdict).toBe("approve");
    expect(result.enforcement?.money).toBe("captured");
  });

  it("gives an attack the same verdict as the command line's run: the checkout is voided", async () => {
    const { run, mandate } = await lockedRun("sc_a01");
    const { builder: _unused, ...rest } = options(
      "sc_a01",
      attackerListing("sc_a01", "1"),
      "gate0",
    );
    const result = await runWithFirewall({ ...rest, runId: run.runId, lockedMandate: mandate });
    expect(result.review?.verdict).toBe("block");
    expect(result.enforcement?.money).toBe("voided");
    expect(result.paidToAttackersCents).toBe(0);
  });

  it("refuses a run that isn't for the scenario and seed it was asked to shop", async () => {
    const { run, mandate } = await lockedRun("sc_b01");
    const { builder: _unused, ...rest } = options("sc_a01", "unused", "gate0");
    await expect(
      runWithFirewall({ ...rest, runId: run.runId, lockedMandate: mandate }),
    ).rejects.toThrow(/is for sc_b01 with seed 1, not sc_a01/);
  });

  it("needs a builder or a locked mandate", async () => {
    const { builder: _unused, ...rest } = options("sc_b01", "unused", "gate0");
    await expect(runWithFirewall(rest)).rejects.toThrow(/builder or a locked mandate/);
  });
});
