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
import { ancestors, type Event, type EventLog, openEventLog } from "@firewall/events";
import { createFakePaymentAdapter, type FakePaymentAdapter } from "@firewall/payments";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HAIKU_COLUMN } from "./columns.js";
import { runAgent } from "./run.js";

// The agent loop driven by scripted model turns: no model is called. Everything else is real: the
// arena service, the fake payment adapter and an SQLite event log in a temp folder.

let dir: string;
let log: EventLog;
let arena: ArenaService;
let fake: FakePaymentAdapter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-"));
  log = openEventLog({ path: join(dir, "events.db") });
  arena = createArenaService({ log, newRunId: () => "run_test" });
  fake = createFakePaymentAdapter();
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

type Call = [toolName: string, input: Record<string, unknown>];

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

let callNumber = 0;
const toolTurn = (text: string, calls: Call[], tokens = usage(2_000, 100)) => ({
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
  usage: tokens,
  warnings: [],
});

const finalTurn = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "end_turn" },
  usage: usage(2_000, 50),
  warnings: [],
});

// Plays the turns in order, then keeps repeating the last one.
function scripted(turns: ReturnType<typeof toolTurn | typeof finalTurn>[]) {
  let i = 0;
  return new MockLanguageModelV4({
    modelId: HAIKU_COLUMN.modelId,
    doGenerate: async () => {
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      if (!turn) throw new Error("No scripted turns");
      return turn;
    },
  });
}

const options = (model: MockLanguageModelV4) => ({
  arena,
  log,
  payments: fake,
  vaultId: "FAKE-WALLET",
  column: HAIKU_COLUMN,
  model,
  scenarioId: "sc_b01",
  seed: "1",
});

// What an honest, careful shopper could buy in sc_b01 with seed 1: worked out the way the eval
// does, from the same seeded arena.
function rightListing(): string {
  const scenario = findScenario("sc_b01");
  if (!scenario) throw new Error("no sc_b01");
  const [listing] = acceptableListings(
    scenario.intent,
    buildArena(scenario, "1", baseCatalog).catalog,
  );
  if (!listing) throw new Error("sc_b01 has nothing acceptable to buy");
  return listing.listingId;
}

const benignScript = (listingId: string) =>
  scripted([
    toolTurn("Searching for tactile mechanical keyboards under $120.", [
      [
        "search",
        { text: "mechanical tactile keyboard", category: "keyboard", maxPriceCents: 12000 },
      ],
    ]),
    toolTurn("This one looks right; checking its page and reviews.", [
      ["view_listing", { listingId }],
      ["read_reviews", { listingId }],
    ]),
    toolTurn("It's mechanical with tactile switches and under budget. Adding it.", [
      ["add_to_cart", { listingId, quantity: 1 }],
    ]),
    toolTurn("The cart is right, checking out.", [["checkout", {}]]),
    finalTurn("Done."),
  ]);

const ofType = (events: Event[], lane: string, type: string) =>
  events.filter((e) => e.lane === lane && e.type === type);

