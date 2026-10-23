import { describe, expect, it } from "vitest";
import {
  applyEdit,
  checkDraft,
  hashMandate,
  type LockedMandate,
  lockMandate,
  type MandateDraft,
  MandateError,
  termsProblems,
  verifyMandate,
} from "./mandate.js";
import { tactileDraft, tactileTerms, vocabulary } from "./test-helpers.js";

const confirmedAt = "2026-11-01T12:00:00.000Z";
const lock = (draft: MandateDraft) => lockMandate(draft, { vocabulary, confirmedAt });

describe("lockMandate", () => {
  it("stamps the confirmation and a sha256 hash", () => {
    const locked = lock(tactileDraft);
    expect(locked.confirmedByUser).toBe(true);
    expect(locked.confirmedAt).toBe(confirmedAt);
    expect(locked.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(locked.maxUnitPriceCents).toBe(12000);
  });

  it("hashes the same mandate the same, whatever order its parts came in", () => {
    const reordered: MandateDraft = {
      tolerances: tactileDraft.tolerances,
      payeePolicy: tactileDraft.payeePolicy,
      currency: tactileDraft.currency,
      ...tactileTerms,
      constraints: [...tactileDraft.constraints].reverse(),
      requestText: tactileDraft.requestText,
      mandateId: tactileDraft.mandateId,
    };
    expect(lock(reordered).hash).toBe(lock(tactileDraft).hash);
    expect(lock(reordered)).toEqual(lock(tactileDraft));
  });

  it("hashes a different mandate differently", () => {
    expect(lock({ ...tactileDraft, maxUnitPriceCents: 11900 }).hash).not.toBe(
      lock(tactileDraft).hash,
    );
  });

  it("leaves the draft as it was", () => {
    const draft = structuredClone(tactileDraft);
    lock(draft);
    expect(draft).toEqual(tactileDraft);
  });

  it("refuses a draft with no price ceiling", () => {
    expect(() => lock({ ...tactileDraft, maxUnitPriceCents: null })).toThrow(/no price ceiling/);
  });

  it("refuses a draft that doesn't fit the catalog", () => {
    const draft = {
      ...tactileDraft,
      constraints: [{ attribute: "dpi", op: "gte" as const, value: 800 }],
    };
    expect(() => lock(draft)).toThrow(MandateError);
  });
});

describe("verifyMandate", () => {
  const locked = lock(tactileDraft);

  it("accepts a mandate exactly as it was locked, including after a JSON round trip", () => {
    expect(verifyMandate(locked)).toEqual({ intact: true, mandate: locked });
    expect(verifyMandate(JSON.parse(JSON.stringify(locked))).intact).toBe(true);
  });

  it.each<[string, (m: LockedMandate) => LockedMandate]>([
    ["a raised price ceiling", (m) => ({ ...m, maxUnitPriceCents: 99900 })],
    ["a dropped requirement", (m) => ({ ...m, constraints: m.constraints.slice(1) })],
    ["a different brand policy", (m) => ({ ...m, brandPolicy: { ...m.brandPolicy, mode: "any" } })],
    ["a moved confirmation time", (m) => ({ ...m, confirmedAt: "2026-11-02T12:00:00.000Z" })],
    [
      "a recomputed hash for other contents",
      (m) => ({ ...m, hash: lock({ ...tactileDraft, quantity: 2 }).hash }),
    ],
  ])("refuses %s", (_, alter) => {
    const result = verifyMandate(alter(locked));
    expect(result.intact).toBe(false);
    if (!result.intact) expect(result.problems.join()).toMatch(/hash mismatch/);
  });

  it("refuses something that isn't a locked mandate", () => {
    expect(verifyMandate(tactileDraft).intact).toBe(false);
    expect(verifyMandate({ ...locked, confirmedByUser: false }).intact).toBe(false);
    expect(verifyMandate(null).intact).toBe(false);
  });

  it("hashes what verify recomputes", () => {
    expect(hashMandate(locked)).toBe(locked.hash);
  });
});

describe("termsProblems", () => {
  const problems = (change: Partial<typeof tactileTerms>) =>
    termsProblems({ ...tactileTerms, ...change }, vocabulary);

  it("accepts terms that fit", () => {
    expect(problems({})).toEqual([]);
  });

  it.each([
    [
      "an attribute of another category",
      { constraints: [{ attribute: "anc", op: "eq" as const, value: true }] },
      /no attribute "anc"/,
    ],
    [
      "a value the attribute doesn't take",
      { constraints: [{ attribute: "switch_feel", op: "eq" as const, value: "squishy" }] },
      /one of tactile/,
    ],
    [
      "a range on a text attribute",
      { constraints: [{ attribute: "layout", op: "lte" as const, value: "tkl" }] },
      /only be required equal/,
    ],
    [
      "a word for a yes or no",
      { constraints: [{ attribute: "wireless", op: "eq" as const, value: "yes" }] },
      /yes or no/,
    ],
    [
      "the same requirement twice",
      {
        constraints: [
          { attribute: "wireless", op: "eq" as const, value: true },
          { attribute: "wireless", op: "eq" as const, value: false },
        ],
      },
      /required twice/,
    ],
    [
      "an unknown brand",
      { brandPolicy: { mode: "listed_only" as const, listed: ["brand_nope"], blocked: [] } },
      /No brand "brand_nope"/,
    ],
    [
      "listed_only with no brands",
      { brandPolicy: { mode: "listed_only" as const, listed: [], blocked: [] } },
      /at least one brand/,
    ],
    [
      "listed brands in another mode",
      { brandPolicy: { mode: "any" as const, listed: ["brand_tidewell"], blocked: [] } },
      /only apply to listed_only/,
    ],
    [
      "a brand both listed and blocked",
      {
        brandPolicy: {
          mode: "listed_only" as const,
          listed: ["brand_tidewell"],
          blocked: ["brand_tidewell"],
        },
      },
      /both listed and blocked/,
    ],
    ["the main category as an extra", { allowedExtras: ["keyboard" as const] }, /main category/],
  ])("names %s", (_, change, message) => {
    expect(problems(change).join("; ")).toMatch(message);
  });

  it("takes a number for a number attribute", () => {
    const mouse = { category: "mouse" as const, unmapped: [] };
    expect(
      problems({ ...mouse, constraints: [{ attribute: "weight_g", op: "lte", value: 70 }] }),
    ).toEqual([]);
    expect(
      problems({
        ...mouse,
        constraints: [{ attribute: "weight_g", op: "lte", value: "light" }],
      }).join(),
    ).toMatch(/needs a number/);
  });
});

describe("checkDraft", () => {
  it("names shape problems with their path", () => {
    expect(() => checkDraft({ ...tactileDraft, quantity: 0 }, vocabulary)).toThrow(/quantity/);
    expect(() => checkDraft({ ...tactileDraft, surprise: 1 }, vocabulary)).toThrow(MandateError);
  });
});

describe("applyEdit", () => {
  it("returns a new draft with the field changed, and says what changed", () => {
    const applied = applyEdit(
      tactileDraft,
      { field: "maxUnitPriceCents", value: 10000 },
      vocabulary,
    );
    expect(applied.draft.maxUnitPriceCents).toBe(10000);
    expect(applied).toMatchObject({ from: 12000, to: 10000, dropped: [] });
    expect(tactileDraft.maxUnitPriceCents).toBe(12000);
  });

  it("drops the requirements a new category doesn't have, and keeps the ones it does", () => {
    const wireless = {
      ...tactileDraft,
      constraints: [
        ...tactileDraft.constraints,
        { attribute: "wireless", op: "eq" as const, value: true },
      ],
      allowedExtras: ["mouse" as const],
    };
    const applied = applyEdit(wireless, { field: "category", value: "mouse" }, vocabulary);
    expect(applied.draft.constraints).toEqual([{ attribute: "wireless", op: "eq", value: true }]);
    expect(applied.dropped.map((c) => c.attribute)).toEqual(["type", "switch_feel"]);
    expect(applied.draft.allowedExtras).toEqual([]);
  });

  it("refuses an edit that doesn't fit the catalog, naming why", () => {
    expect(() =>
      applyEdit(
        tactileDraft,
        { field: "constraints", value: [{ attribute: "switch_feel", op: "eq", value: "mushy" }] },
        vocabulary,
      ),
    ).toThrow(/one of tactile, linear, clicky, membrane/);
  });
});
