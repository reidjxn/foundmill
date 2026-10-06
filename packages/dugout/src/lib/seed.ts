/**
 * Deterministic randomness for procedural art (crests, avatars) and mock data.
 * Everything here is pure: the same seed always produces the same sequence.
 */

/** mulberry32: a small, fast 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string → unsigned 32-bit integer. */
export function hashSeed(input: string | number): number {
  if (typeof input === "number") return input >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with probability p (default 0.5). */
  bool(p?: number): boolean;
  /** A new array with the items shuffled (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

/** A seeded RNG with helpers. Accepts a string (hashed) or a number. */
export function createRng(seed: string | number): Rng {
  const next = mulberry32(hashSeed(seed));
  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    range: (min, max) => next() * (max - min) + min,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() on an empty array");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    bool: (p = 0.5) => next() < p,
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
  };
  return rng;
}

const HEX = "0123456789abcdef";

/** A deterministic UUID-shaped string (v4 layout) from an RNG. For mocks, stories and tests only. */
export function seededUuid(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 32; i++) {
    if (i === 12) s += "4";
    else if (i === 16) s += HEX[8 + rng.int(0, 3)];
    else s += HEX[rng.int(0, 15)];
  }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

let counter = 0;
/** A unique id for DOM wiring (aria-describedby etc.) when React's useId is not usable. Not deterministic. */
export function uniqueId(prefix = "dg"): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}
