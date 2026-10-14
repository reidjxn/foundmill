import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidatesFromArgs, candidatesFromContent, classifyRecipient, hashRecipient, normaliseUrl, RedisUntrustedRegister, UntrustedRecipientRegistry } from "../recipients";

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
  it("remembers what any session of a business saw inside untrusted content, and nothing across businesses", async () => {
    const reg = new UntrustedRecipientRegistry();
    const found = candidatesFromContent({ body: "write to Supplier@Untrusted.example or visit https://untrusted.example/form" });
    expect(await reg.record("b1", found)).toBe(2);
    expect(await reg.record("b1", found)).toBe(0);
    expect(await reg.firstSeenInUntrusted("b1", "s1", candidatesFromArgs({ to: "supplier@untrusted.example" }))).toHaveLength(1);
    expect(await reg.firstSeenInUntrusted("b1", "s1", candidatesFromArgs({ url: "https://untrusted.example/form/" }))).toHaveLength(1);
    // Another session of the same business is told the same (audit SECX-8); another business is not.
    expect(await reg.firstSeenInUntrusted("b1", "s2", candidatesFromArgs({ to: "supplier@untrusted.example" }))).toHaveLength(1);
    expect(await reg.firstSeenInUntrusted("b2", "s3", candidatesFromArgs({ to: "supplier@untrusted.example" }))).toHaveLength(0);
    expect(await reg.firstSeenInUntrusted("b1", "s1", candidatesFromArgs({ to: "someone@else.example" }))).toHaveLength(0);
  });

  it("forgets a business after the ttl", async () => {
    let t = 0;
    const reg = new UntrustedRecipientRegistry({ ttlMs: 1000, now: () => t });
    await reg.record("b1", candidatesFromContent("x@y.example"));
    t = 2000;
    await reg.record("b2", candidatesFromContent("a@b.example"));
    expect(await reg.size("b1")).toBe(0);
    expect(await reg.size("b2")).toBe(1);
  });

  it("a seed joins the business's register; `all` and the seeded mark belong to the session", async () => {
    const reg = new UntrustedRecipientRegistry();
    expect(await reg.seed("b1", "s1", candidatesFromContent("old@files.example"), true)).toBe(1);
    expect(await reg.isSeeded("s1")).toBe(true);
    expect(await reg.isSeeded("s2")).toBe(false);
    const anyone = candidatesFromArgs({ to: "anyone@else.example" });
    expect(await reg.firstSeenInUntrusted("b1", "s1", anyone)).toHaveLength(1);
    expect(await reg.firstSeenInUntrusted("b1", "s2", anyone)).toHaveLength(0);
    expect(await reg.firstSeenInUntrusted("b1", "s2", candidatesFromArgs({ to: "old@files.example" }))).toHaveLength(1);
  });
});

/** Just enough of Redis for the shared register: sets, plain keys, expiry. */
function fakeRedis() {
  const sets = new Map<string, Set<string>>();
  const keys = new Map<string, string>();
  const ttls = new Map<string, number>();
  let down = false;
  const up = () => {
    if (down) throw new Error("redis is down");
  };
  return {
    ttls,
    setDown: (v: boolean) => {
      down = v;
    },
    client: {
      sadd: async (k: string, ...m: string[]) => (up(), m.filter((x) => !(sets.get(k) ?? sets.set(k, new Set()).get(k)!).has(x) && sets.get(k)!.add(x)).length),
      sismember: async (k: string, m: string) => (up(), sets.get(k)?.has(m) ? 1 : 0),
      scard: async (k: string) => (up(), sets.get(k)?.size ?? 0),
      set: async (k: string, v: string, _mode: "PX", ms: number) => (up(), keys.set(k, v), ttls.set(k, ms)),
      get: async (k: string) => (up(), keys.get(k) ?? null),
      pexpire: async (k: string, ms: number) => (up(), ttls.set(k, ms)),
      del: async (...k: string[]) => (up(), k.forEach((x) => (sets.delete(x), keys.delete(x)))),
    },
  };
}

describe("RedisUntrustedRegister", () => {
  it("is one register per business across replicas: a second register on the same Redis sees what the first recorded", async () => {
    const redis = fakeRedis();
    const replicaA = new RedisUntrustedRegister(redis.client);
    const replicaB = new RedisUntrustedRegister(redis.client);
    await replicaA.record("b1", candidatesFromContent("write to Supplier@Untrusted.example"));
    expect(await replicaB.firstSeenInUntrusted("b1", "other-session", candidatesFromArgs({ to: "supplier@untrusted.example" }))).toHaveLength(1);
    expect(await replicaB.firstSeenInUntrusted("b2", "other-session", candidatesFromArgs({ to: "supplier@untrusted.example" }))).toHaveLength(0);
    expect([...redis.ttls.keys()]).toContain("gw:untrusted:b1");
    expect(redis.ttls.get("gw:untrusted:b1")).toBeGreaterThan(0);
    // The seed is shared too: a replica that never minted the token still knows the session was seeded.
    await replicaA.seed("b1", "s9", candidatesFromContent("file@leftover.example"), true);
    expect(await replicaB.isSeeded("s9")).toBe(true);
    expect(await replicaB.firstSeenInUntrusted("b1", "s9", candidatesFromArgs({ to: "anyone@else.example" }))).toHaveLength(1);
    await replicaB.clear("b1", "s9");
    expect(await replicaB.size("b1")).toBe(0);
  });

  it("answers from this process's memory while Redis is down, and never loses what it saw", async () => {
    const redis = fakeRedis();
    const fallbacks: unknown[] = [];
    const reg = new RedisUntrustedRegister(redis.client, { onFallback: (e) => fallbacks.push(e) });
    redis.setDown(true);
    expect(await reg.record("b1", candidatesFromContent("a@b.example"))).toBe(1);
    expect(await reg.firstSeenInUntrusted("b1", "s1", candidatesFromArgs({ to: "a@b.example" }))).toHaveLength(1);
    expect(fallbacks).toHaveLength(1);
  });
});
