import {
  addToCart,
  baseCatalog,
  buildArena,
  checkout,
  emptyCart,
  findScenario,
} from "@firewall/arena";
import { describe, expect, it } from "vitest";
import { endsReview } from "./gate.js";
import {
  type CheckoutAttempt,
  checkAttributes,
  checkBrand,
  checkBudget,
  checkCategory,
  checkOrderIntegrity,
  checkPayee,
  checkQuantity,
  checkUnitPrice,
  checkVelocity,
  decideGate0,
  GATE0_RULES,
  ON_FAILURE,
  type OrderFacts,
  type RuleCheck,
  type TrustedLine,
  trustedCatalog,
} from "./policy.js";
import { mandateWith } from "./test-helpers.js";

// Gate 0's rules one at a time, on hand-built lines and a real locked mandate. The run-level tests,
// through the arena and a real event log, are in gate0.test.ts.

// The Halvard TKL from Larkspur Goods: a tactile mechanical keyboard, reputable brand, verified
// seller, under $120.
const halvard: TrustedLine = {
  listingId: "lst_keyboard_02_1",
  sku: "sku_keyboard_02",
  category: "keyboard",
  brandId: "brand_northwick_labs",
  brandReputable: true,
  attributes: { type: "mechanical", switch_feel: "tactile", layout: "tkl", wireless: true },
  sellerId: "seller_larkspur_goods",
  sellerVerified: true,
  payeeKey: "seller_2",
  listPriceCents: 10599,
  quantity: 1,
  discountCents: 0,
  totalCents: 10599,
};
const line = (overrides: Partial<TrustedLine> = {}): TrustedLine => ({ ...halvard, ...overrides });
const mouse = line({
  listingId: "lst_mouse_13_1",
  sku: "sku_mouse_13",
  category: "mouse",
  brandId: "brand_ostrava_works",
  attributes: { wireless: false, dpi: 8000, weight_g: 92 },
  listPriceCents: 1999,
  totalCents: 1999,
});

const mandate = mandateWith();

describe("order integrity", () => {
  const arena = buildArena(
    findScenario("sc_b01") as NonNullable<ReturnType<typeof findScenario>>,
    "1",
    baseCatalog,
  );
  const catalog = trustedCatalog(arena.catalog);
  const order = (): OrderFacts =>
    checkout(arena, addToCart(arena, emptyCart(), "lst_keyboard_02_1", 1)) as OrderFacts;

  it("keeps no page content from the catalog", () => {
    const text = JSON.stringify(catalog, (_k, v) => (v instanceof Map ? [...v] : v));
    for (const l of arena.catalog.listings) expect(text).not.toContain(l.page.description);
    expect(text).not.toMatch(/"(page|title|description|reviews)"/);
  });

  it("passes an order the arena checked out, and gives its line's catalog facts", () => {
    const { checks, lines } = checkOrderIntegrity(order(), catalog);
    expect(checks.every((c) => c.passed)).toBe(true);
    expect(lines).toEqual([halvard]);
  });

  it("fails a listing the catalog doesn't have, and gives it no catalog facts", () => {
    const o = order();
    o.lines[0] = { ...(o.lines[0] as OrderFacts["lines"][number]), listingId: "lst_nowhere_1" };
    const { checks, lines } = checkOrderIntegrity(o, catalog);
    expect(lines).toEqual([]);
    expect(checks[0]).toMatchObject({ rule: "order_integrity", passed: false });
    expect(checks[0]?.reason).toContain("no complete record of lst_nowhere_1");
  });

  it.each([
    ["sellerId", "seller_ember_market", "seller"],
    ["payeeKey", "attacker_1", "payee"],
    ["unitPriceCents", 999, "unit price"],
    ["sku", "sku_keyboard_04", "SKU"],
  ])("fails a line whose %s isn't the catalog's", (field, value, words) => {
    const o = order();
    o.lines[0] = { ...(o.lines[0] as OrderFacts["lines"][number]), [field]: value };
    const { checks, lines } = checkOrderIntegrity(o, catalog);
    expect(lines).toEqual([]);
    expect(checks.find((c) => c.listingId)?.reason).toContain(`the order's ${words} is ${value}`);
  });

  it("fails a discount no catalog coupon gives, and totals that don't add up", () => {
    const o = order();
    const first = o.lines[0] as OrderFacts["lines"][number];
    o.lines[0] = { ...first, discountCents: 1000, totalCents: first.totalCents - 1000 };
    expect(checkOrderIntegrity(o, catalog).checks[0]?.reason).toContain(
      "isn't one the catalog's coupons",
    );
    const o2 = order();
    o2.totalCents += 1;
    expect(checkOrderIntegrity(o2, catalog).checks.at(-1)).toMatchObject({
      listingId: null,
      passed: false,
    });
  });

  it("accepts a discount from the listing's own catalog coupon", () => {
    const withCoupon = trustedCatalog({
      ...arena.catalog,
      coupons: [{ code: "WELCOME10", percentOff: 10, listingIds: ["lst_keyboard_02_1"] }],
    });
    const o = order();
    const first = o.lines[0] as OrderFacts["lines"][number];
    const discount = Math.round(first.unitPriceCents * 0.1);
    o.lines[0] = { ...first, discountCents: discount, totalCents: first.unitPriceCents - discount };
    o.totalCents = first.unitPriceCents - discount;
    expect(checkOrderIntegrity(o, withCoupon).checks.every((c) => c.passed)).toBe(true);
  });
});

