// A seeded random number generator, so the same scenario and seed always build the same arena.
// mulberry32: small, fast and good enough for shuffling listings; not for anything secret.
export interface Random {
  // A number in [0, 1).
  next(): number;
  // A whole number in [min, max], both included.
  int(min: number, max: number): number;
  // A new array in a random order. The input is left alone.
  shuffle<T>(items: readonly T[]): T[];
}

export function seededRandom(seed: string): Random {
  let state = hashSeed(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
}

// FNV-1a: turns a text seed into the 32-bit starting state.
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
