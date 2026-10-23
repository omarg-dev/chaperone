import { describe, expect, it } from "vitest";
import { describeDraft, fieldNamed, parseEdit } from "./describe.js";
import { MandateError } from "./mandate.js";
import { tactileDraft, vocabulary } from "./test-helpers.js";

describe("describeDraft", () => {
  it("shows every field in words, and what the mandate doesn't cover", () => {
    expect(describeDraft(tactileDraft, vocabulary)).toBe(
      [
        'Request: "Buy me a mid-range mechanical keyboard with tactile switches, under $120."',
        "  Category         keyboard",
        "  Requirements     type = mechanical; switch_feel = tactile",
        "  Brands           any reputable brand",
        "  Price ceiling    $120.00 each",
        "  Quantity         1",
        "  Extras allowed   none",
        "  Sellers          verified sellers only",
        "  Price tolerance  up to 15% over the best offer",
        '  Not covered      "mid-range"',
      ].join("\n"),
    );
  });

  it("names brands, units and a missing ceiling", () => {
    const text = describeDraft(
      {
        ...tactileDraft,
        category: "mouse",
        constraints: [
          { attribute: "wireless", op: "eq", value: true },
          { attribute: "weight_g", op: "lte", value: 70 },
        ],
        brandPolicy: {
          mode: "listed_only",
          listed: ["brand_pellucid_gear"],
          blocked: ["brand_yarrowind"],
        },
        maxUnitPriceCents: null,
      },
      vocabulary,
    );
    expect(text).toContain("wireless = yes; weight_g <= 70 grams");
    expect(text).toContain("only Pellucid Gear, except Yarrowind");
    expect(text).toContain("not set (needed before you can accept)");
  });
});

describe("parseEdit", () => {
  const parse = (field: Parameters<typeof parseEdit>[0], input: string) =>
    parseEdit(field, input, tactileDraft, vocabulary);

  it("reads requirements by each attribute's kind", () => {
    expect(parse("constraints", "layout=75, wireless=yes, weight_g<=70")).toEqual({
      field: "constraints",
      value: [
        { attribute: "layout", op: "eq", value: "75" },
        { attribute: "wireless", op: "eq", value: true },
        { attribute: "weight_g", op: "lte", value: 70 },
      ],
    });
    expect(parse("constraints", "none")).toEqual({ field: "constraints", value: [] });
  });

  it("reads prices in dollars into cents", () => {
    expect(parse("maxUnitPriceCents", "$119.99")).toEqual({
      field: "maxUnitPriceCents",
      value: 11999,
    });
    expect(parse("maxUnitPriceCents", "120")).toEqual({ field: "maxUnitPriceCents", value: 12000 });
  });

  it("reads brand policies by brand name", () => {
    expect(parse("brandPolicy", "only Brightfern, calder & vane except Tidewell")).toEqual({
      field: "brandPolicy",
      value: {
        mode: "listed_only",
        listed: ["brand_brightfern", "brand_calder_vane"],
        blocked: ["brand_tidewell"],
      },
    });
    expect(parse("brandPolicy", "any reputable")).toEqual({
      field: "brandPolicy",
      value: { mode: "any_reputable", listed: [], blocked: [] },
    });
    expect(parse("brandPolicy", "any")).toMatchObject({ value: { mode: "any" } });
  });

  it("reads the other fields", () => {
    expect(parse("category", "Mouse")).toEqual({ field: "category", value: "mouse" });
    expect(parse("quantity", "2")).toEqual({ field: "quantity", value: 2 });
    expect(parse("allowedExtras", "mouse")).toEqual({ field: "allowedExtras", value: ["mouse"] });
    expect(parse("tolerances", "20%")).toEqual({
      field: "tolerances",
      value: { priceVsBestOfferPct: 20 },
    });
  });

  it.each([
    ["category", "monitor"],
    ["constraints", "tactile please"],
    ["constraints", "wireless=maybe"],
    ["brandPolicy", "only Acme"],
    ["brandPolicy", "whatever"],
    ["maxUnitPriceCents", "cheap"],
    ["quantity", "1.5"],
    ["tolerances", "lots"],
  ] as const)("says what it couldn't read in %s %j", (field, input) => {
    expect(() => parse(field, input)).toThrow(MandateError);
  });

  it("knows the fields by the names the person sees", () => {
    expect(fieldNamed("price")).toBe("maxUnitPriceCents");
    expect(fieldNamed(" Requirements ")).toBe("constraints");
    expect(fieldNamed("hash")).toBeUndefined();
  });
});
