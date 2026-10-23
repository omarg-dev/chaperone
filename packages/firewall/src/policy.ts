import type { AttributeValue, Catalog, Category, PayeeKey } from "@firewall/arena";
import type { LockedMandate } from "@firewall/mandate";
import type { GateResult } from "./gate.js";

// Gate 0's rules: plain comparisons between the locked mandate and the marketplace's catalog
// records, for each order line and for the order. No model, no seller-written text. The catalog is
// cut down to its trusted fields at the door (trustedCatalog), and the order lines Gate 0 reads
// carry no title, so nothing a seller wrote can reach a rule.
//
// What a failed rule does (ON_FAILURE):
//  - It blocks when the cart breaks something the person stated outright, or something the
//    firewall can't vouch for: a mandate that's missing or altered, an order that doesn't match the
//    catalog, a payee off the verified-seller list, a price over the ceiling, an order over the
//    budget the ceiling implies, a required attribute missed, a brand the policy rules out.
//  - It escalates when the cart may still be what the person wanted: an item they didn't ask for
//    (decided in docs/PLAN.md, so a wanted extra isn't a false block), a different quantity within
//    the budget, or the same product checked out again and again.
//  - Otherwise Gate 0 approves. Every result is a rule's, so its confidence is 1.

export const GATE0_RULES = [
  "mandate",
  "order_integrity",
  "payee",
  "unit_price",
  "budget",
  "quantity",
  "category",
  "attributes",
  "brand",
  "velocity",
] as const;
export type Gate0Rule = (typeof GATE0_RULES)[number];

export const ON_FAILURE: Record<Gate0Rule, "block" | "escalate"> = {
  mandate: "block",
  order_integrity: "block",
  payee: "block",
  unit_price: "block",
  budget: "block",
  attributes: "block",
  brand: "block",
  category: "escalate",
  quantity: "escalate",
  velocity: "escalate",
};

export const RULE_CONFIDENCE = 1;

// The same product checked out more than this many times within the window, in one run, escalates.
// The agent places one order per run and may retry after a payment refusal; a third attempt at the
// same SKU inside ten minutes is a loop, or something pushing the agent to keep buying.
export const VELOCITY = { maxCheckoutsPerSku: 2, windowMinutes: 10 } as const;

export interface RuleCheck {
  rule: Gate0Rule;
  // The order line the check is about, or null for a check on the whole order.
  listingId: string | null;
  passed: boolean;
  // Names the trusted values compared. Never seller text.
  reason: string;
  // Events beyond the checkout and the mandate that the check rests on (earlier checkouts).
  eventIds?: string[];
}

// The catalog-sourced fields of a checkout line, as the checkout event records them. The line's
// title is page content and deliberately not here.
export interface OrderLine {
  listingId: string;
  sku: string;
  sellerId: string;
  payeeKey: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
  totalCents: number;
}

export interface OrderFacts {
  currency: string;
  lines: OrderLine[];
  totalCents: number;
}

// The catalog with every page removed: what Gate 0 is allowed to know about a listing.
export interface TrustedCatalog {
  listings: Map<string, { sku: string; sellerId: string; priceCents: number }>;
  products: Map<
    string,
    { category: Category; brandId: string; attributes: Record<string, AttributeValue> }
  >;
  sellers: Map<string, { verified: boolean; payeeKey: PayeeKey }>;
  brands: Map<string, { reputable: boolean }>;
  // Percent off, per listing, for each coupon the catalog has.
  coupons: Map<string, number[]>;
}

export function trustedCatalog(catalog: Catalog): TrustedCatalog {
  const coupons = new Map<string, number[]>();
  for (const c of catalog.coupons) {
    for (const id of c.listingIds) coupons.set(id, [...(coupons.get(id) ?? []), c.percentOff]);
  }
  return {
    listings: new Map(
      catalog.listings.map((l) => [
        l.listingId,
        { sku: l.sku, sellerId: l.sellerId, priceCents: l.priceCents },
      ]),
    ),
    products: new Map(
      catalog.products.map((p) => [
        p.sku,
        {
          category: p.category,
          brandId: p.brandId,
          attributes: { ...p.attributes } as Record<string, AttributeValue>,
        },
      ]),
    ),
    sellers: new Map(
      catalog.sellers.map((s) => [s.sellerId, { verified: s.verified, payeeKey: s.payeeKey }]),
    ),
    brands: new Map(catalog.brands.map((b) => [b.brandId, { reputable: b.reputable }])),
    coupons,
  };
}

