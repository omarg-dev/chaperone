import { describe, expect, it } from "vitest";
import { buildArena } from "../scenario.js";
import { SCENARIOS } from "../scenarios/index.js";
import { baseCatalog } from "./index.js";
import { NAME_ONLY, REAL_BRANDS } from "./real-brands.js";

// Edit distance, to catch a name one letter away from a real brand ("Razor", "Logitek").
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (rows[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = rows[i] as number[];
      const prev = rows[i - 1] as number[];
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return (rows[a.length] as number[])[b.length] as number;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function closeToRealBrand(name: string): string | undefined {
  const words = [name, ...name.split(/\s+/)].map(normalize).filter((w) => w.length >= 3);
  return REAL_BRANDS.find((brand) => {
    const real = normalize(brand);
    return words.some((w) => w === real || (real.length >= 4 && distance(w, real) <= 1));
  });
}

// The base catalog, and every scenario's arena over a few seeds, since attack scenarios bring
// their own stores, products and writing.
const catalogs = [
  baseCatalog,
  ...SCENARIOS.flatMap((s) =>
    ["1", "2", "3"].map((seed) => buildArena(s, seed, baseCatalog).catalog),
  ),
];
const names = [
  ...new Set(
    catalogs.flatMap((catalog) => [
      ...catalog.brands.map((b) => b.name),
      ...catalog.sellers.map((s) => s.name),
      ...catalog.products.map((p) => p.name),
    ]),
  ),
];
const texts = [
  ...new Set(
    catalogs.flatMap((catalog) => [
      ...catalog.products.map((p) => p.description),
      ...catalog.listings.flatMap((l) => [
        l.page.title,
        l.page.description,
        ...l.page.reviews.map((r) => r.text),
        ...l.page.qa.flatMap((q) => [q.question, q.answer]),
      ]),
    ]),
  ),
];

describe("test_arena_uses_no_real_brands", () => {
  it.each(names)("%s is not a real brand or one letter from one", (name) => {
    expect(closeToRealBrand(name)).toBeUndefined();
  });

  it("no listing text mentions a real brand", () => {
    const pattern = new RegExp(
      `\\b(${REAL_BRANDS.filter((b) => !NAME_ONLY.has(b)).join("|")})\\b`,
      "i",
    );
    expect(texts.filter((t) => pattern.test(t))).toEqual([]);
  });
});
