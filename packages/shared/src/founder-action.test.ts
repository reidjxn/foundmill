import { describe, expect, it } from "vitest";
import { canonicalPayload, founderActionIdOfDecision, founderActionPayloadHash } from "./founder-action";

describe("founder action helpers", () => {
  it("hashes the canonical payload: key order does not matter, any other change does", () => {
    const a = founderActionPayloadHash({ invention_id: "inv_1", n: { b: 1, a: 2 } });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(founderActionPayloadHash({ n: { a: 2, b: 1 }, invention_id: "inv_1" })).toBe(a);
    expect(founderActionPayloadHash({ invention_id: "inv_2", n: { b: 1, a: 2 } })).not.toBe(a);
    expect(canonicalPayload({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("reads the request id from a note's decision key only", () => {
    const id = "7d1f5b6e-2a3c-4d5e-8f90-123456789abc";
    expect(founderActionIdOfDecision({ key: `founder_action:${id}` })).toBe(id);
    for (const bad of [null, {}, { key: "tool_pick:payments" }, { key: "founder_action:not-an-id" }, { key: 5 }]) expect(founderActionIdOfDecision(bad)).toBeNull();
  });
});
