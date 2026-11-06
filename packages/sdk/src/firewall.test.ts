import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ArenaService, createArenaService } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import { openEventLog } from "@firewall/events";
import {
  acceptsDraftAsIs,
  arenaVocabulary,
  lockMandate,
  type MandateBuilder,
  type MandateDraft,
} from "@firewall/mandate";
import { createFakePaymentAdapter, type FakePaymentAdapter } from "@firewall/payments";
import { type ToolSet, tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createFirewall,
  DEFAULT_PAYMENT_TOOLS,
  type Firewall,
  FirewallConfigError,
  type FirewallOptions,
} from "./firewall.js";
import { arenaSource } from "./source.js";
import {
  execution,
  gatesReplaying,
  loadGate2Recording,
  merchantTools,
  SC_B01_DRAFT,
  sc01Mandate,
} from "./test-helpers.js";

// The SDK over the real pieces: the arena, the fake payment platform, an SQLite event log in a temp
// folder, the gates' rules and the gates' recorded model answers. Scripted agent turns; no model is
// called. The three purchases below are the ones @firewall/firewall's own tests review (sc_b01,
// seed gate2-1), so the SDK reaches the verdicts the review tree reaches on them.
//
// The payment platform's agent toolkit is not installed (it is heavy and built for AI SDK 4). Its
// tools are stood in for by objects with the toolkit's tool names and input shapes, which is all
// the firewall looks at.

const HALVARD = "lst_keyboard_02_1";
const TERN = "lst_keyboard_01_1";
const CAIRN = "lst_mouse_13_1";

let dir: string;
let log: EventLog;
let arena: ArenaService;
let fake: FakePaymentAdapter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sdk-"));
  log = openEventLog({ path: join(dir, "events.db") });
  arena = createArenaService({ log });
  fake = createFakePaymentAdapter();
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

let calls = 0;
type Execute = (input: unknown, options: unknown) => Promise<unknown>;
const use = (tools: ToolSet, name: string, input: unknown = {}) => {
  const execute = tools[name]?.execute as Execute | undefined;
  if (!execute) throw new Error(`No tool ${name}`);
  calls += 1;
  return execute(input, execution(`call_${calls}`));
};

function start(overrides: Partial<FirewallOptions> = {}) {
  const run = arena.start("sc_b01", "gate2-1");
  const payNow = vi.fn();
  const firewall = createFirewall({
    log,
    source: arenaSource({ arena, log, runId: run.runId }),
    payments: fake,
    vaultId: "FAKE-WALLET",
    mandate: sc01Mandate(),
    config: "full",
    gates: gatesReplaying(loadGate2Recording("honest")),
    ...overrides,
  });
  const tools = firewall.wrap(merchantTools(arena, run.runId, payNow));
  return { run, runId: run.runId, firewall, tools, payNow };
}

const browse = (tools: ToolSet, listingId: string) =>
  Promise.all([
    use(tools, "view_listing", { listingId }),
    use(tools, "read_reviews", { listingId }),
  ]);

// The three purchases the review tree is tested on, shopped through the agent's tools.
const PURCHASES = {
  honest: async (tools: ToolSet) => {
    await use(tools, "search", { text: "tactile mechanical keyboard", category: "keyboard" });
    await browse(tools, TERN);
    await browse(tools, HALVARD);
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
  },
  wrong_product: async (tools: ToolSet) => {
    await browse(tools, TERN);
    await use(tools, "add_to_cart", { listingId: TERN, quantity: 1 });
  },
  unrequested_extra: async (tools: ToolSet) => {
    await browse(tools, HALVARD);
    await browse(tools, CAIRN);
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    await use(tools, "add_to_cart", { listingId: CAIRN, quantity: 1 });
  },
};

// Gates replay one recording, and each purchase has its own.
async function shop(name: keyof typeof PURCHASES) {
  const s = start({ gates: gatesReplaying(loadGate2Recording(name)) });
  await PURCHASES[name](s.tools);
  return s;
}

