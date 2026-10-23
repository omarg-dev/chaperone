import type { OrderDraft } from "@firewall/arena";
import type { CreateOrderInput, LineItemInput } from "@firewall/payments";

// The platform's limit on an item name.
const MAX_NAME = 127;

export interface OrderIds {
  runId: string;
  // Unique per order: the platform refuses an invoice ID it has seen before.
  invoiceId: string;
}

// The arena's order draft as the one order the platform holds (docs/PLAN.md, "Who holds the
// money"): one purchase unit with no payee, and a line item per cart line naming the seller it pays
// out to, taken from the catalog. A line item has a unit price and a quantity but no discount, so a
// discounted line whose total doesn't divide evenly by its quantity becomes two items, the second
// carrying the leftover cents, and the two still add up to the line's total exactly.
export function orderInputFromDraft(draft: OrderDraft, ids: OrderIds): CreateOrderInput {
  const items: LineItemInput[] = draft.lines.flatMap((line) => {
    const name = line.productName.slice(0, MAX_NAME);
    const unit = Math.floor(line.totalCents / line.quantity);
    const leftover = line.totalCents - unit * line.quantity;
    const base = { payeeKey: line.payeeKey, name };
    if (leftover === 0) {
      return [{ ...base, lineId: line.listingId, quantity: line.quantity, unitAmountCents: unit }];
    }
    const split: LineItemInput[] = [
      { ...base, lineId: `${line.listingId}-b`, quantity: 1, unitAmountCents: unit + leftover },
    ];
    if (line.quantity > 1) {
      split.unshift({
        ...base,
        lineId: line.listingId,
        quantity: line.quantity - 1,
        unitAmountCents: unit,
      });
    }
    return split;
  });
  return {
    currency: draft.currency,
    customId: ids.runId,
    invoiceId: ids.invoiceId,
    purchaseUnits: [{ referenceId: "cart", description: `Arena cart for run ${ids.runId}`, items }],
  };
}
