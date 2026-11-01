import { type Catalog, ShopError } from "@firewall/arena";
import type { EventLog } from "@firewall/events";
import {
  decideEscalation,
  type Enforcement,
  enforceReview,
  type FirewallConfig,
  type ReviewGates,
  type ReviewRun,
  runReview,
} from "@firewall/firewall";
import {
  arenaVocabulary,
  buildMandate,
  type LockedMandate,
  type MandateBuilder,
  type Person,
  type Vocabulary,
  verifyMandate,
} from "@firewall/mandate";
import { type PaymentAdapter, PaymentError, recordPayments } from "@firewall/payments";
import type { ToolSet } from "ai";
import { orderInputFromDraft } from "./order.js";
import type { CatalogSource } from "./source.js";

// The firewall in front of one shopping agent's run. `wrap` takes the agent's tools and replaces
// each payment tool with one that holds the cart instead of paying for it; the review and what
// follows from its verdict happen after the agent is done (`settle`), never inside the tool call.
//
//     const firewall = createFirewall({ log, source, payments, vaultId, mandate, config });
//     const tools = firewall.wrap(paymentTools);
//     ... the agent runs with `tools` as before ...
//     const settled = await firewall.settle();
//
// Why the review runs after the agent finishes:
//  - Gate 3 audits the agent's whole trajectory, which isn't there to read until the agent stops;
//  - the tool's answer is the same whatever the cart turns out to be, so an agent steered by an
//    attacker learns nothing about the gates by probing the checkout;
//  - the model gates take seconds, and a tool call shouldn't hang on them;
//  - nothing is lost by waiting: the hold stays authorized for days.
//
// A guarded tool never captures. Its original `execute` is never called either: it is the "pay
// now" the firewall exists to replace, and calling it would pay. The order that is held is the
// cart the catalog source reports, not the amounts in the agent's arguments, because the agent's
// arguments are what an attack tries to change. The arguments are recorded with the call.

// Tools the firewall treats as payment tools when the options name none: our own agent's checkout,
// and the order tools of the payment platform's agent toolkit (create_order places and captures
// an order at once, pay_order captures one).
export const DEFAULT_PAYMENT_TOOLS: readonly string[] = ["checkout", "create_order", "pay_order"];

// A mandate to be built in the run: the builder drafts it from the person's request and the
// person confirms it, which is what puts the confirmation on the timeline before the agent shops.
export interface MandateRequest {
  builder: MandateBuilder;
  person: Person;
  // Defaults to the request the catalog source recorded for the run.
  requestText?: string;
  // Defaults to the arena's.
  vocabulary?: Vocabulary;
}

export interface FirewallOptions {
  log: EventLog;
  // The run: its trusted catalog and the checkout it reports. See CatalogSource.
  source: CatalogSource;
  // The raw adapter. The firewall wraps it in recordPayments, so every call is on the payments lane.
  payments: PaymentAdapter;
  // The buyer's saved wallet, which the hold is authorized against.
  vaultId: string;
  // The mandate the person confirmed, or a request to build one in the run. Without one, Gate 0
  // blocks the cart: there is nothing to check it against.
  mandate?: LockedMandate | MandateRequest;
  // How much of the review tree runs. Defaults to the whole tree, which needs `gates`.
  config?: FirewallConfig;
  // The model gates, built for the run's catalog (the extractor's vocabulary is the catalog's).
  // Model clients are the caller's to configure, from the app's own settings.
  gates?: (catalog: Catalog) => ReviewGates;
  // The tools that pay. Only these are guarded: a payment tool that isn't named here is passed
  // through untouched and pays at once.
  paymentTools?: readonly string[];
  // The event that caused the payment tool call, usually the model turn that asked for it. Defaults
  // to the run's first event.
  causedBy?: () => string;
  // Enforcement's clock, for the hold's honour period.
  now?: () => Date;
}

// The options that don't depend on the run, for code that starts the run itself.
export type FirewallSettings = Omit<
  FirewallOptions,
  "log" | "source" | "payments" | "vaultId" | "causedBy"
>;

export interface HeldOrder {
  orderId: string;
  authorizationId: string;
  amountCents: number;
  // The authorization's status as the platform reported it: CREATED is a hold.
  status: string;
}

export interface Settlement {
  review: ReviewRun;
  enforcement: Enforcement;
}

export class FirewallConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirewallConfigError";
  }
}

