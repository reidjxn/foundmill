/**
 * `POST /v1/domains/check` (audit 2026-10-13 #458): only the api asks; the `domains` connector answers (the mock in mock
 * mode, the registry's RDAP in live mode through the gateway's own fetch); input is validated before any lookup; the
 * founder's window limits the calls; nothing about the names is stored or logged.
 */
import { describe, expect, it } from "vitest";
import { createDomainsConnector, createRegistry, domainsMock, jsonResponse, type DomainAnswer } from "@foundmill/connectors";
import type { Db } from "@foundmill/db";
import { createGatewayApp } from "../app";
import type { GatewayDeps } from "../pipeline";
import { MemoryRateLimitStore } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { signServiceToken } from "../tokens";
import { silentLog, TEST_SECRET } from "./harness";

const OWNER = "7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

function appFor(mode: "mock" | "live", fetchImpl?: typeof fetch, rateLimits = new MemoryRateLimitStore()) {
  const connector = createDomainsConnector({ fetch: fetchImpl, dns: { resolveNs: async () => Promise.reject(Object.assign(new Error("x"), { code: "ESERVFAIL" })), resolveSoa: async () => Promise.reject(Object.assign(new Error("x"), { code: "ESERVFAIL" })) } });
  // The route never touches the database. A fixed clock: the limit counts per clock minute, and a real clock that
  // crossed a minute between two calls let the 21st call through (seen once in CI, Nov 25, 2026).
  const now = new Date("2026-11-25T12:00:10Z");
  const deps: GatewayDeps = { db: undefined as unknown as Db, registry: createRegistry([connector]), vault: null, mode, rateLimits, recipients: new UntrustedRecipientRegistry(), log: silentLog, now: () => now };
  return createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET });
}

async function post(app: ReturnType<typeof appFor>, body: unknown, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await app.request("/v1/domains/check", { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { mode?: string; results?: DomainAnswer[]; error?: { code: string; message: string } } };
}

describe("domain checks through the gateway", () => {
  it("mock mode: deterministic answers, provenance Mock, the connector's contract shape", async () => {
    const res = await post(appFor("mock"), { ownerKey: OWNER, domains: ["ledgerly.com", "Google.io", "unknown-x.ai"] });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("mock");
    expect(res.body.results?.map((a) => [a.domain, a.status, a.provenance])).toEqual([
      ["ledgerly.com", "available", "Mock"],
      ["google.io", "taken", "Mock"],
      ["unknown-x.ai", "unknown", "Mock"],
    ]);
    expect(res.body.results?.[0]).toMatchObject({ estimate: false, checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(domainsMock.key).toBe("domains");
  });

  it("live mode: asks the registry through the gateway, once per name, and never reports a guess", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      if (url === "https://data.iana.org/rdap/dns.json") return jsonResponse({ services: [[["com"], ["https://rdap.registry.test/com/"]]] });
      return url.endsWith("/taken.com") ? jsonResponse({ objectClassName: "domain" }) : new Response("", { status: 404 });
    }) as typeof fetch;
    const res = await post(appFor("live", fetchImpl), { ownerKey: OWNER, domains: ["taken.com", "free.com", "free.io"] });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("live");
    expect(res.body.results?.map((a) => [a.domain, a.status, a.provenance, a.estimate])).toEqual([
      ["taken.com", "taken", "Registry", false],
      ["free.com", "available", "Registry", false],
      ["free.io", "unknown", "DNS", true],
    ]);
    expect(asked.filter((u) => u.includes("rdap.registry.test"))).toEqual(["https://rdap.registry.test/com/domain/taken.com", "https://rdap.registry.test/com/domain/free.com"]);
  });

  it("only the api may ask, with a service token", async () => {
    const app = appFor("mock");
    expect((await post(app, { ownerKey: OWNER, domains: ["a.com"] }, "orchestrator")).status).toBe(403);
    expect((await post(app, { ownerKey: OWNER, domains: ["a.com"] }, null)).status).toBe(401);
  });

  it("refuses bad input before any lookup: more than eight names, none, a URL, an unlisted TLD, a missing owner", async () => {
    const asked: string[] = [];
    const app = appFor("live", (async (input: RequestInfo | URL) => (asked.push(String(input)), new Response("", { status: 404 }))) as typeof fetch);
    const nine = Array.from({ length: 9 }, (_, i) => `n${i}.com`);
    for (const body of [{ ownerKey: OWNER, domains: nine }, { ownerKey: OWNER, domains: [] }, { ownerKey: OWNER, domains: ["https://a.com/"] }, { ownerKey: OWNER, domains: ["a.xyz"] }, { ownerKey: OWNER, domains: ["a.com/../x"] }, { domains: ["a.com"] }, { ownerKey: "not-a-guid", domains: ["a.com"] }]) {
      const res = await post(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error?.code).toBe("validation");
    }
    expect(asked).toEqual([]);
  });

  it("limits each founder's calls per minute (the connector's window), without touching other founders", async () => {
    const app = appFor("mock");
    for (let i = 0; i < 20; i++) expect((await post(app, { ownerKey: OWNER, domains: ["a.com"] })).status).toBe(200);
    const limited = await post(app, { ownerKey: OWNER, domains: ["a.com"] });
    expect(limited.status).toBe(429);
    expect(limited.body.error?.code).toBe("rate_limited");
    expect(limited.body.error?.message).toMatch(/Try again in \d+ seconds/);
    expect((await post(app, { ownerKey: "0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e", domains: ["a.com"] })).status).toBe(200);
  });
});
