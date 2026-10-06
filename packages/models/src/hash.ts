/**
 * Stable hashing and seeded randomness. The mock client keys every fixture on `stableHash({ route, system, messages })`
 * so the same input always produces the same completion, in any process, on any machine.
 */
import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted, `undefined` dropped from objects and nulled in arrays, Dates as ISO. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => sortValue(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  if (typeof value === "function") return null;
  return value;
}

/** sha256 of the canonical JSON of `value`, truncated to `length` hex chars (default 16 = 64 bits). */
export function stableHash(value: unknown, length = 16): string {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return digest.slice(0, Math.max(1, Math.min(64, length)));
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Pick `n` distinct items (or all when fewer). */
  sample<T>(items: readonly T[], n: number): T[];
}

/** mulberry32 seeded from the sha256 of `seed`. Fast, deterministic, good enough for fixture variety. */
export function seededRng(seed: string | number): Rng {
  const hex = createHash("sha256").update(String(seed)).digest("hex").slice(0, 8);
  let state = parseInt(hex, 16) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int(min, max) {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error("seededRng.pick: empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = a;
      }
      return out;
    },
    chance(p) {
      return next() < p;
    },
    sample(items, n) {
      return rng.shuffle(items).slice(0, Math.max(0, Math.min(n, items.length)));
    },
  };
  return rng;
}

/** A deterministic RFC 4122 version-4-shaped UUID derived from `seed`. Used for mock ids that must look like real ids. */
export function uuidFromSeed(seed: string): string {
  const hex = createHash("sha256").update(`uuid:${seed}`).digest("hex");
  const variant = ["8", "9", "a", "b"][parseInt(hex[16] as string, 16) % 4] as string;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuidLike = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
