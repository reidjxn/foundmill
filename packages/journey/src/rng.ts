/**
 * Seeded randomness for synthetic journey data. Pure: the same seed always yields the same sequence.
 * Backed by seedrandom's Alea generator (53-bit, fast, deterministic across platforms).
 */
import seedrandom from "seedrandom";

export interface SeededRng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p. */
  bool(p?: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** One element chosen by relative weight (weights need not sum to 1). */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Standard normal deviate (Box–Muller). */
  gaussian(mean?: number, sd?: number): number;
  /** Poisson deviate with the given mean. */
  poisson(lambda: number): number;
  /** Geometric number of failures before success with success probability p. */
  geometric(p: number): number;
  /** Fisher–Yates shuffle (new array). */
  shuffle<T>(items: readonly T[]): T[];
  /** Deterministic v4-shaped UUID. */
  uuid(): string;
  /** A child generator seeded from this one's seed plus a label (independent stream). */
  fork(label: string): SeededRng;
}

const HEX = "0123456789abcdef";

export function createSeededRng(seed: string | number): SeededRng {
  const seedStr = String(seed);
  const prng = seedrandom.alea(seedStr);
  const next = () => prng();
  const rng: SeededRng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    range: (min, max) => next() * (max - min) + min,
    bool: (p = 0.5) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() on an empty array");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (items, weights) => {
      if (items.length === 0 || items.length !== weights.length) throw new Error("weighted() needs equal non-empty arrays");
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return rng.pick(items);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r < 0) return items[i] as (typeof items)[number];
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    gaussian: (mean = 0, sd = 1) => {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda > 30) {
        // Normal approximation keeps this O(1) for large means.
        return Math.max(0, Math.round(rng.gaussian(lambda, Math.sqrt(lambda))));
      }
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > l);
      return k - 1;
    },
    geometric: (p) => {
      const q = Math.min(Math.max(p, 1e-9), 1);
      if (q >= 1) return 0;
      return Math.floor(Math.log(1 - next()) / Math.log(1 - q));
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = a;
      }
      return out;
    },
    uuid: () => {
      let s = "";
      for (let i = 0; i < 32; i++) {
        if (i === 12) s += "4";
        else if (i === 16) s += HEX[8 + rng.int(0, 3)];
        else s += HEX[rng.int(0, 15)];
      }
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
    fork: (label) => createSeededRng(`${seedStr}::${label}`),
  };
  return rng;
}

/** Clamp a number into [min, max]. */
export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));
