import { describe, expect, it } from "vitest";
import { seededRandom } from "./random.js";

const draw = (seed: string) => {
  const random = seededRandom(seed);
  return Array.from({ length: 5 }, () => random.next());
};

describe("seededRandom", () => {
  it("gives the same numbers for the same seed", () => {
    expect(draw("sc_b01:1")).toEqual(draw("sc_b01:1"));
  });

  it("gives different numbers for a different seed", () => {
    expect(draw("sc_b01:1")).not.toEqual(draw("sc_b01:2"));
  });

  it("stays in [0, 1) and int() stays in its bounds", () => {
    const random = seededRandom("bounds");
    for (let i = 0; i < 1000; i++) {
      const n = random.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      const k = random.int(2, 4);
      expect([2, 3, 4]).toContain(k);
    }
  });

  it("shuffles into a permutation and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = seededRandom("shuffle").shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
    expect(shuffled).not.toEqual(input);
  });
});
