// The payment platform's order and authorization flow, as the firewall uses it. Two adapters
// implement it: the in-memory fake (fake.ts) for development and the eval matrix, and the sandbox
// adapter (step 7) for real runs. Both pass the same contract tests (contract.ts).
//
// The flow: an order is created with intent "authorize" and one purchase unit per seller, each
// naming its payee. Once the buyer has approved it (a saved wallet approves at once; otherwise
// the buyer follows an approval link), authorizing it holds the money without moving it. The
// review tree then captures each authorization (approve), voids it (block), or leaves it held
// (escalate), reauthorizing if a person takes longer than the hold lasts.

// Which sandbox merchant account a purchase unit pays, by key. Each adapter maps keys to real
// merchant IDs from its own configuration.
export type PayeeKey = string;

export interface PurchaseUnitInput {
  // Unique within the order; the order draft's listing ID works.
  referenceId: string;
  payeeKey: PayeeKey;
  description: string;
  amountCents: number;
}

export interface CreateOrderInput {
  currency: "USD";
  purchaseUnits: PurchaseUnitInput[];
  // Carried on the order so every platform object links back to the event log.
  customId: string;
  invoiceId: string;
  // A saved buyer wallet approves the order at once. Without one, the order waits for the buyer
  // to follow its approval link.
  vaultId?: string;
}

export type OrderStatus = "PAYER_ACTION_REQUIRED" | "APPROVED" | "COMPLETED" | "VOIDED";

export interface PurchaseUnit extends PurchaseUnitInput {
  merchantId: string;
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

export type AuthorizationStatus = "CREATED" | "CAPTURED" | "VOIDED" | "EXPIRED";

export interface Authorization {
  authorizationId: string;
  orderId: string;
  referenceId: string;
  merchantId: string;
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
  merchantId: string;
  amountCents: number;
  status: "COMPLETED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  createdAt: string;
}

export interface Refund {
  refundId: string;
  captureId: string;
  amountCents: number;
  createdAt: string;
}

export type PaymentErrorCode =
  | "not_found"
  | "invalid_request"
  | "payer_action_required"
  | "invalid_state"
  | "expired"
  | "too_early"
  | "over_refund";

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
  // Holds the money: one authorization per purchase unit.
  authorizeOrder(orderId: string): Promise<Authorization[]>;
  getAuthorization(authorizationId: string): Promise<Authorization>;
  captureAuthorization(authorizationId: string): Promise<Capture>;
  voidAuthorization(authorizationId: string): Promise<Authorization>;
  // A fresh hold for the same amount, once the honour period is over. The old one is voided.
  reauthorize(authorizationId: string): Promise<Authorization>;
  // The whole capture, or part of it.
  refundCapture(captureId: string, amountCents?: number): Promise<Refund>;
}