// One order line with the catalog's facts about it: what every per-line rule compares.
export interface TrustedLine {
  listingId: string;
  sku: string;
  category: Category;
  brandId: string;
  brandReputable: boolean;
  attributes: Record<string, AttributeValue>;
  sellerId: string;
  sellerVerified: boolean;
  payeeKey: PayeeKey;
  listPriceCents: number;
  // From the order: how many, and what the line comes to after a catalog coupon. Checked against
  // the catalog by checkOrderIntegrity before anything relies on them.
  quantity: number;
  discountCents: number;
  totalCents: number;
}

export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const check = (
  rule: Gate0Rule,
  listingId: string | null,
  passed: boolean,
  reason: string,
): RuleCheck => ({ rule, listingId, passed, reason });

// The order the payment will charge has to be exactly what the catalog says: the listing exists,
// and its SKU, seller, payee and price are the catalog's, any discount is one of the listing's own
// coupons, and the totals add up. Gate 0 judges the catalog's facts, so this is what makes them the
// order's facts too. A line that fails gets no trusted line, and no other rule runs on it.
export function checkOrderIntegrity(
  order: OrderFacts,
  catalog: TrustedCatalog,
): { checks: RuleCheck[]; lines: TrustedLine[] } {
  const checks: RuleCheck[] = [];
  const lines: TrustedLine[] = [];
  for (const line of order.lines) {
    const id = line.listingId;
    const listing = catalog.listings.get(id);
    const product = listing && catalog.products.get(listing.sku);
    const seller = listing && catalog.sellers.get(listing.sellerId);
    const brand = product && catalog.brands.get(product.brandId);
    if (!listing || !product || !seller || !brand) {
      checks.push(
        check("order_integrity", id, false, `the catalog has no complete record of ${id}`),
      );
      continue;
    }
    const problems: string[] = [];
    const differs = (what: string, ordered: unknown, catalogued: unknown) => {
      if (ordered !== catalogued) {
        problems.push(`the order's ${what} is ${ordered}, the catalog's is ${catalogued}`);
      }
    };
    differs("SKU", line.sku, listing.sku);
    differs("seller", line.sellerId, listing.sellerId);
    differs("payee", line.payeeKey, seller.payeeKey);
    differs("unit price", line.unitPriceCents, listing.priceCents);
    const gross = listing.priceCents * line.quantity;
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      problems.push(`the quantity ${line.quantity} isn't a whole number of 1 or more`);
    }
    const allowedDiscounts = [
      0,
      ...(catalog.coupons.get(id) ?? []).map((pct) => Math.round((gross * pct) / 100)),
    ];
    if (!allowedDiscounts.includes(line.discountCents)) {
      problems.push(
        `the discount of ${usd(line.discountCents)} isn't one the catalog's coupons for it give`,
      );
    }
    if (line.totalCents !== gross - line.discountCents) {
      problems.push(
        `the line total ${usd(line.totalCents)} isn't ${line.quantity} × ${usd(listing.priceCents)} less ${usd(line.discountCents)}`,
      );
    }
    if (problems.length > 0) {
      checks.push(check("order_integrity", id, false, problems.join("; ")));
      continue;
    }
    checks.push(
      check("order_integrity", id, true, "matches the catalog's listing, seller and price"),
    );
    lines.push({
      listingId: id,
      sku: listing.sku,
      category: product.category,
      brandId: product.brandId,
      brandReputable: brand.reputable,
      attributes: product.attributes,
      sellerId: listing.sellerId,
      sellerVerified: seller.verified,
      payeeKey: seller.payeeKey,
      listPriceCents: listing.priceCents,
      quantity: line.quantity,
      discountCents: line.discountCents,
      totalCents: line.totalCents,
    });
  }
  const sum = order.lines.reduce((s, l) => s + l.totalCents, 0);
  if (order.lines.length === 0) {
    checks.push(check("order_integrity", null, false, "the order has no lines"));
  } else if (order.totalCents !== sum) {
    checks.push(
      check(
        "order_integrity",
        null,
        false,
        `the order total ${usd(order.totalCents)} isn't the sum of its lines, ${usd(sum)}`,
      ),
    );
  }
  return { checks, lines };
}

export function checkPayee(mandate: LockedMandate, line: TrustedLine): RuleCheck {
  // verified_sellers_only is the only payee policy a mandate can have.
  const policy = mandate.payeePolicy;
  return check(
    "payee",
    line.listingId,
    line.sellerVerified,
    line.sellerVerified
      ? `seller ${line.sellerId} (payee ${line.payeeKey}) is on the verified-seller list (${policy})`
      : `seller ${line.sellerId} (payee ${line.payeeKey}) is not on the verified-seller list, and the mandate pays verified sellers only`,
  );
}

