import { describe, expect, it } from "vitest";
import { facetsOf, type OutcomeEvent } from "./outcome.js";

const review = (type: string, payload: unknown): OutcomeEvent => ({
  lane: "review",
  type,
  payload,
});

describe("facetsOf", () => {
  it("is empty for a run with none of the events", () => {
    expect(facetsOf([])).toEqual({ seed: null, reviews: [], paidPayees: [] });
  });

  it("reads the configurations in the order the reviews ran", () => {
    expect(
      facetsOf([
        review("review_started", { config: "off" }),
        review("review_started", { config: "full" }),
        // A review that doesn't say is the full tree, as the run view reads it.
        review("review_started", {}),
      ]).reviews,
    ).toEqual(["off", "full", "full"]);
  });

  it("takes the payouts of the last enforcement, and only the payees paid something", () => {
    const facets = facetsOf([
      review("enforced", { payouts: [{ payeeKey: "seller_1", amountCents: 100 }] }),
      review("enforced", {
        payouts: [
          { payeeKey: "attacker_1", amountCents: 250 },
          { payeeKey: "seller_3", amountCents: 0 },
          { amountCents: 5 },
          "junk",
        ],
      }),
    ]);
    expect(facets.paidPayees).toEqual(["attacker_1"]);
  });

  it("ignores a run_started that isn't the arena's or has no seed", () => {
    expect(
      facetsOf([{ lane: "agent", type: "run_started", payload: { seed: "9" } }]).seed,
    ).toBeNull();
    expect(
      facetsOf([{ lane: "arena", type: "run_started", payload: { seed: 1 } }]).seed,
    ).toBeNull();
    expect(facetsOf([{ lane: "arena", type: "run_started", payload: { seed: "2" } }]).seed).toBe(
      "2",
    );
  });
});
