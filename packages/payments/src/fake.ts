import { checkPayable, unitAmountCents } from "./rules.js";
import {
  type Authorization,
  type AuthorizeOptions,
  type Capture,
  type CreateOrderInput,
  type Order,
  type PaymentAdapter,
  PaymentError,
  type Payout,
  type PayoutInput,
  type Refund,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// The platform honours a capture in full for 3 days, and keeps an authorization for 29.
export const HONOR_DAYS = 3;
export const VALID_DAYS = 29;
// The firewall platform's own account: the payee on every order, and who payouts come from.
export const PLATFORM_ACCOUNT = "FAKE-PLATFORM";

export interface FakeOptions {
  // Payee key to merchant ID. A key with no entry is refused, as an unknown payee would be.
  merchants?: Record<string, string>;
  clock?: () => Date;
}

export interface FakePaymentAdapter extends PaymentAdapter {
  // The buyer following the approval link. The sandbox does this with a scripted sandbox login;
  // here it's immediate.
  approve(orderId: string): Promise<void>;
  // Money each account holds, in cents: the platform's captures less its refunds and payouts,
  // and each merchant's payouts received. Accounts with nothing are left out.
  balances(): Record<string, number>;
}

export const DEFAULT_MERCHANTS: Record<string, string> = Object.fromEntries(
  ["seller_1", "seller_2", "seller_3", "seller_4", "attacker_1", "attacker_2"].map((key) => [
    key,
    `FAKE-${key.toUpperCase()}`,
  ]),
);

// The payment platform, in memory. Faithful to the states, refusals and time limits the firewall
// depends on, and to nothing else.
export function createFakePaymentAdapter(options: FakeOptions = {}): FakePaymentAdapter {
  const merchants = options.merchants ?? DEFAULT_MERCHANTS;
  const clock = options.clock ?? (() => new Date());
  const orders = new Map<string, Order>();
  const authorizations = new Map<string, Authorization>();
  const captures = new Map<string, Capture>();
  const refunds = new Map<string, Refund[]>();
  const payouts = new Map<string, Payout>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++sequence).padStart(6, "0")}`;

  const find = <T>(map: Map<string, T>, id: string, what: string): T => {
    const found = map.get(id);
    if (!found) throw new PaymentError("not_found", `No ${what} "${id}"`);
    return found;
  };

  const positiveCents = (value: number, what: string) => {
    if (!Number.isInteger(value) || value <= 0) {
      throw new PaymentError(
        "invalid_request",
        `${what} must be a positive whole number of cents, got ${value}`,
      );
    }
  };

  const merchantFor = (payeeKey: string): string => {
    const merchantId = merchants[payeeKey];
    if (!merchantId) throw new PaymentError("invalid_request", `Unknown payee "${payeeKey}"`);
    return merchantId;
  };

  const refundedCents = (captureId: string) =>
    (refunds.get(captureId) ?? []).reduce((sum, r) => sum + r.amountCents, 0);

  // An authorization past its validity period reads as expired, whatever it was before.
  const current = (authorization: Authorization): Authorization => {
    if (authorization.status === "CREATED" && clock() >= new Date(authorization.expiresAt)) {
      authorization.status = "EXPIRED";
    }
    return authorization;
  };

  const holdable = (authorization: Authorization, action: string) => {
    current(authorization);
    if (authorization.status === "EXPIRED") {
      throw new PaymentError("expired", `Authorization ${authorization.authorizationId} expired`);
    }
    if (authorization.status !== "CREATED") {
      throw new PaymentError(
        "invalid_state",
        `Can't ${action} authorization ${authorization.authorizationId}: it is ${authorization.status}`,
      );
    }
  };

  const newAuthorization = (
    from: Pick<Authorization, "orderId" | "amountCents">,
  ): Authorization => {
    const now = clock();
    const authorization: Authorization = {
      ...from,
      authorizationId: nextId("AUTH"),
      status: "CREATED",
      createdAt: now.toISOString(),
      honorUntil: new Date(now.getTime() + HONOR_DAYS * DAY_MS).toISOString(),
      expiresAt: new Date(now.getTime() + VALID_DAYS * DAY_MS).toISOString(),
    };
    authorizations.set(authorization.authorizationId, authorization);
    return authorization;
  };

  const copy = <T>(value: T): T => structuredClone(value);

  return {
    async createOrder(input: CreateOrderInput) {
      const units = input.purchaseUnits;
      if (units.length > 1) {
        throw new PaymentError(
          "unsupported_intent",
          `An authorize order holds one purchase unit, got ${units.length}`,
        );
      }
      const [unit] = units;
      if (!unit || unit.items.length === 0) {
        throw new PaymentError("invalid_request", "An order needs one purchase unit with items");
      }
      if (new Set(unit.items.map((item) => item.lineId)).size !== unit.items.length) {
        throw new PaymentError("invalid_request", "Line IDs must be unique within the order");
      }
      for (const item of unit.items) {
        positiveCents(item.unitAmountCents, "A line's unit amount");
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
          throw new PaymentError("invalid_request", `Quantity must be a whole number from 1`);
        }
        merchantFor(item.payeeKey);
      }
      const orderId = nextId("ORDER");
      const order: Order = {
        orderId,
        status: "PAYER_ACTION_REQUIRED",
        currency: input.currency,
        purchaseUnits: [
          {
            referenceId: unit.referenceId,
            description: unit.description,
            amountCents: unitAmountCents(unit),
            items: unit.items.map((item) => ({ ...item })),
          },
        ],
        customId: input.customId,
        invoiceId: input.invoiceId,
        approveUrl: `https://fake.payments.test/approve/${orderId}`,
        createdAt: clock().toISOString(),
      };
      orders.set(orderId, order);
      return copy(order);
    },

    async approve(orderId) {
      const order = find(orders, orderId, "order");
      if (order.status !== "PAYER_ACTION_REQUIRED") {
        throw new PaymentError("invalid_state", `Order ${orderId} doesn't need approval`);
      }
      order.status = "APPROVED";
      order.approveUrl = null;
    },

    async getOrder(orderId) {
      return copy(find(orders, orderId, "order"));
    },

    async authorizeOrder(orderId, options: AuthorizeOptions = {}) {
      const order = find(orders, orderId, "order");
      // A saved wallet is the buyer's approval, given in advance.
      if (order.status === "PAYER_ACTION_REQUIRED" && !options.vaultId) {
        throw new PaymentError("payer_action_required", `Order ${orderId} isn't approved yet`);
      }
      if (order.status !== "APPROVED" && order.status !== "PAYER_ACTION_REQUIRED") {
        throw new PaymentError("invalid_state", `Order ${orderId} is ${order.status}`);
      }
      order.status = "COMPLETED";
      order.approveUrl = null;
      const amountCents = order.purchaseUnits.reduce((sum, unit) => sum + unit.amountCents, 0);
      return copy(newAuthorization({ orderId, amountCents }));
    },

    async getAuthorization(authorizationId) {
      return copy(current(find(authorizations, authorizationId, "authorization")));
    },

    async captureAuthorization(authorizationId) {
      const authorization = find(authorizations, authorizationId, "authorization");
      holdable(authorization, "capture");
      authorization.status = "CAPTURED";
      const capture: Capture = {
        captureId: nextId("CAPTURE"),
        authorizationId,
        amountCents: authorization.amountCents,
        status: "COMPLETED",
        createdAt: clock().toISOString(),
      };
      captures.set(capture.captureId, capture);
      return copy(capture);
    },

    async voidAuthorization(authorizationId) {
      const authorization = find(authorizations, authorizationId, "authorization");
      holdable(authorization, "void");
      authorization.status = "VOIDED";
      return copy(authorization);
    },

    async reauthorize(authorizationId) {
      const authorization = find(authorizations, authorizationId, "authorization");
      holdable(authorization, "reauthorize");
      if (clock() < new Date(authorization.honorUntil)) {
        throw new PaymentError(
          "too_early",
          `Authorization ${authorizationId} is still in its honour period`,
        );
      }
      authorization.status = "VOIDED";
      return copy(newAuthorization(authorization));
    },

    async refundCapture(captureId, amountCents) {
      const capture = find(captures, captureId, "capture");
      const remaining = capture.amountCents - refundedCents(captureId);
      const amount = amountCents ?? remaining;
      if (remaining === 0) {
        throw new PaymentError("over_refund", `Capture ${captureId} is fully refunded`);
      }
      positiveCents(amount, "A refund");
      if (amount > remaining) {
        throw new PaymentError(
          "over_refund",
          `Can refund at most ${remaining} cents of capture ${captureId}`,
        );
      }
      const refund: Refund = {
        refundId: nextId("REFUND"),
        captureId,
        amountCents: amount,
        status: "COMPLETED",
        createdAt: clock().toISOString(),
      };
      refunds.set(captureId, [...(refunds.get(captureId) ?? []), refund]);
      capture.status = amount === remaining ? "REFUNDED" : "PARTIALLY_REFUNDED";
      return copy(refund);
    },

    async createPayout(input: PayoutInput) {
      const merchantId = merchantFor(input.payeeKey);
      positiveCents(input.amountCents, "A payout");
      const capture = find(captures, input.captureId, "capture");
      checkPayable(capture, input.amountCents);
      for (const payout of payouts.values()) {
        if (payout.captureId === input.captureId && payout.payeeKey === input.payeeKey) {
          throw new PaymentError(
            "duplicate",
            `${input.payeeKey} was already paid out of capture ${input.captureId}`,
          );
        }
      }
      const payout: Payout = {
        payoutId: nextId("PAYOUT"),
        captureId: input.captureId,
        payeeKey: input.payeeKey,
        merchantId,
        amountCents: input.amountCents,
        status: "PENDING",
        createdAt: clock().toISOString(),
      };
      payouts.set(payout.payoutId, payout);
      return copy(payout);
    },

    // A payout lands by the time anyone looks again, like the sandbox's does within a minute.
    async getPayout(payoutId) {
      const payout = find(payouts, payoutId, "payout");
      payout.status = "SUCCESS";
      return copy(payout);
    },

    balances() {
      const totals: Record<string, number> = {};
      const add = (account: string, cents: number) => {
        totals[account] = (totals[account] ?? 0) + cents;
      };
      for (const capture of captures.values()) {
        add(PLATFORM_ACCOUNT, capture.amountCents - refundedCents(capture.captureId));
      }
      for (const payout of payouts.values()) {
        if (payout.status !== "SUCCESS") continue;
        add(PLATFORM_ACCOUNT, -payout.amountCents);
        add(payout.merchantId, payout.amountCents);
      }
      return Object.fromEntries(Object.entries(totals).filter(([, cents]) => cents !== 0));
    },
  };
}