describe("shopping agent", () => {
  it("buys the right thing and leaves the order held, not captured", async () => {
    const listingId = rightListing();
    const outcome = await runAgent(options(benignScript(listingId)));

    expect(outcome.status).toBe("checked_out");
    expect(outcome.modelCalls).toBe(4);
    const order = outcome.order;
    if (!order) throw new Error("no order");
    expect(order.status).toBe("CREATED");
    expect((await fake.getAuthorization(order.authorizationId)).status).toBe("CREATED");
    const placed = await fake.getOrder(order.orderId);
    expect(placed.purchaseUnits[0]?.items.map((i) => i.lineId)).toEqual([listingId]);
    expect(placed.customId).toBe("run_test");

    const payments = log.listRun("run_test").filter((e) => e.lane === "payments");
    expect(payments.map((e) => (e.payload as { operation: string }).operation)).toEqual([
      "create_order",
      "authorize_order",
    ]);
    // Nothing captured, so no money has moved to the platform or any seller.
    expect(fake.balances()).toEqual({});
  });

  it("tells the agent its order is placed and pending review", async () => {
    await runAgent(options(benignScript(rightListing())));
    const [result] = ofType(log.listRun("run_test"), "agent", "tool_result").filter(
      (e) => (e.payload as { toolName: string }).toolName === "checkout",
    );
    expect(result?.payload).toMatchObject({
      output: { status: "pending_review", message: "Your order is placed and pending review." },
    });
  });

  it("records the agent's steps, linked to the arena and payment events they caused", async () => {
    await runAgent(options(benignScript(rightListing())));
    const events = log.listRun("run_test");
    const byId = new Map(events.map((e) => [e.eventId, e]));
    const parent = (e: Event) => (e.parentId ? byId.get(e.parentId) : undefined);

    const turns = ofType(events, "agent", "model_turn");
    expect(turns).toHaveLength(4);
    expect(turns[0]?.payload).toMatchObject({
      text: "Searching for tactile mechanical keyboards under $120.",
      toolCalls: [{ toolName: "search", input: { category: "keyboard", maxPriceCents: 12000 } }],
      tokens: { inputTokens: 2_000, outputTokens: 100 },
    });
    // 2,000 tokens in at $0.10 per million and 100 out at $0.50.
    expect(turns[0]?.costUsd).toBeCloseTo(0.00025, 10);
    // Each turn follows the one before; the first follows the agent's start, which follows the run.
    expect(parent(turns[0] as Event)?.type).toBe("agent_started");
    expect(parent(parent(turns[0] as Event) as Event)?.type).toBe("run_started");
    for (const [i, turn] of turns.slice(1).entries()) {
      expect(turn.parentId).toBe(turns[i]?.eventId);
    }

    // Every tool call hangs off the turn that asked for it.
    for (const call of ofType(events, "agent", "tool_call")) {
      expect(parent(call)?.type).toBe("model_turn");
    }
    // Every arena call after the start hangs off a tool call.
    for (const served of events.filter((e) => e.lane === "arena" && e.type !== "run_started")) {
      expect(parent(served)?.type).toBe("tool_call");
    }
    // Page reads come back as seller content.
    const results = ofType(events, "agent", "tool_result");
    const provenanceOf = (toolName: string) =>
      results.find((e) => (e.payload as { toolName: string }).toolName === toolName)?.provenance;
    expect(provenanceOf("search")).toBe("seller_content");
    expect(provenanceOf("read_reviews")).toBe("seller_content");
    expect(provenanceOf("add_to_cart")).toBe("catalog");

    // The hold traces back through the checkout to the turn that decided on it.
    const [authorize] = events.filter(
      (e) =>
        e.lane === "payments" &&
        (e.payload as { operation: string }).operation === "authorize_order",
    );
    if (!authorize) throw new Error("no authorize");
    expect(ancestors(events, authorize.eventId).map((e) => `${e.lane}:${e.type}`)).toEqual([
      "arena:checkout",
      "agent:tool_call",
      "agent:model_turn",
      "agent:model_turn",
      "agent:model_turn",
      "agent:model_turn",
      "agent:agent_started",
      "arena:run_started",
    ]);

    const [finished] = ofType(events, "agent", "run_finished");
    expect(finished?.payload).toMatchObject({ status: "checked_out", modelCalls: 4 });
    expect(finished?.costUsd).toBe(0);
  });

  it("stops a looping agent at the spend cap", async () => {
    // Each turn costs half a cent: 40,000 tokens in and 2,000 out.
    const looping = scripted([
      toolTurn("Searching again.", [["search", { text: "keyboard" }]], usage(40_000, 2_000)),
    ]);
    const outcome = await runAgent({ ...options(looping), limits: { maxUsd: 0.02 } });

    expect(outcome.status).toBe("spend_cap");
    expect(outcome.order).toBeNull();
    expect(outcome.costUsd).toBeLessThanOrEqual(0.02);
    expect(outcome.modelCalls).toBe(3);
    const turns = ofType(log.listRun("run_test"), "agent", "model_turn");
    expect(turns).toHaveLength(3);
    const total = turns.reduce((sum, e) => sum + e.costUsd, 0);
    expect(total).toBeCloseTo(outcome.costUsd, 10);
  });

  it("stops at the step cap", async () => {
    const looping = scripted([toolTurn("Searching again.", [["search", { text: "keyboard" }]])]);
    const outcome = await runAgent({ ...options(looping), limits: { maxSteps: 3 } });
    expect(outcome.status).toBe("step_cap");
    expect(outcome.modelCalls).toBe(3);
  });

  it("refuses to check out an empty cart, and the agent hears why", async () => {
    const outcome = await runAgent(
      options(
        scripted([
          toolTurn("Checking out.", [["checkout", {}]]),
          finalTurn("I couldn't check out."),
        ]),
      ),
    );

    expect(outcome.status).toBe("no_checkout");
    expect(outcome.order).toBeNull();
    expect(outcome.finalText).toBe("I couldn't check out.");
    const events = log.listRun("run_test");
    const [result] = ofType(events, "agent", "tool_result");
    expect(result?.payload).toMatchObject({ output: { error: "The cart is empty" } });
    const [failed] = ofType(events, "arena", "checkout_failed");
    expect(failed?.parentId).toBe(ofType(events, "agent", "tool_call")[0]?.eventId);
    expect(events.filter((e) => e.lane === "payments")).toEqual([]);
  });

  it("checks out after an empty-cart refusal once the cart is filled", async () => {
    const listingId = rightListing();
    const outcome = await runAgent(
      options(
        scripted([
          toolTurn("Checking out.", [["checkout", {}]]),
          toolTurn("The cart was empty; adding the keyboard.", [["add_to_cart", { listingId }]]),
          toolTurn("Checking out again.", [["checkout", {}]]),
        ]),
      ),
    );
    expect(outcome.status).toBe("checked_out");
    expect(outcome.order?.status).toBe("CREATED");
  });

  it("places one order per run, even when asked for two checkouts at once", async () => {
    const listingId = rightListing();
    const outcome = await runAgent(
      options(
        scripted([
          toolTurn("Adding it.", [["add_to_cart", { listingId }]]),
          toolTurn("Checking out, twice to be sure.", [
            ["checkout", {}],
            ["checkout", {}],
          ]),
        ]),
      ),
    );
    expect(outcome.status).toBe("checked_out");
    const outputs = ofType(log.listRun("run_test"), "agent", "tool_result").map(
      (e) => (e.payload as { output: { status?: string } }).output,
    );
    expect(outputs.filter((o) => o.status === "pending_review")).toHaveLength(1);
    expect(outputs).toContainEqual({ error: "A checkout is already under way" });
    expect((await fake.getOrder(outcome.order?.orderId ?? "")).status).toBe("COMPLETED");
    const orders = log
      .listRun("run_test")
      .filter((e) => (e.payload as { operation?: string }).operation === "create_order");
    expect(orders).toHaveLength(1);
  });
});
