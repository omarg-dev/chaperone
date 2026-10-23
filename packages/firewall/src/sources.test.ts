import { afterEach, describe, expect, it } from "vitest";
import { type CaseRun, type FixtureCase, HALVARD, QUILL, runCase, TERN } from "./fixture-cases.js";
import { Gate1InputError, gate1Scope } from "./sources.js";

let run: CaseRun | undefined;
afterEach(() => run?.close());

const scopeOf = (shop: FixtureCase["shop"]) => {
  run = runCase({ name: "t", scenarioId: "sc_b01", seed: "s", shop });
  const events = run.log.listRun(run.runId);
  return { scope: gate1Scope(events), events };
};

describe("gate1Scope", () => {
  it("reads the cart's listings first, then the others the agent opened, with their events", () => {
    const { scope, events } = scopeOf((arena, runId) => {
      arena.listing(runId, TERN);
      arena.listing(runId, HALVARD);
      arena.reviews(runId, HALVARD);
      arena.addToCart(runId, HALVARD, 1);
      arena.checkout(runId);
    });
    expect(scope.listings.map((l) => [l.listingId, l.inCart])).toEqual([
      [HALVARD, true],
      [TERN, false],
    ]);
    const halvard = scope.listings[0];
    const served = events.filter((e) => e.type === "listing_viewed" || e.type === "reviews_viewed");
    expect(halvard?.sourceEventIds).toEqual(
      served.filter((e) => JSON.stringify(e.payload).includes(HALVARD)).map((e) => e.eventId),
    );
    expect(halvard?.documents.map((d) => d.kind)).toEqual([
      "title",
      "description",
      "review",
      "review",
      "review",
    ]);
    expect(halvard?.documents[2]?.author).toBeTruthy();
    expect(scope.checkoutEventId).toBe(events.find((e) => e.type === "checkout")?.eventId);
    expect(scope.order.lines.map((l) => l.listingId)).toEqual([HALVARD]);
  });

  it("reads a page opened twice once", () => {
    const { scope } = scopeOf((arena, runId) => {
      arena.listing(runId, HALVARD);
      arena.listing(runId, HALVARD);
      arena.addToCart(runId, HALVARD, 1);
      arena.checkout(runId);
    });
    expect(scope.listings[0]?.documents).toHaveLength(2);
    expect(scope.listings[0]?.sourceEventIds).toHaveLength(2);
  });

  it("reads search titles only for listings in scope, and only when they add something", () => {
    const { scope } = scopeOf((arena, runId) => {
      arena.search(runId, { category: "keyboard" });
      arena.addToCart(runId, QUILL, 1);
      arena.checkout(runId);
    });
    // Bought straight from the results: the result's title is all the agent read of it.
    expect(scope.listings.map((l) => l.listingId)).toEqual([QUILL]);
    expect(scope.listings[0]?.documents.map((d) => d.kind)).toEqual(["search_title"]);
  });

  it("reads nothing served after the checkout, and nothing from failed calls", () => {
    const { scope } = scopeOf((arena, runId) => {
      arena.addToCart(runId, HALVARD, 1);
      arena.checkout(runId);
      arena.listing(runId, TERN);
      expect(() => arena.listing(runId, "lst_missing")).toThrow();
    });
    expect(scope.listings.map((l) => l.listingId)).toEqual([HALVARD]);
    expect(scope.listings[0]?.documents).toEqual([]);
  });

  it("refuses a run with no checkout", () => {
    expect(() => scopeOf((arena, runId) => arena.listing(runId, HALVARD))).toThrow(Gate1InputError);
  });
});
