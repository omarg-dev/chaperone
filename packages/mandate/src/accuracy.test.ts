import type { Intent } from "@firewall/arena";
import { describe, expect, it } from "vitest";
import { compareWithIntent } from "./accuracy.js";
import type { MandateTerms } from "./mandate.js";

const intent: Intent = {
  category: "mouse",
  constraints: [
    { attribute: "wireless", op: "eq", value: true },
    { attribute: "weight_g", op: "lte", value: 70 },
  ],
  maxUnitPriceCents: 8000,
  quantity: 1,
};

const terms: MandateTerms = {
  category: "mouse",
  constraints: [
    { attribute: "weight_g", op: "lte", value: 70 },
    { attribute: "wireless", op: "eq", value: true },
  ],
  brandPolicy: { mode: "any_reputable", listed: [], blocked: [] },
  maxUnitPriceCents: 8000,
  quantity: 1,
  allowedExtras: [],
  unmapped: ["light"],
};

const differences = (mandate: MandateTerms) =>
  Object.fromEntries(
    compareWithIntent(mandate, intent)
      .fields.filter((f) => f.direction !== "same")
      .map((f) => [f.field, f.direction]),
  );

describe("compareWithIntent", () => {
  it("calls a mandate that asks for exactly the intent exact, in any order", () => {
    const accuracy = compareWithIntent(terms, intent);
    expect(accuracy.exact).toBe(true);
    expect(accuracy.verdict).toBe("exact");
    expect(accuracy.fields.every((f) => f.direction === "same")).toBe(true);
  });

  it("calls a lower ceiling, a tighter bound, an extra requirement or a narrower brand list stricter", () => {
    expect(differences({ ...terms, maxUnitPriceCents: 7000 })).toEqual({
      maxUnitPriceCents: "stricter",
    });
    expect(
      differences({
        ...terms,
        constraints: [
          { attribute: "wireless", op: "eq", value: true },
          { attribute: "weight_g", op: "lte", value: 60 },
          { attribute: "dpi", op: "gte", value: 16000 },
        ],
        brandPolicy: { mode: "listed_only", listed: ["brand_pellucid_gear"], blocked: ["brand_x"] },
      }),
    ).toEqual({
      "constraints.weight_g": "stricter",
      "constraints.dpi": "stricter",
      "brandPolicy.mode": "stricter",
      "brandPolicy.blocked": "stricter",
    });
    expect(compareWithIntent({ ...terms, maxUnitPriceCents: 7000 }, intent).verdict).toBe(
      "stricter",
    );
  });

  it("calls a missing requirement, a higher or missing ceiling, any brand or extras looser", () => {
    expect(
      differences({
        ...terms,
        constraints: [{ attribute: "weight_g", op: "lte", value: 90 }],
        maxUnitPriceCents: null,
        brandPolicy: { mode: "any", listed: [], blocked: [] },
        allowedExtras: ["keyboard"],
      }),
    ).toEqual({
      "constraints.wireless": "looser",
      "constraints.weight_g": "looser",
      maxUnitPriceCents: "looser",
      "brandPolicy.mode": "looser",
      allowedExtras: "looser",
    });
  });

  it("calls a different category, quantity or value wrong", () => {
    const wrong = compareWithIntent(
      {
        ...terms,
        constraints: [
          { attribute: "wireless", op: "eq", value: false },
          { attribute: "weight_g", op: "lte", value: 70 },
        ],
        quantity: 2,
      },
      intent,
    );
    expect(wrong.verdict).toBe("wrong");
    expect(differences({ ...terms, category: "keyboard" })).toMatchObject({
      category: "different",
    });
  });

  it("calls a bound on the wrong side different, and stricter one way and looser another mixed", () => {
    expect(
      differences({
        ...terms,
        constraints: [
          { attribute: "wireless", op: "eq", value: true },
          { attribute: "weight_g", op: "gte", value: 70 },
        ],
      }),
    ).toEqual({ "constraints.weight_g": "different" });
    expect(
      compareWithIntent(
        {
          ...terms,
          maxUnitPriceCents: 9000,
          quantity: 1,
          brandPolicy: { mode: "listed_only", listed: ["b"], blocked: [] },
        },
        intent,
      ).verdict,
    ).toBe("mixed");
  });

  describe("when the person named brands", () => {
    const named: Intent = {
      ...intent,
      onlyBrands: ["brand_a", "brand_b"],
      blockedBrands: ["brand_x"],
    };
    const exact: MandateTerms = {
      ...terms,
      brandPolicy: { mode: "listed_only", listed: ["brand_b", "brand_a"], blocked: ["brand_x"] },
    };
    const against = (brandPolicy: MandateTerms["brandPolicy"]) =>
      Object.fromEntries(
        compareWithIntent({ ...exact, brandPolicy }, named)
          .fields.filter((f) => f.direction !== "same")
          .map((f) => [f.field, f.direction]),
      );

    it("calls the same brands, in any order, exact", () => {
      expect(compareWithIntent(exact, named).exact).toBe(true);
    });

    it("calls fewer brands allowed or more ruled out stricter, and the reverse looser", () => {
      expect(
        against({ mode: "listed_only", listed: ["brand_a"], blocked: ["brand_x", "brand_y"] }),
      ).toEqual({
        "brandPolicy.mode": "stricter",
        "brandPolicy.blocked": "stricter",
      });
      expect(against({ mode: "any_reputable", listed: [], blocked: [] })).toEqual({
        "brandPolicy.mode": "looser",
        "brandPolicy.blocked": "looser",
      });
      expect(
        against({
          mode: "listed_only",
          listed: ["brand_a", "brand_b", "brand_c"],
          blocked: ["brand_x"],
        }),
      ).toEqual({ "brandPolicy.mode": "looser" });
    });

    it("calls other brands than the ones named different", () => {
      expect(against({ mode: "listed_only", listed: ["brand_c"], blocked: ["brand_x"] })).toEqual({
        "brandPolicy.mode": "different",
      });
    });
  });
});
