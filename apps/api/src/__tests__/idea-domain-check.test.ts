/**
 * `idea.domainCheck` (audit 2026-10-13 #458): the Commit screen's domain checker asks the registries through the gateway.
 * Protected like the other idea procedures; input is a business name or up to eight valid domains (never a URL or an
 * unlisted TLD); the answer is one `{ domain, status, provenance, checkedAt, ... }` per name in the asked order; a gateway
 * that cannot answer is "not available right now", never an invented status; calls are rate limited per founder.
 */
import { AppError } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "../router";
import type { ApiGatewayClient, GatewayDomainAnswer } from "../services/gateway";
import { MODEL_LIMITS } from "../services/model-limits";
import { createApiHarness, type ApiHarness } from "./harness";

const asked: { ownerKey: string; domains: string[] }[] = [];
let failWith: unknown = null;

const NOW = "2026-10-13T15:45:00.000Z";
const answerFor = (domain: string): GatewayDomainAnswer => {
  if (domain.startsWith("google.")) return { domain, status: "taken", provenance: "Registry", estimate: false, checkedAt: NOW, registrar: "MarkMonitor Inc.", expires: "2028-09-14" };
  if (domain.endsWith(".io")) return { domain, status: "unknown", provenance: "DNS", estimate: true, checkedAt: NOW, reason: "No clear DNS answer" };
  return { domain, status: "available", provenance: "Registry", estimate: false, checkedAt: NOW };
};

let hz: ApiHarness;
beforeAll(async () => {
  const gateway = {
    connect: async () => {
      throw new Error("unused");
    },
    health: async () => {
      throw new Error("unused");
    },
    createCheckout: async () => {
      throw new Error("unused");
    },
    checkDomains: async (ownerKey, domains) => {
      asked.push({ ownerKey, domains });
      if (failWith) throw failWith;
      return domains.map(answerFor);
    },
    generatePortrait: async () => {
      throw new Error("unused");
    },
    repository: async () => {
      throw new Error("unused");
    },
    sendPush: async () => {
      throw new Error("unused");
    },
  } satisfies ApiGatewayClient;
  // The gateway is asked only when `domains` runs live; in mock mode the api answers from the mock itself (last test).
  hz = await createApiHarness({ prefix: "domaincheck", gateway, env: { LIVE_CONNECTORS: "domains" } });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => {
  hz.limits.reset();
  asked.length = 0;
  failWith = null;
});

const as = (userId: string) => createCaller(hz.deps, { userId, email: null });
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    return { code: err.code, message: err.message };
  }
};

