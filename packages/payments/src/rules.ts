import { type Capture, type LineItemInput, type PayeeKey, PaymentError } from "./types.js";

// Rules both adapters apply the same way, so they can't drift apart.

// What a purchase unit's lines add up to.
export function unitAmountCents(unit: { items: LineItemInput[] }): number {
  return unit.items.reduce((sum, item) => sum + item.quantity * item.unitAmountCents, 0);
}

// A payout needs a capture the platform still holds, and can't be more than the platform
// received from it after fees. Both adapters check this against the capture as the platform
// reports it. What the payouts of one capture add
// up to is the caller's to keep right (from the order's lines), not the platform's: it only sees
// its own balance.
export function checkPayable(capture: Capture, amountCents: number) {
  if (capture.status !== "COMPLETED" && capture.status !== "PARTIALLY_REFUNDED") {
    throw new PaymentError(
      "invalid_state",
      `Can't pay out of capture ${capture.captureId}: it is ${capture.status}`,
    );
  }
  if (capture.netAmountCents === null || amountCents > capture.netAmountCents) {
    throw new PaymentError(
      "invalid_request",
      `A payout of ${amountCents} cents is more than the platform received from capture ${capture.captureId}`,
    );
  }
}

export interface PayoutShare {
  payeeKey: PayeeKey;
  amountCents: number;
}

// How a capture is split between the sellers (docs/PLAN.md, "Fees"): each seller gets its share
// of what the platform actually received, net of the platform's fees, in proportion to its lines'
// part of the cart. Shares are rounded down, and what rounding leaves goes to the seller of the
// largest line (the first one, on a tie), so the shares add up to the net exactly. The result is in
// the order sellers first appear in the cart; a seller whose share rounds to nothing is left out,
// since a payout must be at least a cent.
export function splitPayouts(netAmountCents: number, items: LineItemInput[]): PayoutShare[] {
  if (!Number.isInteger(netAmountCents) || netAmountCents < 0) {
    throw new PaymentError(
      "invalid_request",
      `A net amount must be whole cents, got ${netAmountCents}`,
    );
  }
  const lineTotal = (item: LineItemInput) => item.quantity * item.unitAmountCents;
  const cartTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  if (items.length === 0 || cartTotal <= 0) {
    throw new PaymentError("invalid_request", "Can't split a payment over an empty cart");
  }
  if (netAmountCents > cartTotal) {
    throw new PaymentError(
      "invalid_request",
      `The net amount (${netAmountCents} cents) is more than the cart (${cartTotal} cents)`,
    );
  }
  const totals = new Map<PayeeKey, number>();
  for (const item of items) {
    totals.set(item.payeeKey, (totals.get(item.payeeKey) ?? 0) + lineTotal(item));
  }
  const shares = new Map<PayeeKey, number>();
  for (const [payeeKey, total] of totals) {
    shares.set(payeeKey, Math.floor((netAmountCents * total) / cartTotal));
  }
  const largest = items.reduce((best, item) => (lineTotal(item) > lineTotal(best) ? item : best));
  const allotted = [...shares.values()].reduce((sum, cents) => sum + cents, 0);
  shares.set(largest.payeeKey, (shares.get(largest.payeeKey) ?? 0) + netAmountCents - allotted);
  return [...shares]
    .filter(([, amountCents]) => amountCents > 0)
    .map(([payeeKey, amountCents]) => ({ payeeKey, amountCents }));
}
