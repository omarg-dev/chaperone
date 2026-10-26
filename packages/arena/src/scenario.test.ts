import { describe, expect, it } from "vitest";
import { baseCatalog } from "./catalog/index.js";
import { acceptableListings } from "./intent.js";
import { buildArena } from "./scenario.js";
import { BENIGN_SCENARIOS } from "./scenarios/benign.js";

const [first] = BENIGN_SCENARIOS;
if (!first) throw new Error("No benign scenarios");

describe("buildArena", () => {
  it("builds the same arena for the same scenario and seed", () => {
    expect(buildArena(first, "1", baseCatalog)).toEqual(buildArena(first, "1", baseCatalog));
  });

  it("builds a different arena for a different seed", () => {
    const a = buildArena(first, "1", baseCatalog);
    const b = buildArena(first, "2", baseCatalog);
    expect(a.searchOrder).not.toEqual(b.searchOrder);
    expect(a.catalog.listings.map((l) => l.priceCents)).not.toEqual(
      b.catalog.listings.map((l) => l.priceCents),
    );
  });

  it("moves prices at most about 3% and keeps them ending in .99", () => {
    const arena = buildArena(first, "7", baseCatalog);
    arena.catalog.listings.forEach((listing, i) => {
      const base = baseCatalog.listings[i]?.priceCents as number;
      expect(listing.priceCents % 100).toBe(99);
      expect(Math.abs(listing.priceCents - base) / base).toBeLessThan(0.04);
    });
  });

  it("shows every listing in search exactly once", () => {
    const arena = buildArena(first, "3", baseCatalog);
    expect([...arena.searchOrder].sort()).toEqual(
      arena.catalog.listings.map((l) => l.listingId).sort(),
    );
  });

  it("leaves the base catalog alone", () => {
    const before = structuredClone(baseCatalog);
    buildArena(first, "4", baseCatalog);
    expect(baseCatalog).toEqual(before);
  });

  it("applies a scenario's injection with the seeded random generator", () => {
    const withExtra = {
      ...first,
      inject: (catalog: typeof baseCatalog, random: { int(a: number, b: number): number }) => ({
        ...catalog,
        coupons: [{ code: `C${random.int(1, 9)}`, percentOff: 10, listingIds: [] }],
      }),
    };
    const a = buildArena(withExtra, "5", baseCatalog);
    expect(a.catalog.coupons).toHaveLength(1);
    expect(a).toEqual(buildArena(withExtra, "5", baseCatalog));
  });
});

describe("benign scenarios", () => {
  it("have unique IDs", () => {
    const ids = BENIGN_SCENARIOS.map((s) => s.scenarioId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("are at least 20, over every product category the base catalog sells", () => {
    expect(BENIGN_SCENARIOS.length).toBeGreaterThanOrEqual(20);
    const sold = new Set(baseCatalog.products.map((p) => p.category));
    for (const category of sold) {
      expect(BENIGN_SCENARIOS.some((s) => s.intent.category === category)).toBe(true);
    }
  });

  it("name only brands the catalog has", () => {
    const known = new Set(baseCatalog.brands.map((b) => b.brandId));
    for (const scenario of BENIGN_SCENARIOS) {
      for (const id of [
        ...(scenario.intent.onlyBrands ?? []),
        ...(scenario.intent.blockedBrands ?? []),
      ]) {
        expect(known.has(id), `${scenario.scenarioId}: ${id}`).toBe(true);
      }
    }
  });

  // A benign scenario with nothing to buy would count a correct refusal as a false block.
  it.each(BENIGN_SCENARIOS.map((s) => [s.scenarioId, s] as const))(
    "%s has something acceptable to buy under every seed",
    (_, scenario) => {
      for (let seed = 1; seed <= 20; seed++) {
        const arena = buildArena(scenario, String(seed), baseCatalog);
        expect(acceptableListings(scenario.intent, arena.catalog).length).toBeGreaterThan(0);
      }
    },
  );
});
