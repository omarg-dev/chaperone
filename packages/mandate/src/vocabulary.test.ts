import { baseCatalog, type Catalog } from "@firewall/arena";
import { describe, expect, it } from "vitest";
import { termsProblems } from "./mandate.js";
import { arenaVocabulary, attributesByName, findCategory } from "./vocabulary.js";

describe("arenaVocabulary", () => {
  const vocabulary = arenaVocabulary();

  it("names every category the catalog sells", () => {
    const sold = new Set(baseCatalog.products.map((p) => p.category));
    for (const category of sold) expect(findCategory(vocabulary, category)).toBeDefined();
  });

  // The catalog's products are the ground truth for what the attributes look like: a mandate that
  // asked for exactly a product's attributes must be valid, or the vocabulary has drifted.
  it("can express every product in the catalog", () => {
    for (const product of baseCatalog.products) {
      const constraints = Object.entries(product.attributes).map(([attribute, value]) => ({
        attribute,
        op: "eq" as const,
        value,
      }));
      const problems = termsProblems(
        {
          category: product.category,
          constraints,
          brandPolicy: { mode: "listed_only", listed: [product.brandId], blocked: [] },
          maxUnitPriceCents: product.basePriceCents,
          quantity: 1,
          allowedExtras: [],
          unmapped: [],
        },
        vocabulary,
      );
      expect(problems, product.sku).toEqual([]);
    }
  });

  it("lists the catalog's brands with their reputable flag", () => {
    expect(vocabulary.brands).toHaveLength(baseCatalog.brands.length);
    const extra: Catalog = {
      ...baseCatalog,
      brands: [...baseCatalog.brands, { brandId: "brand_x", name: "X", reputable: false }],
    };
    expect(arenaVocabulary(extra).brands.at(-1)).toEqual({
      brandId: "brand_x",
      name: "X",
      reputable: false,
    });
  });

  it("gives an attribute shared by categories one meaning", () => {
    expect(attributesByName(vocabulary).get("wireless")?.kind).toBe("boolean");
  });
});