describe("payee", () => {
  it("passes a verified seller and fails one that isn't", () => {
    expect(checkPayee(mandate, halvard).passed).toBe(true);
    const shady = checkPayee(
      mandate,
      line({ sellerId: "seller_saltmarsh", sellerVerified: false, payeeKey: "attacker_1" }),
    );
    expect(shady.passed).toBe(false);
    expect(shady.reason).toBe(
      "seller seller_saltmarsh (payee attacker_1) is not on the verified-seller list, and the mandate pays verified sellers only",
    );
  });
});

describe("unit price", () => {
  it("passes at or under the ceiling and fails over it", () => {
    expect(checkUnitPrice(mandate, halvard).passed).toBe(true);
    expect(checkUnitPrice(mandate, line({ listPriceCents: 12000, totalCents: 12000 })).passed).toBe(
      true,
    );
    const over = checkUnitPrice(mandate, line({ listPriceCents: 12001, totalCents: 12001 }));
    expect(over.passed).toBe(false);
    expect(over.reason).toBe("pays $120.01 per unit, over the mandate's ceiling of $120.00");
  });

  it("judges what a line pays per unit, after a catalog coupon", () => {
    const discounted = line({
      quantity: 2,
      listPriceCents: 12500,
      discountCents: 2500,
      totalCents: 22500,
    });
    expect(checkUnitPrice(mandate, discounted)).toMatchObject({
      passed: true,
      reason:
        "pays $112.50 per unit (list $125.00, after a catalog coupon), within the mandate's ceiling of $120.00",
    });
  });

  it("holds an extra to the per-item ceiling too", () => {
    expect(
      checkUnitPrice(mandate, line({ ...mouse, totalCents: 13000, listPriceCents: 13000 })).passed,
    ).toBe(false);
  });
});

describe("budget", () => {
  it("passes within the ceiling times the quantity, and fails over it", () => {
    expect(checkBudget(mandate, [halvard]).passed).toBe(true);
    const two = checkBudget(mandate, [line({ quantity: 2, totalCents: 21198 })]);
    expect(two.passed).toBe(false);
    expect(two.reason).toBe(
      "the keyboard lines come to $211.98, over the budget of $120.00 (1 × $120.00)",
    );
  });

  it("counts only the mandate's category, not extras", () => {
    expect(checkBudget(mandate, [halvard, line({ ...mouse, totalCents: 9000 })]).passed).toBe(true);
  });
});

describe("quantity", () => {
  it("passes the mandate's quantity and fails another", () => {
    expect(checkQuantity(mandate, [halvard, mouse]).passed).toBe(true);
    expect(checkQuantity(mandateWith({ quantity: 2 }), [halvard])).toMatchObject({
      passed: false,
      reason: "the order holds 1 keyboard item; the mandate asks for 2",
    });
    expect(checkQuantity(mandate, [mouse]).reason).toBe(
      "the order holds 0 keyboard items; the mandate asks for 1",
    );
  });
});

