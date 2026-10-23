import type { OrderDraft } from "@firewall/arena";
import { unitAmountCents } from "@firewall/payments";
import { describe, expect, it } from "vitest";
import { orderInputFromDraft } from "./order.js";

const line = (
  overrides: Partial<OrderDraft["lines"][number]> = {},
): OrderDraft["lines"][number] => ({
  listingId: "lst_1",
  sku: "kb_1",
  productName: "Halvard TKL",
  sellerId: "sel_1",
  payeeKey: "seller_1",
  unitPriceCents: 9999,
  quantity: 1,
  discountCents: 0,
  totalCents: 9999,
  ...overrides,
});

const draft = (lines: OrderDraft["lines"]): OrderDraft => ({
  currency: "USD",
  lines,
  totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
});

const ids = { runId: "run_1", invoiceId: "inv_1" };

describe("orderInputFromDraft", () => {
  it("makes one purchase unit with a line item per cart line, each naming its seller", () => {
    const input = orderInputFromDraft(
      draft([
        line(),
        line({
          listingId: "lst_2",
          payeeKey: "attacker_1",
          quantity: 2,
          totalCents: 1000,
          unitPriceCents: 500,
        }),
      ]),
      ids,
    );
    expect(input).toMatchObject({ currency: "USD", customId: "run_1", invoiceId: "inv_1" });
    expect(input.purchaseUnits).toHaveLength(1);
    expect(input.purchaseUnits[0]?.items).toEqual([
      {
        lineId: "lst_1",
        payeeKey: "seller_1",
        name: "Halvard TKL",
        quantity: 1,
        unitAmountCents: 9999,
      },
      {
        lineId: "lst_2",
        payeeKey: "attacker_1",
        name: "Halvard TKL",
        quantity: 2,
        unitAmountCents: 500,
      },
    ]);
  });

  it("keeps a discounted line whole when its total splits evenly", () => {
    // Three at $10.00 with 15% off: $25.50, which is $8.50 each.
    const even = line({ quantity: 3, unitPriceCents: 1000, discountCents: 450, totalCents: 2550 });
    const [unit] = orderInputFromDraft(draft([even]), ids).purchaseUnits;
    expect(unit?.items.map((i) => [i.lineId, i.quantity, i.unitAmountCents])).toEqual([
      ["lst_1", 3, 850],
    ]);
  });

  it("charges a discounted line's total exactly, splitting off the leftover cents", () => {
    // Three at $9.99 with 25% off: $22.48, which three equal unit prices can't make.
    const odd = line({ quantity: 3, unitPriceCents: 999, discountCents: 749, totalCents: 2248 });
    const [unit] = orderInputFromDraft(draft([odd]), ids).purchaseUnits;
    if (!unit) throw new Error("no unit");
    expect(unit.items.map((i) => [i.lineId, i.payeeKey, i.quantity, i.unitAmountCents])).toEqual([
      ["lst_1", "seller_1", 2, 749],
      ["lst_1-b", "seller_1", 1, 750],
    ]);
    expect(unitAmountCents(unit)).toBe(2248);
  });

  it("cuts a long product name to the platform's limit", () => {
    const input = orderInputFromDraft(draft([line({ productName: "x".repeat(300) })]), ids);
    expect(input.purchaseUnits[0]?.items[0]?.name).toHaveLength(127);
  });
});
