import { describe, expect, it } from "vitest";
import { splitPayouts } from "./rules.js";
import type { LineItemInput } from "./types.js";

const line = (payeeKey: string, unitAmountCents: number, quantity = 1): LineItemInput => ({
  lineId: `${payeeKey}_${unitAmountCents}_${quantity}`,
  payeeKey,
  name: "x",
  quantity,
  unitAmountCents,
});

const sum = (shares: { amountCents: number }[]) => shares.reduce((s, x) => s + x.amountCents, 0);

describe("splitPayouts", () => {
  it("gives a one-seller cart the whole net amount", () => {
    expect(splitPayouts(144, [line("seller_1", 100), line("seller_1", 50, 2)])).toEqual([
      { payeeKey: "seller_1", amountCents: 144 },
    ]);
  });

  it("splits evenly between sellers with equal parts of the cart", () => {
    expect(splitPayouts(144, [line("seller_1", 100), line("seller_2", 50, 2)])).toEqual([
      { payeeKey: "seller_1", amountCents: 72 },
      { payeeKey: "seller_2", amountCents: 72 },
    ]);
  });

  it("gives the rounding remainder to the seller of the largest line", () => {
    // 900 × 333/1000 = 299.7 twice, and 900 × 334/1000 = 300.6: 898 allotted, 2 left over.
    const shares = splitPayouts(900, [
      line("seller_1", 333),
      line("seller_2", 333),
      line("seller_3", 334),
    ]);
    expect(shares).toEqual([
      { payeeKey: "seller_1", amountCents: 299 },
      { payeeKey: "seller_2", amountCents: 299 },
      { payeeKey: "seller_3", amountCents: 302 },
    ]);
  });

  it("compares lines, not sellers, when it picks who gets the remainder", () => {
    // seller_1 has more of the cart (three lines, 300 in all), but seller_2 has the largest
    // single line (251). 500 × 300/551 = 272.2 and 500 × 251/551 = 227.8: 499 allotted, 1 left.
    const shares = splitPayouts(500, [
      line("seller_1", 99),
      line("seller_1", 100),
      line("seller_1", 101),
      line("seller_2", 251),
    ]);
    expect(shares).toEqual([
      { payeeKey: "seller_1", amountCents: 272 },
      { payeeKey: "seller_2", amountCents: 228 },
    ]);
  });

  it("gives the remainder to the first of two equally large lines", () => {
    expect(splitPayouts(101, [line("seller_2", 100), line("seller_1", 100)])).toEqual([
      { payeeKey: "seller_2", amountCents: 51 },
      { payeeKey: "seller_1", amountCents: 50 },
    ]);
  });

  it("always adds up to the net amount exactly", () => {
    const carts = [
      [line("seller_1", 1999), line("seller_2", 1), line("attacker_1", 7, 3)],
      [line("seller_1", 333, 3), line("seller_2", 1000), line("seller_3", 1)],
      [line("seller_4", 12345), line("seller_1", 6789, 2)],
    ];
    for (const items of carts) {
      const total = items.reduce((s, i) => s + i.quantity * i.unitAmountCents, 0);
      for (const net of [0, 1, Math.floor(total * 0.9651) - 49, total]) {
        expect(sum(splitPayouts(net, items))).toBe(net);
      }
    }
  });

  it("leaves out a seller whose share rounds to nothing", () => {
    expect(splitPayouts(50, [line("seller_1", 1000), line("seller_2", 1)])).toEqual([
      { payeeKey: "seller_1", amountCents: 50 },
    ]);
  });

  it.each([
    ["an empty cart", 10, []],
    ["a net amount that isn't whole cents", 1.5, [line("seller_1", 100)]],
    ["a net amount above the cart", 101, [line("seller_1", 100)]],
  ] as const)("refuses %s", (_, net, items) => {
    expect(() => splitPayouts(net, [...items])).toThrow();
  });
});
