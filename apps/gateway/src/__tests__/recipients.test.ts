import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidatesFromArgs, candidatesFromContent, classifyRecipient, hashRecipient, normaliseUrl, UntrustedRecipientRegistry } from "../recipients";

describe("recipient normalisation", () => {
  it("hashes the normalised email (lowercase, trimmed) with sha256", () => {
    const expected = createHash("sha256").update("ada@example.com").digest("hex");
    expect(hashRecipient("email", "  Ada@Example.COM ")).toBe(expected);
  });

  it("hashes phones digits-only (keeping a leading +)", () => {
    expect(hashRecipient("phone", "+44 20-7946 (0018)")).toBe(hashRecipient("phone", "+442079460018"));
  });

  it("normalises URLs: host lowercased, trailing slash and fragment dropped", () => {
    expect(normaliseUrl("HTTPS://Untrusted.Example/order-form/#x")).toBe("https://untrusted.example/order-form");
    expect(normaliseUrl("https://a.example/b).")).toBe("https://a.example/b");
  });

  it("classifies an explicit recipient", () => {
    expect(classifyRecipient("Bob@Example.com")).toEqual({ kind: "email", value: "bob@example.com" });
    expect(classifyRecipient("https://x.example/p")).toEqual({ kind: "url", value: "https://x.example/p" });
    expect(classifyRecipient("+1 415 555 0100")).toEqual({ kind: "phone", value: "+14155550100" });
    expect(classifyRecipient("just a name")).toBeNull();
  });

  it("finds recipients nested anywhere in tool arguments", () => {
    const found = candidatesFromArgs({ to: ["A@b.co"], payload: { link: "https://z.example/x", note: "call +44 20 7946 0018" } }, "c@d.io");
    expect(found.map((c) => `${c.kind}:${c.value}`)).toEqual(["email:c@d.io", "email:a@b.co", "url:https://z.example/x", "phone:+442079460018"]);
  });
});

describe("UntrustedRecipientRegistry", () => {
  it("remembers what a session saw inside untrusted content and nothing across sessions", () => {
    const reg = new UntrustedRecipientRegistry();
    const found = candidatesFromContent({ body: "write to Supplier@Untrusted.example or visit https://untrusted.example/form" });
    expect(reg.record("s1", found)).toBe(2);
    expect(reg.record("s1", found)).toBe(0);
    expect(reg.firstSeenInUntrusted("s1", candidatesFromArgs({ to: "supplier@untrusted.example" }))).toHaveLength(1);
    expect(reg.firstSeenInUntrusted("s1", candidatesFromArgs({ url: "https://untrusted.example/form/" }))).toHaveLength(1);
    expect(reg.firstSeenInUntrusted("s2", candidatesFromArgs({ to: "supplier@untrusted.example" }))).toHaveLength(0);
    expect(reg.firstSeenInUntrusted("s1", candidatesFromArgs({ to: "someone@else.example" }))).toHaveLength(0);
  });

  it("forgets sessions after the ttl", () => {
    let t = 0;
    const reg = new UntrustedRecipientRegistry({ ttlMs: 1000, now: () => t });
    reg.record("s1", candidatesFromContent("x@y.example"));
    t = 2000;
    reg.record("s2", candidatesFromContent("a@b.example"));
    expect(reg.size("s1")).toBe(0);
    expect(reg.size("s2")).toBe(1);
  });
});