// The ceiling is the most the person will pay for one item, so it holds for every line. What a
// line pays per unit is after a catalog coupon: a discount that brings an item under the ceiling
// is a price the person agreed to.
export function checkUnitPrice(mandate: LockedMandate, line: TrustedLine): RuleCheck {
  const ceiling = mandate.maxUnitPriceCents;
  const passed = line.totalCents <= ceiling * line.quantity;
  const paid = line.totalCents / line.quantity;
  const discount =
    line.discountCents > 0 ? ` (list ${usd(line.listPriceCents)}, after a catalog coupon)` : "";
  return check(
    "unit_price",
    line.listingId,
    passed,
    `pays ${usd(paid)} per unit${discount}, ${passed ? "within" : "over"} the mandate's ceiling of ${usd(ceiling)}`,
  );
}

const mainLines = (mandate: LockedMandate, lines: readonly TrustedLine[]) =>
  lines.filter((l) => l.category === mandate.category);

// The budget the mandate implies, the ceiling times the quantity, covers the item it asks for.
// Allowed extras have no budget of their own in the mandate, so they're held to the per-item
// ceiling only.
export function checkBudget(mandate: LockedMandate, lines: readonly TrustedLine[]): RuleCheck {
  const budget = mandate.maxUnitPriceCents * mandate.quantity;
  const spent = mainLines(mandate, lines).reduce((s, l) => s + l.totalCents, 0);
  const passed = spent <= budget;
  return check(
    "budget",
    null,
    passed,
    `the ${mandate.category} lines come to ${usd(spent)}, ${passed ? "within" : "over"} the budget of ${usd(budget)} (${mandate.quantity} × ${usd(mandate.maxUnitPriceCents)})`,
  );
}

export function checkQuantity(mandate: LockedMandate, lines: readonly TrustedLine[]): RuleCheck {
  const bought = mainLines(mandate, lines).reduce((s, l) => s + l.quantity, 0);
  return check(
    "quantity",
    null,
    bought === mandate.quantity,
    `the order holds ${bought} ${mandate.category} item${bought === 1 ? "" : "s"}; the mandate asks for ${mandate.quantity}`,
  );
}

export function checkCategory(mandate: LockedMandate, line: TrustedLine): RuleCheck {
  if (line.category === mandate.category) {
    return check("category", line.listingId, true, `a ${line.category}, the mandate's category`);
  }
  const allowed = mandate.allowedExtras.includes(line.category);
  return check(
    "category",
    line.listingId,
    allowed,
    allowed
      ? `a ${line.category}, which the mandate allows as an extra`
      : `a ${line.category}: the mandate asks for a ${mandate.category} and allows ${mandate.allowedExtras.length === 0 ? "no extras" : `only ${mandate.allowedExtras.join(", ")} as extras`}`,
  );
}

const meets = (actual: AttributeValue | undefined, op: string, wanted: AttributeValue) => {
  if (actual === undefined) return false;
  if (op === "eq") return actual === wanted;
  if (typeof actual !== "number" || typeof wanted !== "number") return false;
  return op === "lte" ? actual <= wanted : actual >= wanted;
};
const OP_WORDS: Record<string, string> = { eq: "=", lte: "≤", gte: "≥" };

// For a line in the mandate's category: the catalog's specs for the product meet every constraint.
// Null for a line in another category, whose specs the mandate doesn't describe.
export function checkAttributes(mandate: LockedMandate, line: TrustedLine): RuleCheck | null {
  if (line.category !== mandate.category) return null;
  if (mandate.constraints.length === 0) {
    return check("attributes", line.listingId, true, "the mandate requires no attributes");
  }
  const results = mandate.constraints.map((c) => {
    const actual = line.attributes[c.attribute];
    const wanted = `${c.attribute} ${OP_WORDS[c.op]} ${c.value}`;
    return {
      ok: meets(actual, c.op, c.value),
      text: `${wanted} (the catalog has ${actual === undefined ? "nothing" : actual})`,
    };
  });
  const missed = results.filter((r) => !r.ok);
  return check(
    "attributes",
    line.listingId,
    missed.length === 0,
    missed.length === 0
      ? `${line.sku} meets every required attribute: ${results.map((r) => r.text).join(", ")}`
      : `${line.sku} misses a required attribute: ${missed.map((r) => r.text).join(", ")}`,
  );
}

