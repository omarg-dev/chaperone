import { type Capture, type LineItemInput, PaymentError } from "./types.js";

// Rules both adapters apply the same way, so they can't drift apart.

// What a purchase unit's lines add up to.
export function unitAmountCents(unit: { items: LineItemInput[] }): number {
  return unit.items.reduce((sum, item) => sum + item.quantity * item.unitAmountCents, 0);
}

// A payout needs a capture the platform still holds, and can't be more than it. Both adapters
// check this against the capture as the platform reports it. What the payouts of one capture add
// up to is the caller's to keep right (from the order's lines), not the platform's: it only sees
// its own balance.
export function checkPayable(capture: Capture, amountCents: number) {
  if (capture.status !== "COMPLETED" && capture.status !== "PARTIALLY_REFUNDED") {
    throw new PaymentError(
      "invalid_state",
      `Can't pay out of capture ${capture.captureId}: it is ${capture.status}`,
    );
  }
  if (amountCents > capture.amountCents) {
    throw new PaymentError(
      "invalid_request",
      `A payout of ${amountCents} cents is more than capture ${capture.captureId} took`,
    );
  }
}
