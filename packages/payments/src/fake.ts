import {
  type Authorization,
  type Capture,
  type CreateOrderInput,
  type Order,
  type PaymentAdapter,
  PaymentError,
  type Refund,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// The platform honours a capture in full for 3 days, and keeps an authorization for 29.
export const HONOR_DAYS = 3;
export const VALID_DAYS = 29;
// An order holds at most 10 purchase units.
export const MAX_PURCHASE_UNITS = 10;

export interface FakeOptions {
  // Payee key to merchant ID. A key with no entry is refused, as an unknown payee would be.
  merchants?: Record<string, string>;
  clock?: () => Date;
}

export interface FakePaymentAdapter extends PaymentAdapter {
  // The buyer following the approval link. The sandbox adapter does this with a scripted
  // sandbox login; here it's immediate.
  approve(orderId: string): Promise<void>;
  // Money each merchant has received: captures less refunds, in cents.
  balances(): Record<string, number>;
}

export const DEFAULT_MERCHANTS: Record<string, string> = Object.fromEntries(
  ["seller_1", "seller_2", "seller_3", "seller_4", "attacker_1", "attacker_2"].map((key) => [
    key,
    `FAKE-${key.toUpperCase()}`,
  ]),
);

// The payment platform, in memory. Faithful to the states and time limits the firewall depends
// on, and to nothing else.
export function createFakePaymentAdapter(options: FakeOptions = {}): FakePaymentAdapter {
  const merchants = options.merchants ?? DEFAULT_MERCHANTS;
  const clock = options.clock ?? (() => new Date());
  const orders = new Map<string, Order>();
  const authorizations = new Map<string, Authorization>();
  const captures = new Map<string, Capture>();
  const refunds = new Map<string, Refund[]>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++sequence).padStart(6, "0")}`;

  const find = <T>(map: Map<string, T>, id: string, what: string): T => {
    const found = map.get(id);
    if (!found) throw new PaymentError("not_found", `No ${what} "${id}"`);
    return found;
  };

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
    from: Pick<Authorization, "orderId" | "referenceId" | "merchantId" | "amountCents">,
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
      if (units.length === 0 || units.length > MAX_PURCHASE_UNITS) {
        throw new PaymentError(
          "invalid_request",
          `An order needs 1 to ${MAX_PURCHASE_UNITS} purchase units, got ${units.length}`,
        );
      }
      if (new Set(units.map((u) => u.referenceId)).size !== units.length) {
        throw new PaymentError("invalid_request", "Purchase unit reference IDs must be unique");
      }
      const purchaseUnits = units.map((unit) => {
        if (!Number.isInteger(unit.amountCents) || unit.amountCents <= 0) {
          throw new PaymentError(
            "invalid_request",
            `Amount must be a positive whole number of cents, got ${unit.amountCents}`,
          );
        }
        const merchantId = merchants[unit.payeeKey];
        if (!merchantId) {
          throw new PaymentError("invalid_request", `Unknown payee "${unit.payeeKey}"`);
        }
        return { ...unit, merchantId };
      });
      const orderId = nextId("ORDER");
      const order: Order = {
        orderId,
        status: input.vaultId ? "APPROVED" : "PAYER_ACTION_REQUIRED",
        currency: input.currency,
        purchaseUnits,
        customId: input.customId,
        invoiceId: input.invoiceId,
        approveUrl: input.vaultId ? null : `https://fake.payments.test/approve/${orderId}`,
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

    async authorizeOrder(orderId) {
      const order = find(orders, orderId, "order");
      if (order.status === "PAYER_ACTION_REQUIRED") {
        throw new PaymentError("payer_action_required", `Order ${orderId} isn't approved yet`);
      }
      if (order.status !== "APPROVED") {
        throw new PaymentError("invalid_state", `Order ${orderId} is ${order.status}`);
      }
      order.status = "COMPLETED";
      return order.purchaseUnits.map((unit) =>
        copy(
          newAuthorization({
            orderId,
            referenceId: unit.referenceId,
            merchantId: unit.merchantId,
            amountCents: unit.amountCents,
          }),
        ),
      );
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
        merchantId: authorization.merchantId,
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
      const refunded = (refunds.get(captureId) ?? []).reduce((sum, r) => sum + r.amountCents, 0);
      const remaining = capture.amountCents - refunded;
      const amount = amountCents ?? remaining;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new PaymentError("invalid_request", `Refund must be positive cents, got ${amount}`);
      }
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
        createdAt: clock().toISOString(),
      };
      refunds.set(captureId, [...(refunds.get(captureId) ?? []), refund]);
      capture.status = amount === remaining ? "REFUNDED" : "PARTIALLY_REFUNDED";
      return copy(refund);
    },

    balances() {
      const totals: Record<string, number> = {};
      for (const capture of captures.values()) {
        const refunded = (refunds.get(capture.captureId) ?? []).reduce(
          (sum, r) => sum + r.amountCents,
          0,
        );
        totals[capture.merchantId] =
          (totals[capture.merchantId] ?? 0) + capture.amountCents - refunded;
      }
      return totals;
    },
  };
}