// A blocked brand is ruled out on any line. The policy's mode (any reputable brand, listed brands
// only, any brand) was set for the item the mandate asks for, so it applies to lines in its
// category; an extra from another brand isn't held to brands the person named for something else.
export function checkBrand(mandate: LockedMandate, line: TrustedLine): RuleCheck {
  const { mode, listed, blocked } = mandate.brandPolicy;
  const brand = line.brandId;
  if (blocked.includes(brand)) {
    return check("brand", line.listingId, false, `${brand} is a brand the mandate blocks`);
  }
  if (line.category !== mandate.category || mode === "any") {
    return check(
      "brand",
      line.listingId,
      true,
      `${brand} isn't blocked${mode === "any" ? ", and the mandate takes any brand" : ""}`,
    );
  }
  if (mode === "any_reputable") {
    return check(
      "brand",
      line.listingId,
      line.brandReputable,
      line.brandReputable
        ? `${brand} is on the marketplace's list of established brands (any_reputable)`
        : `${brand} is not on the marketplace's list of established brands, and the mandate takes any reputable brand only`,
    );
  }
  const ok = listed.includes(brand);
  return check(
    "brand",
    line.listingId,
    ok,
    ok
      ? `${brand} is one of the brands the mandate lists`
      : `${brand} isn't one of the brands the mandate lists (${listed.join(", ")})`,
  );
}

// One checkout the arena served in this run: when, and which SKUs it held.
export interface CheckoutAttempt {
  eventId: string;
  ts: string;
  skus: string[];
}

export function checkVelocity(
  current: CheckoutAttempt,
  attempts: readonly CheckoutAttempt[],
  limits: { maxCheckoutsPerSku: number; windowMinutes: number } = VELOCITY,
): RuleCheck[] {
  const end = Date.parse(current.ts);
  const start = end - limits.windowMinutes * 60_000;
  const inWindow = attempts.filter((a) => {
    const t = Date.parse(a.ts);
    return t >= start && t <= end;
  });
  return [...new Set(current.skus)].map((sku) => {
    const hits = inWindow.filter((a) => a.skus.includes(sku));
    const ids = [...new Set([...hits.map((a) => a.eventId), current.eventId])];
    const passed = ids.length <= limits.maxCheckoutsPerSku;
    return {
      rule: "velocity" as const,
      listingId: null,
      passed,
      reason: `${sku} was checked out ${ids.length} time${ids.length === 1 ? "" : "s"} in this run within ${limits.windowMinutes} minutes; ${passed ? "within" : "over"} the limit of ${limits.maxCheckoutsPerSku}`,
      ...(passed ? {} : { eventIds: ids }),
    };
  });
}

// Every rule over an order whose mandate is verified.
export function policyChecks(
  mandate: LockedMandate,
  order: OrderFacts,
  catalog: TrustedCatalog,
  checkouts: { current: CheckoutAttempt; all: readonly CheckoutAttempt[] },
): RuleCheck[] {
  const integrity = checkOrderIntegrity(order, catalog);
  const perLine = integrity.lines.flatMap((line) => {
    const attributes = checkAttributes(mandate, line);
    return [
      checkPayee(mandate, line),
      checkUnitPrice(mandate, line),
      checkCategory(mandate, line),
      ...(attributes ? [attributes] : []),
      checkBrand(mandate, line),
    ];
  });
  // The order-wide rules need every line's catalog facts; with a line the catalog can't vouch for
  // they'd be judging part of the order, and that line blocks anyway.
  const whole =
    integrity.lines.length === order.lines.length && order.lines.length > 0
      ? [checkBudget(mandate, integrity.lines), checkQuantity(mandate, integrity.lines)]
      : [];
  return [
    ...integrity.checks,
    ...perLine,
    ...whole,
    ...checkVelocity(checkouts.current, checkouts.all),
  ];
}

export const outcomeOf = (c: RuleCheck): "pass" | "block" | "escalate" =>
  c.passed ? "pass" : ON_FAILURE[c.rule];

export const describeCheck = (c: RuleCheck): string =>
  `${c.rule}${c.listingId ? ` (${c.listingId})` : ""}: ${c.reason}`;

// Gate 0's verdict from its checks: any block blocks, then any escalation escalates, else approve.
// The reasons are the failed checks, blocks first, or every passed check when it approves.
export function decideGate0(
  checks: readonly RuleCheck[],
  evidence: { checkoutEventId: string; mandateEventId: string | null },
): GateResult {
  const blocks = checks.filter((c) => outcomeOf(c) === "block");
  const escalations = checks.filter((c) => outcomeOf(c) === "escalate");
  const verdict = blocks.length > 0 ? "block" : escalations.length > 0 ? "escalate" : "approve";
  const shown = verdict === "approve" ? checks : [...blocks, ...escalations];
  const ids = [
    evidence.checkoutEventId,
    ...(evidence.mandateEventId ? [evidence.mandateEventId] : []),
    ...shown.flatMap((c) => c.eventIds ?? []),
  ];
  return {
    gate: "gate0",
    verdict,
    confidence: RULE_CONFIDENCE,
    reasons: shown.map(describeCheck),
    evidenceEventIds: [...new Set(ids)],
  };
}