export interface Firewall {
  readonly runId: string;
  readonly config: FirewallConfig;
  // The order the agent's payment tool held, or null before it has.
  readonly held: HeldOrder | null;
  // What building the mandate cost, in US dollars (nothing for one that was supplied).
  readonly mandateCostUsd: number;
  // Locks the mandate in the run (building it with the person first if a request was given), or
  // does nothing when there is none. Safe to call again. Call it before the agent shops so the
  // confirmation sits ahead of everything the agent does; a guarded tool calls it before holding.
  ready(): Promise<LockedMandate | null>;
  // The same tools, with each payment tool guarded and every other tool as it was.
  wrap<T extends ToolSet>(tools: T): T;
  // The review tree over the held cart, then what its verdict calls for: approve captures and pays
  // out, block voids, escalate leaves the hold for a person. Null when nothing was held.
  settle(): Promise<Settlement | null>;
  // The two halves of settle, for a caller that wants to look in between.
  review(): Promise<ReviewRun>;
  enforce(): Promise<Enforcement>;
  // The person's decision on an escalated cart.
  decide(decision: "approve" | "reject", note?: string): Promise<Enforcement>;
}

// A refusal the agent is told about and can act on, as a real shop would show it.
const isRefusal = (error: unknown): error is Error =>
  error instanceof ShopError || error instanceof PaymentError;

const isMandateRequest = (m: LockedMandate | MandateRequest): m is MandateRequest => "builder" in m;