describe("idea.domainCheck", () => {
  it("needs a signed-in founder", async () => {
    const anonymous = createCaller(hz.deps, null);
    expect(await refusal(anonymous.idea.domainCheck({ name: "Ledgerly" }))).toMatchObject({ code: "UNAUTHORIZED" });
    expect(asked).toEqual([]);
  });

  it("turns a business name into the five candidate domains and answers in that order, with where each answer came from", async () => {
    const result = await as(hz.A.ownerId).idea.domainCheck({ name: "Ledgerly HQ" });
    expect(asked).toEqual([{ ownerKey: hz.A.ownerId, domains: ["ledgerlyhq.com", "ledgerlyhq.io", "ledgerlyhq.co", "ledgerlyhq.app", "ledgerlyhq.ai"] }]);
    expect(result.map((r) => [r.domain, r.status, r.provenance])).toEqual([
      ["ledgerlyhq.com", "available", "Registry"],
      ["ledgerlyhq.io", "unknown", "DNS"],
      ["ledgerlyhq.co", "available", "Registry"],
      ["ledgerlyhq.app", "available", "Registry"],
      ["ledgerlyhq.ai", "available", "Registry"],
    ]);
    expect(result[1]).toMatchObject({ estimate: true, reason: expect.any(String) });
    for (const r of result) expect(r.checkedAt).toBe(NOW);
  });

  it("passes registrar and expiry through, and takes explicit domains (lower-cased, without repeats)", async () => {
    const result = await as(hz.A.ownerId).idea.domainCheck({ domains: ["Google.com", "google.com", "fresh.dev"] });
    expect(asked[0]!.domains).toEqual(["google.com", "fresh.dev"]);
    expect(result[0]).toEqual({ domain: "google.com", status: "taken", provenance: "Registry", estimate: false, checkedAt: NOW, registrar: "MarkMonitor Inc.", expires: "2028-09-14" });
  });

  it("refuses bad input before the gateway: both or neither of name and domains, more than eight, URLs, unlisted TLDs, long names", async () => {
    const caller = as(hz.A.ownerId);
    const nine = Array.from({ length: 9 }, (_, i) => `n${i}.com`);
    const inputs: unknown[] = [{}, { name: "x", domains: ["a.com"] }, { domains: nine }, { domains: [] }, { domains: ["https://a.com/"] }, { domains: ["a.xyz"] }, { domains: ["a.com/../b"] }, { domains: ["a b.com"] }, { name: "" }, { name: "x".repeat(121) }];
    for (const input of inputs) expect((await refusal(caller.idea.domainCheck(input as never)))?.code, JSON.stringify(input).slice(0, 60)).toBe("BAD_REQUEST");
    expect(asked).toEqual([]);
    // Bad input does not spend the founder's allowance.
    const limit = MODEL_LIMITS.domains.user[0]!.limit;
    for (let i = 0; i < limit + 3; i++) await refusal(caller.idea.domainCheck({ domains: nine } as never));
    expect(await refusal(caller.idea.domainCheck({ name: "Ledgerly" }))).toBeNull();
  });

  it("a name with nothing a domain can be made of answers nothing, without asking the gateway", async () => {
    expect(await as(hz.A.ownerId).idea.domainCheck({ name: "日本" })).toEqual([]);
    expect(await as(hz.A.ownerId).idea.domainCheck({ name: "x".repeat(70) })).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("a gateway that cannot answer is 'not available right now', never a made-up status; its own rate limit is passed on", async () => {
    failWith = new AppError("gateway_unreachable", "The gateway did not answer: connect ECONNREFUSED 10.0.0.5:4001", 503);
    const down = await refusal(as(hz.A.ownerId).idea.domainCheck({ name: "Ledgerly" }));
    expect(down).toEqual({ code: "SERVICE_UNAVAILABLE", message: "The domain check is not available right now. Try again in a minute." });
    expect(down?.message).not.toMatch(/ECONNREFUSED|10\.0\.0/);
    failWith = new Error("boom");
    expect((await refusal(as(hz.A.ownerId).idea.domainCheck({ name: "Ledgerly" })))?.code).toBe("SERVICE_UNAVAILABLE");
    failWith = new AppError("rate_limited", "Too many domain checks. Try again in 12 seconds.", 429);
    expect(await refusal(as(hz.A.ownerId).idea.domainCheck({ name: "Ledgerly" }))).toEqual({ code: "TOO_MANY_REQUESTS", message: "Too many domain checks. Try again in 12 seconds." });
  });

  it("is rate limited per founder, with a sentence they can act on, and asks nobody once the window is full", async () => {
    const rule = MODEL_LIMITS.domains.user[0]!;
    for (let i = 0; i < rule.limit; i++) expect(await refusal(as(hz.A.ownerId).idea.domainCheck({ name: "Ledgerly" }))).toBeNull();
    const before = asked.length;
    expect(await refusal(as(hz.A.ownerId).idea.domainCheck({ name: "Ledgerly" }))).toEqual({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^Domain check limit reached\. Try again in (a minute|\d+ minutes)\.$/) });
    expect(asked).toHaveLength(before);
    // Another founder keeps their own allowance.
    expect(await refusal(as(hz.A.memberId).idea.domainCheck({ name: "Ledgerly" }))).toBeNull();
  });

  it("in mock mode answers from the deterministic mock without a gateway: Mock on every row, a fixed list taken", async () => {
    const mock = await createApiHarness({ prefix: "domaincheckmock" });
    try {
      const caller = createCaller(mock.deps, { userId: mock.A.ownerId, email: null });
      const result = await caller.idea.domainCheck({ name: "Northwind" });
      expect(result.map((r) => [r.domain, r.status, r.provenance])).toEqual(["com", "io", "co", "app", "ai"].map((tld) => [`northwind.${tld}`, "taken", "Mock"]));
      const free = await caller.idea.domainCheck({ domains: ["ledgerly.com", "unknown-x.io"] });
      expect(free.map((r) => [r.status, r.provenance])).toEqual([["available", "Mock"], ["unknown", "Mock"]]);
      expect(free[1]!.reason).toBeTruthy();
      // By business name the label has no hyphen, and the unknown path is still reachable.
      const byName = await caller.idea.domainCheck({ name: "unknown-brand" });
      expect(byName.map((r) => [r.domain, r.status])).toEqual(["com", "io", "co", "app", "ai"].map((tld) => [`unknownbrand.${tld}`, "unknown"]));
    } finally {
      await mock.close();
    }
  }, 60_000);
});
