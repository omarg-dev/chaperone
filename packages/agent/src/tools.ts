import { type ArenaService, type OrderDraft, ShopError } from "@firewall/arena";
import type { Event, EventLog, Provenance } from "@firewall/events";
import { type PaymentAdapter, PaymentError, recordPayments } from "@firewall/payments";
import { tool } from "ai";
import { z } from "zod";
import { orderInputFromDraft } from "./order.js";

// The agent's view of the marketplace. Every tool calls the arena service in-process, so each call
// lands in the event log with its lane and provenance, and each names the agent's own tool_call
// event as its parent. What a tool returns is what the arena served, page content included and
// left as it is: sanitising it is the firewall's job, not the shopper's.

export interface PlacedOrder {
  orderId: string;
  authorizationId: string;
  amountCents: number;
  // The authorization's status as the platform reported it: CREATED is a hold.
  status: string;
}

// One agent's run: what its tools need, and what they leave behind.
export interface RunSession {
  runId: string;
  scenarioId: string;
  arena: ArenaService;
  log: EventLog;
  // Wrapped in recordPayments by the checkout tool, so every call is on the payments lane.
  payments: PaymentAdapter;
  // The buyer's saved wallet, which the hold is authorized against.
  vaultId: string;
  // The model turn that asked for the tool calls now running, set by the turn recorder.
  currentTurnId: string;
  order: PlacedOrder | null;
}

// A refusal the agent is told about and can act on, as a real shop would show it.
const isRefusal = (error: unknown): error is Error =>
  error instanceof ShopError || error instanceof PaymentError;