const payments = (runId: string, operation?: string): Event[] =>
  log
    .listRun(runId)
    .filter(
      (e) =>
        e.lane === "payments" &&
        (operation === undefined || (e.payload as { operation: string }).operation === operation),
    );

describe("wrap: non-payment tools", () => {
  it("leaves them exactly as they were, and they still work", async () => {
    const { tools, run } = start();
    const original = merchantTools(arena, run.runId);
    for (const name of ["search", "view_listing", "read_reviews", "add_to_cart"] as const) {
      expect(Object.keys(tools)).toContain(name);
    }
    // Same object: nothing is wrapped around them, so nothing they do changes.
    const again = createFirewall({
      log,
      source: arenaSource({ arena, log, runId: run.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "off",
    }).wrap(original);
    expect(again.add_to_cart).toBe(original.add_to_cart);
    expect(again.search).toBe(original.search);

    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    expect(arena.cart(run.runId).lines.map((l) => l.listingId)).toEqual([HALVARD]);
    // The firewall wrote nothing for them: the arena's own events are what Gate 1 reads.
    expect(log.listRun(run.runId).filter((e) => e.lane === "agent")).toEqual([]);
  });
});

describe("a guarded payment tool", () => {
  it("holds the cart and never captures, and the agent is told the order is pending review", async () => {
    const { tools, runId, firewall, payNow } = start();
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    const answer = (await use(tools, "checkout")) as Record<string, unknown>;

    expect(answer).toMatchObject({ status: "pending_review", totalCents: expect.any(Number) });
    expect(String(answer.message)).toContain("pending review");
    // The original "pay now" never ran.
    expect(payNow).not.toHaveBeenCalled();
    const operations = payments(runId).map((e) => (e.payload as { operation: string }).operation);
    expect(operations).toEqual(["create_order", "authorize_order"]);
    expect(firewall.held).toMatchObject({ status: "CREATED" });
    expect(fake.balances()).toEqual({});
  });

  it("keeps the tool's description and input schema, so the agent sees the same tool", () => {
    const original = merchantTools(arena, "unused");
    const { tools } = start();
    expect(tools.checkout?.description).toBe(original.checkout.description);
    expect(tools.checkout?.inputSchema).toBeDefined();
    expect(tools.checkout).not.toBe(original.checkout);
  });

  it("links the hold to the checkout, and the checkout to the agent's tool call", async () => {
    const turn = arena.start("sc_b01", "gate2-1");
    const firewall = createFirewall({
      log,
      source: arenaSource({ arena, log, runId: turn.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "off",
      causedBy: () => log.listRun(turn.runId)[0]?.eventId as string,
    });
    const tools = firewall.wrap(merchantTools(arena, turn.runId));
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    await use(tools, "checkout");
    const events = log.listRun(turn.runId);
    const byId = new Map(events.map((e) => [e.eventId, e]));
    const authorize = payments(turn.runId, "authorize_order")[0];
    const chain: string[] = [];
    for (let e = authorize; e; e = e.parentId ? byId.get(e.parentId) : undefined) {
      chain.push(`${e.lane}:${e.type}`);
    }
    expect(chain).toEqual([
      "payments:payment_call",
      "arena:checkout",
      "agent:tool_call",
      "arena:run_started",
    ]);
  });

  it("places one order per run, even when asked for two at once", async () => {
    const { tools, runId } = start();
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    const answers = await Promise.all([use(tools, "checkout"), use(tools, "checkout")]);
    expect(answers).toContainEqual({ error: "A checkout is already under way" });
    expect(payments(runId, "authorize_order")).toHaveLength(1);
    // And later asks are told the same, not given a second order.
    expect(await use(tools, "checkout")).toEqual({
      error: "An order has already been placed in this run",
    });
  });

  it("tells the agent why an empty cart can't be checked out, and lets it try again", async () => {
    const { tools, firewall } = start();
    expect(await use(tools, "checkout")).toEqual({ error: expect.stringContaining("empty") });
    expect(firewall.held).toBeNull();
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    expect(await use(tools, "checkout")).toMatchObject({ status: "pending_review" });
  });
});

describe("which tools are payment tools", () => {
  it("defaults to our checkout and the platform toolkit's create_order and pay_order", () => {
    expect(DEFAULT_PAYMENT_TOOLS).toEqual(["checkout", "create_order", "pay_order"]);
  });

  // Stand-ins for the platform toolkit's tools: its names and input shapes. The real toolkit's
  // create_order captures at once and pay_order captures an order; these would too.
  function toolkitStandIns(onPaid: () => void) {
    return {
      create_order: tool({
        description: "Create a PayPal order",
        inputSchema: z.object({
          currencyCode: z.string(),
          items: z.array(
            z.object({ name: z.string(), quantity: z.number(), unitAmount: z.string() }),
          ),
        }),
        execute: (): unknown => {
          onPaid();
          return { id: "toolkit-order" };
        },
      }),
      pay_order: tool({
        description: "Pay a PayPal order",
        inputSchema: z.object({ orderId: z.string() }),
        execute: (): unknown => {
          onPaid();
          return { status: "COMPLETED" };
        },
      }),
    };
  }

  it("guards the toolkit's create_order: the cart is held, not paid, whatever amount the agent sent", async () => {
    const { firewall, runId } = start();
    const paid = vi.fn();
    const tools = firewall.wrap({
      ...merchantTools(arena, runId),
      ...toolkitStandIns(paid),
    });
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    const answer = (await use(tools, "create_order", {
      currencyCode: "USD",
      items: [{ name: "Halvard TKL", quantity: 1, unitAmount: "0.01" }],
    })) as { status: string; totalCents: number; orderId: string };

    expect(paid).not.toHaveBeenCalled();
    expect(answer.status).toBe("pending_review");
    // The held amount is the catalog's price for the cart, not the agent's one cent.
    expect(answer.totalCents).toBeGreaterThan(1000);
    expect(payments(runId, "capture")).toEqual([]);
    // The agent's own arguments are kept with its call.
    const call = log.listRun(runId).find((e) => e.lane === "agent" && e.type === "tool_call");
    expect(call?.payload).toMatchObject({ toolName: "create_order" });
    expect(JSON.stringify(call?.payload)).toContain("0.01");
  });

  it("guards pay_order: paying the held order is answered as pending, paying another is refused", async () => {
    const { firewall, runId } = start();
    const paid = vi.fn();
    const tools = firewall.wrap({
      ...merchantTools(arena, runId),
      ...toolkitStandIns(paid),
    });
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    const placed = (await use(tools, "create_order", { currencyCode: "USD", items: [] })) as {
      orderId: string;
    };
    expect(await use(tools, "pay_order", { orderId: placed.orderId })).toMatchObject({
      status: "pending_review",
      orderId: placed.orderId,
    });
    expect(await use(tools, "pay_order", { orderId: "someone-elses" })).toEqual({
      error: "An order has already been placed in this run",
    });
    expect(paid).not.toHaveBeenCalled();
    expect(payments(runId, "capture")).toEqual([]);
    expect(payments(runId, "authorize_order")).toHaveLength(1);
  });

  it("does not guard a payment tool that isn't in the list: it runs as it was and pays", async () => {
    const { run } = start();
    const buyNow = vi.fn(() => ({ status: "paid" }));
    const firewall = createFirewall({
      log,
      source: arenaSource({ arena, log, runId: run.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "off",
      paymentTools: ["checkout"],
    });
    const original = {
      ...merchantTools(arena, run.runId),
      buy_now: tool({ description: "Buy", inputSchema: z.object({}), execute: buyNow }),
      ...toolkitStandIns(buyNow),
    };
    const tools = firewall.wrap(original);

    expect(tools.buy_now).toBe(original.buy_now);
    // An explicit list replaces the defaults: create_order is passed through here.
    expect(tools.create_order).toBe(original.create_order);
    expect(tools.checkout).not.toBe(original.checkout);
    await use(tools, "buy_now");
    expect(buyNow).toHaveBeenCalledTimes(1);
    expect(firewall.held).toBeNull();
    expect(await firewall.settle()).toBeNull();
  });

  it("an explicit list can guard a tool under any name", async () => {
    const { run } = start();
    const firewall = createFirewall({
      log,
      source: arenaSource({ arena, log, runId: run.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "off",
      paymentTools: ["buy_now"],
    });
    const buyNow = vi.fn();
    const tools = firewall.wrap({
      ...merchantTools(arena, run.runId),
      buy_now: tool({ description: "Buy", inputSchema: z.object({}), execute: buyNow }),
    });
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    expect(await use(tools, "buy_now")).toMatchObject({ status: "pending_review" });
    expect(buyNow).not.toHaveBeenCalled();
  });
});

describe("settle: the review tree's enforcement, through the SDK", () => {
  it("approve: captures the hold and pays each seller", async () => {
    const { tools, firewall, runId } = await shop("honest");
    await use(tools, "checkout");
    const settled = await firewall.settle();

    expect(settled?.review.verdict).toBe("approve");
    expect(settled?.review.gates.map((g) => g.gate)).toEqual(["gate0", "gate1", "gate2"]);
    expect(settled?.enforcement).toMatchObject({ money: "captured", decidedBy: "review" });
    expect(payments(runId, "capture")).toHaveLength(1);
    expect(settled?.enforcement.payouts.length).toBeGreaterThan(0);
    expect(Object.keys(fake.balances()).length).toBeGreaterThan(0);
  });

  it("block: voids the hold and nobody is paid, with no model gate called", async () => {
    const { tools, firewall, runId } = await shop("wrong_product");
    await use(tools, "checkout");
    const settled = await firewall.settle();

    expect(settled?.review.verdict).toBe("block");
    expect(settled?.review.gates.map((g) => g.gate)).toEqual(["gate0"]);
    expect(settled?.enforcement).toMatchObject({ money: "voided", decidedBy: "review" });
    expect(payments(runId, "capture")).toEqual([]);
    expect(payments(runId, "void")).toHaveLength(1);
    expect(fake.balances()).toEqual({});
  });

  it("escalate: the hold stays, and the person's decision captures it or voids it", async () => {
    const approved = await shop("unrequested_extra");
    await use(approved.tools, "checkout");
    const settled = await approved.firewall.settle();
    expect(settled?.review.verdict).toBe("escalate");
    expect(settled?.enforcement).toMatchObject({ status: "awaiting_person", money: "held" });
    expect(payments(approved.runId, "capture")).toEqual([]);
    expect(payments(approved.runId, "void")).toEqual([]);

    const decision = await approved.firewall.decide("approve", "I do want the mouse");
    expect(decision).toMatchObject({ money: "captured", decidedBy: "person" });
    expect(payments(approved.runId, "capture")).toHaveLength(1);
    const human = log.listRun(approved.runId).find((e) => e.type === "human_decision");
    expect(human).toMatchObject({ lane: "human", provenance: "user" });

    const rejected = await shop("unrequested_extra");
    await use(rejected.tools, "checkout");
    await rejected.firewall.settle();
    expect(await rejected.firewall.decide("reject")).toMatchObject({
      money: "voided",
      decidedBy: "person",
    });
    expect(payments(rejected.runId, "capture")).toEqual([]);
  });

  it("settling twice moves the money once", async () => {
    const { tools, firewall, runId } = await shop("honest");
    await use(tools, "checkout");
    await firewall.settle();
    const again = await firewall.settle();
    expect(again?.enforcement.status).toBe("enforced");
    expect(payments(runId, "capture")).toHaveLength(1);
    // The review isn't run again (the model gates cost money), and enforcement isn't repeated.
    expect(log.listRun(runId).filter((e) => e.type === "review_finished")).toHaveLength(1);
    expect(log.listRun(runId).filter((e) => e.type === "enforced")).toHaveLength(1);
    // A fresh firewall over the same run, asked to enforce, finds it already done.
    expect((await firewall.enforce()).status).toBe("already_enforced");
  });

  it("reviews after the agent is done, not inside the tool call", async () => {
    const { tools, runId } = await shop("wrong_product");
    // The agent's checkout is answered the same for a cart that will be blocked as for any other,
    // and no gate has run by the time it returns.
    expect(await use(tools, "checkout")).toMatchObject({ status: "pending_review" });
    const lanes = new Set(log.listRun(runId).map((e) => e.lane));
    for (const lane of ["gate0", "gate1", "gate2", "review"])
      expect(lanes.has(lane as never)).toBe(false);
  });

  it("with nothing held there is nothing to settle", async () => {
    const { firewall } = start();
    expect(await firewall.settle()).toBeNull();
  });

  it("a failed review enforces nothing and leaves the order held", async () => {
    const { tools, firewall, runId } = await shop("honest");
    await use(tools, "checkout");
    const broken = createFirewall({
      log,
      source: arenaSource({ arena, log, runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "full",
      gates: () => {
        throw new Error("the gates are down");
      },
    });
    await expect(broken.review()).rejects.toThrow("the gates are down");
    expect(payments(runId, "capture")).toEqual([]);
    expect(firewall.held).not.toBeNull();
  });
});

describe("the mandate", () => {
  it("a supplied mandate is put in the run before the cart is held, where Gate 0 finds it", async () => {
    const { tools, runId } = start({ config: "gate0" });
    await use(tools, "add_to_cart", { listingId: TERN, quantity: 1 });
    await use(tools, "checkout");
    const events = log.listRun(runId);
    const locked = events.find((e) => e.type === "mandate_locked");
    expect(locked).toMatchObject({ lane: "mandate", provenance: "system" });
    expect(locked?.payload).toMatchObject({ source: "supplied" });
    expect(locked?.seq).toBeLessThan(events.find((e) => e.type === "checkout")?.seq ?? 0);
  });

  it("a mandate the person already locked in this run is not written a second time", async () => {
    const mandate = sc01Mandate();
    const run = arena.start("sc_b01", "gate2-1");
    log.append({
      runId: run.runId,
      scenarioId: "sc_b01",
      lane: "mandate",
      type: "mandate_locked",
      provenance: "system",
      parentId: log.listRun(run.runId)[0]?.eventId ?? null,
      payload: { mandate },
    });
    const firewall = createFirewall({
      log,
      source: arenaSource({ arena, log, runId: run.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "gate0",
      mandate,
    });
    await expect(firewall.ready()).resolves.toEqual(mandate);
    expect(log.listRun(run.runId).filter((e) => e.type === "mandate_locked")).toHaveLength(1);
    // A different mandate is a different confirmation, and is written.
    const other = lockMandate(
      { ...SC_B01_DRAFT, quantity: 2 },
      {
        vocabulary: arenaVocabulary(),
        confirmedAt: "2026-10-23T09:00:00.000Z",
      },
    );
    await createFirewall({
      log,
      source: arenaSource({ arena, log, runId: run.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "gate0",
      mandate: other,
    }).ready();
    expect(log.listRun(run.runId).filter((e) => e.type === "mandate_locked")).toHaveLength(2);
  });

  it("a mandate altered after locking is refused", async () => {
    const mandate = { ...sc01Mandate(), maxUnitPriceCents: 999999 };
    const run = arena.start("sc_b01", "gate2-1");
    const firewall = createFirewall({
      log,
      source: arenaSource({ arena, log, runId: run.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "gate0",
      mandate,
    });
    await expect(firewall.ready()).rejects.toThrow(FirewallConfigError);
    expect(log.listRun(run.runId).some((e) => e.type === "mandate_locked")).toBe(false);
  });

  it("with no mandate, Gate 0 blocks: there is nothing the person confirmed", async () => {
    const s = start({ config: "gate0", mandate: undefined });
    await use(s.tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    await use(s.tools, "checkout");
    const settled = await s.firewall.settle();
    expect(settled?.review.verdict).toBe("block");
    expect(settled?.enforcement.money).toBe("voided");
  });

  it("a request to build one is built with the person in the run, ahead of the checkout, and priced", async () => {
    const builder: MandateBuilder = {
      model: "scripted",
      request: () => {
        throw new Error("not used");
      },
      draft: async (requestText) => ({
        draft: { ...SC_B01_DRAFT, requestText } satisfies MandateDraft,
        model: "scripted",
        tokens: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 },
        thinkingTokens: null,
        costUsd: 0.0001,
        latencyMs: 1,
      }),
    };
    const run = arena.start("sc_b01", "gate2-1");
    const firewall = createFirewall({
      log,
      source: arenaSource({ arena, log, runId: run.runId }),
      payments: fake,
      vaultId: "FAKE-WALLET",
      config: "gate0",
      mandate: { builder, person: acceptsDraftAsIs, vocabulary: arenaVocabulary() },
    });
    const tools = firewall.wrap(merchantTools(arena, run.runId));
    // The agent checks out without anyone having called ready(): the guard does it first.
    await use(tools, "add_to_cart", { listingId: HALVARD, quantity: 1 });
    await use(tools, "checkout");
    const events = log.listRun(run.runId);
    const at = (lane: string, type: string) =>
      events.findIndex((e) => e.lane === lane && e.type === type);
    expect(at("human", "mandate_requested")).toBeLessThan(at("mandate", "mandate_locked"));
    expect(at("mandate", "mandate_locked")).toBeLessThan(at("arena", "checkout"));
    expect(events.find((e) => e.type === "mandate_requested")?.payload).toMatchObject({
      requestText: expect.stringContaining("tactile"),
    });
    expect(firewall.mandateCostUsd).toBe(0.0001);
    expect((await firewall.settle())?.review.verdict).toBe("approve");
  });
});

describe("configuration", () => {
  it("the full firewall without its model gates is refused before the agent runs", () => {
    const run = arena.start("sc_b01", "gate2-1");
    expect(() =>
      createFirewall({
        log,
        source: arenaSource({ arena, log, runId: run.runId }),
        payments: fake,
        vaultId: "FAKE-WALLET",
      }),
    ).toThrow(/needs its model gates/);
  });

  it("off holds the cart and reviews nothing, so settling captures it as it stands", async () => {
    const s = start({ config: "off", mandate: undefined });
    await PURCHASES.wrong_product(s.tools);
    await use(s.tools, "checkout");
    const settled = await s.firewall.settle();
    expect(settled?.review.verdict).toBeNull();
    expect(settled?.enforcement).toMatchObject({ money: "captured", decidedBy: "no_review" });
  });
});

describe("the catalog source", () => {
  it("is the arena's: the run's trusted catalog, and the checkout it wrote under the tool call", async () => {
    const run = arena.start("sc_b01", "gate2-1");
    const source = arenaSource({ arena, log, runId: run.runId });
    expect(source.scenarioId).toBe("sc_b01");
    expect(source.request).toContain("keyboard");
    expect(source.catalog().listings.length).toBeGreaterThan(0);
    arena.addToCart(run.runId, HALVARD, 1);
    const parent = log.listRun(run.runId)[0]?.eventId as string;
    const { draft, eventId } = source.checkout(parent);
    expect(draft.lines).toHaveLength(1);
    const event = log.listRun(run.runId).find((e) => e.eventId === eventId);
    expect(event).toMatchObject({ lane: "arena", type: "checkout", parentId: parent });
  });
});

export type { Firewall };