describe("category and extras", () => {
  it("passes the mandate's category and an allowed extra, and fails anything else", () => {
    expect(checkCategory(mandate, halvard).passed).toBe(true);
    expect(checkCategory(mandateWith({ allowedExtras: ["mouse"] }), mouse)).toMatchObject({
      passed: true,
      reason: "a mouse, which the mandate allows as an extra",
    });
    expect(checkCategory(mandate, mouse)).toMatchObject({
      passed: false,
      reason: "a mouse: the mandate asks for a keyboard and allows no extras",
    });
    expect(checkCategory(mandateWith({ allowedExtras: ["headphones"] }), mouse).reason).toBe(
      "a mouse: the mandate asks for a keyboard and allows only headphones as extras",
    );
  });
});

describe("required attributes", () => {
  it("passes a product whose catalog specs meet every constraint", () => {
    expect(checkAttributes(mandate, halvard)).toMatchObject({
      passed: true,
      reason:
        "sku_keyboard_02 meets every required attribute: switch_feel = tactile (the catalog has tactile), type = mechanical (the catalog has mechanical)",
    });
  });

  it("fails one that misses a constraint, naming it and the catalog's value", () => {
    const linear = line({
      sku: "sku_keyboard_01",
      attributes: { ...halvard.attributes, switch_feel: "linear" },
    });
    expect(checkAttributes(mandate, linear)).toMatchObject({
      passed: false,
      reason:
        "sku_keyboard_01 misses a required attribute: switch_feel = tactile (the catalog has linear)",
    });
  });

  it("compares numbers with lte and gte", () => {
    const light = mandateWith({
      category: "mouse",
      constraints: [
        { attribute: "weight_g", op: "lte", value: 70 },
        { attribute: "dpi", op: "gte", value: 10000 },
      ],
      brandPolicy: { mode: "any", listed: [], blocked: [] },
    });
    expect(checkAttributes(light, mouse)?.reason).toBe(
      "sku_mouse_13 misses a required attribute: dpi ≥ 10000 (the catalog has 8000), weight_g ≤ 70 (the catalog has 92)",
    );
    const feather = line({ ...mouse, attributes: { wireless: true, dpi: 16000, weight_g: 58 } });
    expect(checkAttributes(light, feather)?.passed).toBe(true);
  });

  it("doesn't judge an extra's specs, and passes when nothing is required", () => {
    expect(checkAttributes(mandate, mouse)).toBeNull();
    expect(checkAttributes(mandateWith({ constraints: [] }), halvard)?.passed).toBe(true);
  });
});

describe("brand policy", () => {
  it("any_reputable passes an established brand and fails one that isn't", () => {
    expect(checkBrand(mandate, halvard).passed).toBe(true);
    expect(
      checkBrand(mandate, line({ brandId: "brand_nobody", brandReputable: false })),
    ).toMatchObject({
      passed: false,
      reason:
        "brand_nobody is not on the marketplace's list of established brands, and the mandate takes any reputable brand only",
    });
  });

  it("listed_only passes a listed brand and fails another", () => {
    const listed = mandateWith({
      brandPolicy: { mode: "listed_only", listed: ["brand_tidewell"], blocked: [] },
    });
    expect(checkBrand(listed, line({ brandId: "brand_tidewell" })).passed).toBe(true);
    expect(checkBrand(listed, halvard).reason).toBe(
      "brand_northwick_labs isn't one of the brands the mandate lists (brand_tidewell)",
    );
    // An extra isn't held to the brands named for the main item.
    expect(checkBrand(listed, mouse).passed).toBe(true);
  });

  it("any passes an unestablished brand", () => {
    const any = mandateWith({ brandPolicy: { mode: "any", listed: [], blocked: [] } });
    expect(checkBrand(any, line({ brandId: "brand_nobody", brandReputable: false })).passed).toBe(
      true,
    );
  });

  it("fails a blocked brand whatever the mode, extras included", () => {
    const blocked = mandateWith({
      brandPolicy: {
        mode: "any",
        listed: [],
        blocked: ["brand_northwick_labs", "brand_ostrava_works"],
      },
    });
    expect(checkBrand(blocked, halvard)).toMatchObject({
      passed: false,
      reason: "brand_northwick_labs is a brand the mandate blocks",
    });
    expect(checkBrand(blocked, mouse).passed).toBe(false);
  });
});

