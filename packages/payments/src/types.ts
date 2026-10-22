// The payment platform's order, authorization and payout flow, as the firewall uses it. Two
// adapters implement it: the in-memory fake (fake.ts) for development and the eval matrix, and the
// sandbox adapter (sandbox.ts) for real runs. Both pass the same contract tests (contract.ts).
//
// The firewall platform is the payee on every order (docs/PLAN.md, "Who holds the money"). A cart
// is one order with one purchase unit and no payee field, so the money goes to the platform's own
// account, the one the app's credentials belong to. Each line item says which seller it is for,
// which is what the payouts read and what Gate 0 checks.
//
// The flow: create the order, then authorize it, which holds the whole cart without moving it.
// Authorizing needs the buyer's approval: a saved wallet gives it at once, otherwise the buyer
// follows the order's approval link first. The review tree then captures the hold (approve) and
// pays each seller its share with a payout, voids it (block), or leaves it held (escalate),
// reauthorizing if a person takes longer than the hold lasts. A refund is of the platform's own
// capture; getting money back from a seller already paid out is a separate matter.

// Which sandbox merchant account a line pays out to, by key (`seller_1` ... `attacker_2`). Each
// adapter maps keys to real merchant IDs from its own configuration.
export type PayeeKey = string;

export interface LineItemInput {
  // Unique within the order; the cart line's listing ID works.
  lineId: string;
  // The seller this line pays out to once the hold is captured.
  payeeKey: PayeeKey;
  name: string;
  // A whole number, at least 1.
  quantity: number;
  unitAmountCents: number;
}

export interface PurchaseUnitInput {
  referenceId: string;
  description: string;
  // The unit's amount is the sum of its lines; there's no separate total to disagree with them.
  items: LineItemInput[];
}

export interface CreateOrderInput {
  currency: "USD";
  // Always exactly one: an authorize order holds one purchase unit, and the platform refuses more
  // (`unsupported_intent`). It's a list because that's what the platform takes, so the refusal is
  // the platform's and the contract can show the fake refuses the same.
  purchaseUnits: PurchaseUnitInput[];
  // Carried on the order so every platform object links back to the event log.
  customId: string;
  invoiceId: string;
}

export type OrderStatus = "PAYER_ACTION_REQUIRED" | "APPROVED" | "COMPLETED" | "VOIDED";

export interface LineItem extends LineItemInput {}

export interface PurchaseUnit {
  referenceId: string;
  description: string;
  amountCents: number;
  items: LineItem[];
}

export interface Order {
  orderId: string;
  status: OrderStatus;
  currency: "USD";
  purchaseUnits: PurchaseUnit[];
  customId: string;
  invoiceId: string;
  // Where the buyer approves the order, while it needs them to.
  approveUrl: string | null;
  createdAt: string;
}

export interface AuthorizeOptions {
  // A saved buyer wallet, which approves the order as it's authorized, with no link to follow.
  vaultId?: string;
}

// PENDING and DENIED come from the platform's own review of a payment; the fake never makes them.
export type AuthorizationStatus =
  | "CREATED"
  | "PENDING"
  | "CAPTURED"
  | "DENIED"
  | "VOIDED"
  | "EXPIRED";

export interface Authorization {
  authorizationId: string;
  orderId: string;
  amountCents: number;
  status: AuthorizationStatus;
  createdAt: string;
  // Until then a capture is honoured in full; after it, reauthorize first.
  honorUntil: string;
  // After this the authorization can no longer be captured or reauthorized.
  expiresAt: string;
}

export interface Capture {
  captureId: string;
  authorizationId: string;
  amountCents: number;
  status: "COMPLETED" | "PENDING" | "PARTIALLY_REFUNDED" | "REFUNDED" | "DECLINED" | "FAILED";
  createdAt: string;
}

export interface Refund {
  refundId: string;
  captureId: string;
  amountCents: number;
  status: "COMPLETED" | "PENDING" | "CANCELLED" | "FAILED";
  createdAt: string;
}

export interface PayoutInput {
  // The platform's capture the money comes from. A seller is paid at most once per capture, so a
  // retried payout can't pay twice.
  captureId: string;
  payeeKey: PayeeKey;
  amountCents: number;
}

// PENDING until the money reaches the seller's account, which takes the sandbox under a minute.
// FAILED covers every way it doesn't arrive (refused, returned, unclaimed, reversed).
export type PayoutStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface Payout {
  payoutId: string;
  captureId: string;
  payeeKey: PayeeKey;
  merchantId: string;
  amountCents: number;
  status: PayoutStatus;
  createdAt: string;
}

export type PaymentErrorCode =
  | "not_found"
  | "invalid_request"
  | "unsupported_intent"
  | "payer_action_required"
  | "invalid_state"
  | "expired"
  | "too_early"
  | "over_refund"
  | "duplicate"
  | "platform_error";

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface PaymentAdapter {
  createOrder(input: CreateOrderInput): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
  // Holds the money: one authorization for the whole order.
  authorizeOrder(orderId: string, options?: AuthorizeOptions): Promise<Authorization>;
  getAuthorization(authorizationId: string): Promise<Authorization>;
  captureAuthorization(authorizationId: string): Promise<Capture>;
  voidAuthorization(authorizationId: string): Promise<Authorization>;
  // A fresh hold for the same amount, once the honour period is over, and only once per hold. It
  // keeps the original's expiry. The old one is voided.
  reauthorize(authorizationId: string): Promise<Authorization>;
  // The whole capture, or part of it.
  refundCapture(captureId: string, amountCents?: number): Promise<Refund>;
  // Pays a seller its share of a capture, from the platform's balance.
  createPayout(input: PayoutInput): Promise<Payout>;
  getPayout(payoutId: string): Promise<Payout>;
}