export function createShoppingTools(session: RunSession) {
  const { log, arena, runId, scenarioId } = session;
  // Set before the first await, so two checkouts asked for in one turn can't both go through. A
  // checkout that fails leaves it free to try again.
  let checkingOut = false;

  const append = (type: string, provenance: Provenance, parentId: string, payload: unknown) =>
    log.append({ runId, scenarioId, lane: "agent", type, provenance, parentId, payload });

  // Records the tool call, runs it with the call's event as the parent of whatever it causes, and
  // records what came back. A refusal goes back to the model as an error it can read.
  async function run(
    toolName: string,
    toolCallId: string,
    input: unknown,
    provenance: Provenance,
    action: (callEventId: string) => unknown,
  ) {
    const call = append("tool_call", "system", session.currentTurnId, {
      toolCallId,
      toolName,
      input,
    });
    try {
      const output = await action(call.eventId);
      append("tool_result", provenance, call.eventId, { toolCallId, toolName, output });
      return output;
    } catch (error) {
      const output = { error: error instanceof Error ? error.message : String(error) };
      append("tool_result", "system", call.eventId, { toolCallId, toolName, output });
      // Anything else is a bug or an outage, not something the shop would show the agent.
      if (!isRefusal(error)) throw error;
      return output;
    }
  }

  // Runs one synchronous arena call and hands back the event it wrote, which the payment calls
  // that follow from it point at.
  function withArenaEvent<T>(parentId: string, call: () => T): { result: T; event: Event } {
    let event: Event | undefined;
    const stop = log.subscribe((e) => {
      if (e.lane === "arena" && e.parentId === parentId) event = e;
    });
    try {
      const result = call();
      if (!event) throw new Error("The arena call wrote no event");
      return { result, event };
    } finally {
      stop();
    }
  }

  // The arena's draft becomes one order, held against the buyer's wallet. Every payment call
  // points at the arena's checkout event, which points at the agent's tool call.
  async function placeOrder(
    callEventId: string,
  ): Promise<{ placed: PlacedOrder; draft: OrderDraft }> {
    const { result: draft, event } = withArenaEvent(callEventId, () =>
      arena.checkout(runId, { parentId: callEventId }),
    );
    const payments = recordPayments(session.payments, log, () => ({
      runId,
      scenarioId,
      parentId: event.eventId,
    }));
    const order = await payments.createOrder(
      orderInputFromDraft(draft, { runId, invoiceId: `inv_${event.eventId}` }),
    );
    // Holds the cart; capturing it, or not, is the review's decision.
    const hold = await payments.authorizeOrder(order.orderId, { vaultId: session.vaultId });
    const placed = {
      orderId: order.orderId,
      authorizationId: hold.authorizationId,
      amountCents: hold.amountCents,
      status: hold.status,
    };
    return { placed, draft };
  }

  const listingId = z.string().describe("The listing's ID, as search returns it");

  return {
    search: tool({
      description:
        "Search the marketplace's listings. Prices are in cents (12000 is $120.00). Returns each " +
        "hit's listing ID, title, category, brand, seller, price and rating.",
      inputSchema: z.object({
        text: z.string().optional().describe("Words to look for"),
        category: z.enum(["keyboard", "headphones", "mouse"]).optional(),
        maxPriceCents: z.number().int().positive().optional(),
      }),
      execute: (input, { toolCallId }) =>
        run("search", toolCallId, input, "seller_content", (parentId) => ({
          results: arena.search(runId, input, { parentId }),
        })),
    }),

    view_listing: tool({
      description:
        "Open a listing's page: the marketplace's catalog data (product, specs, seller, price, " +
        "stock) and the page the seller wrote (title, description, questions and answers).",
      inputSchema: z.object({ listingId }),
      execute: (input, { toolCallId }) =>
        run("view_listing", toolCallId, input, "seller_content", (parentId) =>
          arena.listing(runId, input.listingId, { parentId }),
        ),
    }),

    read_reviews: tool({
      description: "Read a listing's customer reviews.",
      inputSchema: z.object({ listingId }),
      execute: (input, { toolCallId }) =>
        run("read_reviews", toolCallId, input, "seller_content", (parentId) => ({
          listingId: input.listingId,
          reviews: arena.reviews(runId, input.listingId, { parentId }),
        })),
    }),

    add_to_cart: tool({
      description: "Add a listing to the cart. Returns the cart.",
      inputSchema: z.object({ listingId, quantity: z.number().int().positive().default(1) }),
      execute: (input, { toolCallId }) =>
        run("add_to_cart", toolCallId, input, "catalog", (parentId) =>
          arena.addToCart(runId, input.listingId, input.quantity, { parentId }),
        ),
    }),

    remove_from_cart: tool({
      description: "Take a listing out of the cart. Returns the cart.",
      inputSchema: z.object({ listingId }),
      execute: (input, { toolCallId }) =>
        run("remove_from_cart", toolCallId, input, "catalog", (parentId) =>
          arena.removeFromCart(runId, input.listingId, { parentId }),
        ),
    }),

    view_cart: tool({
      description: "See what's in the cart.",
      inputSchema: z.object({}),
      execute: (input, { toolCallId }) =>
        run("view_cart", toolCallId, input, "catalog", () => arena.cart(runId)),
    }),

    apply_coupon: tool({
      description: "Apply a coupon code to the cart lines it covers.",
      inputSchema: z.object({ code: z.string().min(1) }),
      execute: (input, { toolCallId }) =>
        run("apply_coupon", toolCallId, input, "catalog", (parentId) =>
          arena.applyCoupon(runId, input.code, { parentId }),
        ),
    }),

    checkout: tool({
      description:
        "Check out: places one order for everything in the cart and pays with the person's saved " +
        "wallet. Do this once, when the cart holds what they asked for.",
      inputSchema: z.object({}),
      execute: (input, { toolCallId }) =>
        run("checkout", toolCallId, input, "system", async (parentId) => {
          if (session.order) {
            throw new ShopError("invalid", "An order has already been placed in this run");
          }
          if (checkingOut) throw new ShopError("invalid", "A checkout is already under way");
          checkingOut = true;
          let draft: OrderDraft;
          try {
            ({ placed: session.order, draft } = await placeOrder(parentId));
          } finally {
            checkingOut = false;
          }
          return {
            status: "pending_review",
            message: "Your order is placed and pending review.",
            orderId: session.order.orderId,
            totalCents: draft.totalCents,
            lines: draft.lines.map((l) => ({
              listingId: l.listingId,
              title: l.title,
              quantity: l.quantity,
              totalCents: l.totalCents,
            })),
          };
        }),
    }),
  };
}

export type ShoppingTools = ReturnType<typeof createShoppingTools>;
