import { describe, expect, it } from "vitest";
import { createRng, hashSeed, mulberry32, seededUuid } from "./seed";

describe("seeded PRNG", () => {
  it("is deterministic", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });
  it("hashes strings stably", () => {
    expect(hashSeed("northwind")).toBe(hashSeed("northwind"));
    expect(hashSeed("northwind")).not.toBe(hashSeed("ledgerly"));
    expect(hashSeed(7)).toBe(7);
  });
  it("helpers stay in range", () => {
    const rng = createRng("x");
    for (let i = 0; i < 200; i++) {
      const n = rng.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
    expect(["a", "b", "c"]).toContain(rng.pick(["a", "b", "c"]));
    expect(rng.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
  it("makes uuid-shaped ids", () => {
    const id = seededUuid(createRng("agent-1"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seededUuid(createRng("agent-1"))).toBe(id);
  });
});
