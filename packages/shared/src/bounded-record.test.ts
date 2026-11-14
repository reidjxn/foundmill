import { describe, expect, it } from "vitest";
import { z } from "zod";
import { boundedRecord, boundedRecordMessage, fewKeys } from "./bounded-record";

describe("fewKeys / boundedRecord (GHSA-mrhx-c7xc-m3w5)", () => {
  it("fewKeys: a plain object with at most the limit of keys, nothing else", () => {
    const three = fewKeys(3);
    expect(three({})).toBe(true);
    expect(three({ a: 1, b: 2, c: 3 })).toBe(true);
    expect(three({ a: 1, b: 2, c: 3, d: 4 })).toBe(false);
    expect(fewKeys(0)({})).toBe(true);
    expect(fewKeys(0)({ a: 1 })).toBe(false);
    const odds: unknown[] = [null, undefined, "abc", 3, true, ["a"], new Map([["a", 1]]), new Set(["a"]), new Date(), Object.create(null), { __proto__: null, a: 1 }, Object.create({ a: 1 }), new (class Thing {})()];
    odds.forEach((odd, i) => expect(three(odd), `odd input #${i}`).toBe(false));
  });

  it("fewKeys: a JSON `__proto__` key is an own key like any other, counted and kept off the prototype", () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(fewKeys(2)(parsed)).toBe(true);
    expect(fewKeys(1)(parsed)).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("boundedRecord: parses as the record did within the limit; past it, or not a plain object, one short issue", () => {
    const schema = boundedRecord(3, z.record(z.string(), z.string()));
    expect(schema.parse({ a: "1", b: "2" })).toEqual({ a: "1", b: "2" });
    expect(schema.parse({})).toEqual({});
    // Within the limit the record's own checks still run, key by key.
    const wrong = schema.safeParse({ a: 1, b: 2 });
    expect(wrong.success).toBe(false);
    expect(wrong.error!.issues).toHaveLength(2);

    const over = schema.safeParse({ a: "1", b: "2", c: "3", d: "4" });
    expect(over.success).toBe(false);
    expect(over.error!.issues).toHaveLength(1);
    expect(over.error!.issues[0]!.message).toBe(boundedRecordMessage(3));
    expect(boundedRecordMessage(1000)).toBe("At most 1,000 entries");

    for (const odd of [new Map([["a", "1"]]), ["1"], null, "a", Object.create(null)]) {
      const r = schema.safeParse(odd);
      expect(r.success).toBe(false);
      expect(r.error!.issues).toHaveLength(1);
    }
    // A caller's own message, and the wrappers a record field usually takes.
    expect(boundedRecord(1, z.record(z.string(), z.number()), "One at most").safeParse({ a: 1, b: 2 }).error!.issues[0]!.message).toBe("One at most");
    expect(boundedRecord(2, z.record(z.string(), z.number())).default({}).parse(undefined)).toEqual({});
    expect(boundedRecord(2, z.record(z.string(), z.number())).optional().parse(undefined)).toBeUndefined();
    expect(boundedRecord(2, z.partialRecord(z.enum(["a", "b"]), z.boolean())).parse({ a: true })).toEqual({ a: true });
  });

  it("boundedRecord: 200,000 junk keys are refused with one issue (the bare record builds one per key)", () => {
    const junk = Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`k${i}`, i]));
    const bare = z.record(z.string(), z.string()).safeParse(junk);
    expect(bare.error!.issues).toHaveLength(200_000);

    const bounded = boundedRecord(100, z.record(z.string(), z.string())).safeParse(junk);
    expect(bounded.success).toBe(false);
    expect(bounded.error!.issues).toHaveLength(1);
    expect(JSON.stringify(bounded.error!.issues).length).toBeLessThan(500);
  });
});