export function createFirewall(options: FirewallOptions): Firewall {
  const { log, source, payments: rawPayments } = options;
  const { runId, scenarioId } = source;
  const config = options.config ?? "full";
  if (config === "full" && !options.gates) {
    throw new FirewallConfigError(
      'The "full" firewall needs its model gates (the `gates` option), or a lighter `config`',
    );
  }
  const paymentTools = new Set(options.paymentTools ?? DEFAULT_PAYMENT_TOOLS);
  const causedBy = options.causedBy ?? (() => firstEventId());
  const firstEventId = (): string => {
    const first = log.listRun(runId)[0];
    if (!first) throw new FirewallConfigError(`Run ${runId} has no events yet`);
    return first.eventId;
  };

  let mandateCostUsd = 0;
  let locking: Promise<LockedMandate | null> | null = null;

  async function lock(): Promise<LockedMandate | null> {
    const wanted = options.mandate;
    if (!wanted) return null;
    if (isMandateRequest(wanted)) {
      const requestText = wanted.requestText ?? source.request;
      if (requestText === undefined) {
        throw new FirewallConfigError(
          "The mandate request names no text and the catalog source recorded no request",
        );
      }
      const built = await buildMandate(
        { log, runId, scenarioId, vocabulary: wanted.vocabulary ?? arenaVocabulary() },
        { builder: wanted.builder, requestText, person: wanted.person },
      );
      mandateCostUsd = built.drafted.result.costUsd;
      if (built.outcome !== "locked") {
        throw new Error(`The mandate wasn't locked: ${built.reason ?? "the draft was rejected"}`);
      }
      return built.mandate;
    }
    // The person confirmed it somewhere else: check it is intact and put it in the run, where the
    // gates look for it. One the person confirmed in this very run (the web app's mandate step
    // locks it before the agent starts) is already there, and isn't written twice.
    const verified = verifyMandate(wanted);
    if (!verified.intact) {
      throw new FirewallConfigError(
        `The mandate can't be trusted: ${verified.problems.join("; ")}`,
      );
    }
    const alreadyLocked = log
      .listRun(runId)
      .some(
        (e) =>
          e.lane === "mandate" &&
          e.type === "mandate_locked" &&
          (e.payload as { mandate?: { hash?: unknown } } | null)?.mandate?.hash ===
            verified.mandate.hash,
      );
    if (alreadyLocked) return verified.mandate;
    log.append({
      runId,
      scenarioId,
      lane: "mandate",
      type: "mandate_locked",
      provenance: "system",
      parentId: firstEventId(),
      payload: { mandate: verified.mandate, source: "supplied" },
    });
    return verified.mandate;
  }

  const ready = (): Promise<LockedMandate | null> => {
    locking ??= lock().catch((error) => {
      locking = null;
      throw error;
    });
    return locking;
  };

  // Set before the first await, so two payment calls asked for in one turn can't both go through.
  // A call that fails leaves it free to try again.
  let holding = false;
  let held: HeldOrder | null = null;
  let reply: Record<string, unknown> | null = null;

  const appendAgent = (type: string, parentId: string, payload: unknown) =>
    log.append({
      runId,
      scenarioId,
      lane: "agent",
      type,
      provenance: "system",
      parentId,
      payload,
    });

  // The cart becomes one order, held against the buyer's wallet. Every payment call points at the
  // checkout event, which points at the agent's tool call.
  async function place(callEventId: string, input: unknown) {
    if (held) {
      // The toolkit's pay_order follows its create_order with the order's ID: both are one
      // purchase to the agent, so asking to pay the order that is held gets the held answer.
      if (reply && (input as { orderId?: unknown } | null)?.orderId === held.orderId) return reply;
      throw new ShopError("invalid", "An order has already been placed in this run");
    }
    if (holding) throw new ShopError("invalid", "A checkout is already under way");
    holding = true;
    try {
      await ready();
      const { draft, eventId } = source.checkout(callEventId);
      const payments = recordPayments(rawPayments, log, () => ({
        runId,
        scenarioId,
        parentId: eventId,
      }));
      const order = await payments.createOrder(
        orderInputFromDraft(draft, { runId, invoiceId: `inv_${eventId}` }),
      );
      // Holds the cart; capturing it, or not, is the review's decision.
      const hold = await payments.authorizeOrder(order.orderId, { vaultId: options.vaultId });
      held = {
        orderId: order.orderId,
        authorizationId: hold.authorizationId,
        amountCents: hold.amountCents,
        status: hold.status,
      };
      reply = {
        status: "pending_review",
        message: "Your order is placed and pending review.",
        orderId: held.orderId,
        totalCents: draft.totalCents,
        lines: draft.lines.map((l) => ({
          listingId: l.listingId,
          productName: l.productName,
          quantity: l.quantity,
          totalCents: l.totalCents,
        })),
      };
      return reply;
    } finally {
      holding = false;
    }
  }

  // Records the tool call, holds the cart with the call's event as the parent of whatever it
  // causes, and records what came back. A refusal goes back to the model as an error it can read.
  async function guardedCall(toolName: string, toolCallId: string, input: unknown) {
    const call = appendAgent("tool_call", causedBy(), { toolCallId, toolName, input });
    try {
      const output = await place(call.eventId, input);
      appendAgent("tool_result", call.eventId, { toolCallId, toolName, output });
      return output;
    } catch (error) {
      const output = { error: error instanceof Error ? error.message : String(error) };
      appendAgent("tool_result", call.eventId, { toolCallId, toolName, output });
      // Anything else is a bug or an outage, not something the shop would show the agent.
      if (!isRefusal(error)) throw error;
      return output;
    }
  }

  const review = async (): Promise<ReviewRun> =>
    runReview(runId, {
      log,
      config,
      ...(config === "full" && options.gates && { gates: options.gates(source.catalog()) }),
    });

  // One settlement per firewall: asking again gives the first answer instead of reviewing the cart
  // a second time, which would spend the model gates again. A settlement that failed can be tried
  // again, and what was done before the failure isn't repeated (enforcement works from the log).
  let settling: Promise<Settlement> | null = null;

  const enforceOptions = () => ({
    log,
    payments: rawPayments,
    ...(options.now && { now: options.now }),
  });

  return {
    runId,
    config,
    get held() {
      return held;
    },
    get mandateCostUsd() {
      return mandateCostUsd;
    },
    ready,

    wrap<T extends ToolSet>(tools: T): T {
      const wrapped: Record<string, unknown> = {};
      for (const [name, original] of Object.entries(tools)) {
        if (!paymentTools.has(name)) {
          wrapped[name] = original;
          continue;
        }
        // The guarded tool answers in its own shape, so the original's output schema is dropped.
        const { outputSchema: _dropped, ...rest } = original as unknown as Record<string, unknown>;
        wrapped[name] = {
          ...rest,
          execute: (input: unknown, execution: { toolCallId: string }) =>
            guardedCall(name, execution.toolCallId, input),
        };
      }
      return wrapped as T;
    },

    review,
    enforce: () => enforceReview(runId, enforceOptions()),
    async settle() {
      if (!held) return null;
      settling ??= (async () => {
        const reviewed = await review();
        return { review: reviewed, enforcement: await enforceReview(runId, enforceOptions()) };
      })().catch((error) => {
        settling = null;
        throw error;
      });
      return settling;
    },
    decide: (decision, note) =>
      decideEscalation(runId, decision, { ...enforceOptions(), ...(note && { note }) }),
  };
}