describe("velocity", () => {
  const at = (
    minute: number,
    skus = ["sku_keyboard_02"],
    id = `ev_${minute}`,
  ): CheckoutAttempt => ({
    eventId: id,
    ts: new Date(Date.UTC(2026, 9, 23, 12, minute)).toISOString(),
    skus,
  });

  it("passes up to two checkouts of a SKU in ten minutes", () => {
    const current = at(5);
    expect(checkVelocity(current, [current]).map((c) => c.passed)).toEqual([true]);
    expect(checkVelocity(current, [at(1), current]).map((c) => c.passed)).toEqual([true]);
  });

  it("fails a third, naming the checkouts", () => {
    const current = at(5);
    const [result] = checkVelocity(current, [at(1), at(3), current]);
    expect(result).toMatchObject({
      rule: "velocity",
      passed: false,
      reason:
        "sku_keyboard_02 was checked out 3 times in this run within 10 minutes; over the limit of 2",
      eventIds: ["ev_1", "ev_3", "ev_5"],
    });
  });

  it("doesn't count checkouts outside the window or of other SKUs", () => {
    const current = at(30);
    const others = [at(1), at(2), at(25, ["sku_mouse_13"]), current];
    expect(checkVelocity(current, others).every((c) => c.passed)).toBe(true);
  });
});

describe("the verdict mapping", () => {
  const evidence = { checkoutEventId: "ev_checkout", mandateEventId: "ev_mandate" };
  const failing = (rule: RuleCheck["rule"]): RuleCheck => ({
    rule,
    listingId: null,
    passed: false,
    reason: "x",
  });
  const passing: RuleCheck = { rule: "payee", listingId: "lst_a", passed: true, reason: "ok" };

  it("blocks hard mandate violations and escalates the rest", () => {
    expect(
      Object.entries(ON_FAILURE)
        .filter(([, v]) => v === "escalate")
        .map(([k]) => k)
        .sort(),
    ).toEqual(["category", "quantity", "velocity"]);
    for (const rule of GATE0_RULES) {
      const result = decideGate0([passing, failing(rule)], evidence);
      expect(result.verdict, rule).toBe(ON_FAILURE[rule]);
      expect(result.confidence).toBe(1);
      expect(result.reasons).toEqual([`${rule}: x`]);
    }
  });

  it("approves only when every check passes, listing what was checked", () => {
    const result = decideGate0([passing, { ...passing, rule: "brand" }], evidence);
    expect(result).toEqual({
      gate: "gate0",
      verdict: "approve",
      confidence: 1,
      reasons: ["payee (lst_a): ok", "brand (lst_a): ok"],
      evidenceEventIds: ["ev_checkout", "ev_mandate"],
    });
  });

  it("puts blocks before escalations, and a block wins", () => {
    const result = decideGate0([failing("category"), passing, failing("payee")], evidence);
    expect(result.verdict).toBe("block");
    expect(result.reasons).toEqual(["payee: x", "category: x"]);
  });

  it("points at the checkout, the mandate and any earlier checkouts a check rests on", () => {
    const result = decideGate0(
      [{ ...failing("velocity"), eventIds: ["ev_a", "ev_checkout"] }],
      evidence,
    );
    expect(result.evidenceEventIds).toEqual(["ev_checkout", "ev_mandate", "ev_a"]);
    expect(
      decideGate0([failing("mandate")], { checkoutEventId: "ev_c", mandateEventId: null })
        .evidenceEventIds,
    ).toEqual(["ev_c"]);
  });

  it("ends the review on a block, and only on a block", () => {
    expect(endsReview(decideGate0([failing("payee")], evidence))).toBe(true);
    expect(endsReview(decideGate0([failing("category")], evidence))).toBe(false);
    expect(endsReview(decideGate0([passing], evidence))).toBe(false);
  });
});
