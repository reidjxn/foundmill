/**
 * `POST /v1/domains/own` (WP-08 domain plan, Path B): only the api asks; add starts SendGrid's domain authentication
 * once per domain and writes the row pending with its records; check verifies only when every sending record is found
 * and never lets a second project verify a domain; remove takes the row away; a mock answer is never written for a
 * person's project on staging or production; and a verified domain becomes the From of the project's mail, with the
 * Foundmill address as Reply-To.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRegistry, createSendingDomainConnector, ownershipRecord, routedFetch, sendingDomainMock } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { createGatewayApp } from "../app";
import type { GatewayDeps } from "../pipeline";
import { MemoryRateLimitStore } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { preparePlatformMail } from "../platform-mail";
import { signServiceToken } from "../tokens";
import { silentLog, TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let A: string;
let B: string;
let USER: string;

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  A = (await repos.businesses.create(db, { name: "Acme Goods" })).id;
  B = (await repos.businesses.create(db, { name: "Other Goods" })).id;
  USER = await h.createUser("own-domain-founder@test.local");
  await repos.postalAddress.set(db, A, { address: "PO Box 1, Springfield, IL 62701, USA", userId: null });
}, 120_000);
afterAll(() => h?.close());

function appFor(opts: { connector?: ReturnType<typeof createSendingDomainConnector>; mode?: "mock" | "live"; appEnv?: string } = {}) {
  const deps: GatewayDeps = { db, registry: createRegistry([opts.connector ?? sendingDomainMock]), vault: null, mode: opts.mode ?? "mock", rateLimits: new MemoryRateLimitStore(), recipients: new UntrustedRecipientRegistry(), log: silentLog, ...(opts.appEnv ? { appEnv: opts.appEnv } : {}) };
  return createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET });
}

async function post(app: ReturnType<typeof appFor>, body: unknown, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await app.request("/v1/domains/own", { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { simulated?: boolean; domain?: { domain: string; status: string; senderLocalPart: string; records: { purpose: string; host: string; found: boolean | null }[] } | null; error?: { code: string } } };
}

describe("a project's own domain through the gateway", () => {
  it("only the api may ask, with a service token", async () => {
    const app = appFor();
    expect((await post(app, { action: "remove", businessId: A }, "orchestrator")).status).toBe(403);
    expect((await post(app, { action: "remove", businessId: A }, null)).status).toBe(401);
  });

  it("adds, checks and verifies; the site record is shown beside SendGrid's", async () => {
    const app = appFor();
    const added = await post(app, { action: "add", businessId: A, userId: USER, domain: "https://www.Acme-Goods.com/", senderLocalPart: "maya", siteHost: "acme-goods.foundmill.app" });
    expect(added.status).toBe(200);
    expect(added.body.simulated).toBe(true);
    expect(added.body.domain).toMatchObject({ domain: "acme-goods.com", status: "pending", senderLocalPart: "maya" });
    expect(added.body.domain?.records.map((r) => [r.purpose, r.host, r.found])).toEqual([
      ["sending", "_foundmill.acme-goods.com", null],
      ["sending", "em.acme-goods.com", null],
      ["sending", "s1._domainkey.acme-goods.com", null],
      ["sending", "s2._domainkey.acme-goods.com", null],
      ["site", "www.acme-goods.com", null],
    ]);
    const checked = await post(app, { action: "check", businessId: A, siteHost: "acme-goods.foundmill.app" });
    expect(checked.body.domain?.status).toBe("verified");
    expect(checked.body.domain?.records.every((r) => r.found === true)).toBe(true);
    expect(await repos.projectDomains.sendingFrom(db, A, { live: false })).toEqual({ email: "maya@acme-goods.com", domain: "acme-goods.com" });
    // Verified by the mock: never the From of a live send.
    expect(await repos.projectDomains.sendingFrom(db, A, { live: true })).toBeNull();
  });

  it("the project's mail goes from the verified domain, and replies still come back to its Foundmill address", async () => {
    const decision = await preparePlatformMail(
      { db, rateLimits: new MemoryRateLimitStore(), config: { domain: "mail.foundmill.test", dailyCap: 50, ceiling: 2000, signingSecret: null, unsubscribeBase: "http://ingest.test" }, appEnv: "test" },
      { business: { id: A, name: "Acme Goods", isDemo: false }, args: { to: { email: "pat@example.com" }, subject: "Hi", text: "Hello" }, mode: "mock", now: Date.now() },
    );
    expect(decision.ok, JSON.stringify(decision)).toBe(true);
    if (!decision.ok) return;
    expect(decision.prepared.envelope.from.email).toBe("maya@acme-goods.com");
    expect(decision.prepared.envelope.replyTo?.email).toMatch(/@mail\.foundmill\.test$/);
  });

  it("the same domain again keeps its verification and changes only the sender", async () => {
    const again = await post(appFor(), { action: "add", businessId: A, userId: USER, domain: "acme-goods.com", senderLocalPart: "hello", siteHost: null });
    expect(again.body.domain).toMatchObject({ status: "verified", senderLocalPart: "hello" });
  });

  it("each project's ownership record is its own, so passing SendGrid's check for another project proves nothing", async () => {
    const records = (id: string) => ownershipRecord(id, "shared-goods.com");
    expect(records(A).host).toBe("_foundmill.shared-goods.com");
    expect(records(A).value).not.toBe(records(B).value);
    // B's check of a domain whose DNS carries only SendGrid's records (the mock finds everything but "notyet" hosts) and
    // A's TXT: the live check_records would not find B's value; here a stand-in DNS answers only A's.
    const dnsOnlyA = createSendingDomainConnector({
      secrets: { sendgridApiKey: "SG.k" },
      dns: { resolveCname: async () => [], resolveMx: async () => [], resolveTxt: async (n) => (n === "_foundmill.shared-goods.com" ? [[records(A).value]] : []) },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/whitelabel/domains": async () => Response.json({ id: 91, dns: { mail_cname: { host: "em.shared-goods.com", type: "cname", data: "u7.wl.sendgrid.net" } } }),
        "GET https://api.sendgrid.com/v3/whitelabel/domains/91": async () => Response.json({ id: 91, dns: { mail_cname: { host: "em.shared-goods.com", type: "cname", data: "u7.wl.sendgrid.net" } } }),
        "POST https://api.sendgrid.com/v3/whitelabel/domains/91/validate": async () => Response.json({ id: 91, valid: true, validation_results: { mail_cname: { valid: true } } }),
        "DELETE https://api.sendgrid.com/v3/whitelabel/domains/91": async () => new Response(null, { status: 204 }),
      }),
    });
    const live = appFor({ connector: dnsOnlyA, mode: "live" });
    await post(live, { action: "add", businessId: B, userId: USER, domain: "shared-goods.com", senderLocalPart: "hello", siteHost: null });
    const checked = await post(live, { action: "check", businessId: B, siteHost: null });
    expect(checked.body.domain?.status).toBe("pending");
    expect(checked.body.domain?.records.find((r) => r.host === "_foundmill.shared-goods.com")?.found).toBe(false);
    await post(live, { action: "remove", businessId: B });
  });

  it("a domain another project sends from for real is refused before SendGrid is called", async () => {
    const C = (await repos.businesses.create(db, { name: "Real Goods" })).id;
    await repos.projectDomains.put(db, C, { domain: "real-taken.com", senderLocalPart: "hello", sendgridDomainId: "5", records: [], addedBy: null, simulated: false });
    await repos.projectDomains.saveCheck(db, C, { records: [], verified: true, now: new Date() });
    const taken = await post(appFor(), { action: "add", businessId: B, userId: USER, domain: "real-taken.com", senderLocalPart: "hello", siteHost: null });
    expect(taken.status).toBe(409);
    expect(taken.body.error?.code).toBe("domain_taken");
  });

  it("a project adds at most ten domains a day", async () => {
    const app = appFor();
    const D = (await repos.businesses.create(db, { name: "Busy Goods" })).id;
    for (let i = 0; i < 10; i++) expect((await post(app, { action: "add", businessId: D, userId: USER, domain: `busy-${i}.com`, senderLocalPart: "hello", siteHost: null })).status).toBe(200);
    expect((await post(app, { action: "add", businessId: D, userId: USER, domain: "busy-10.com", senderLocalPart: "hello", siteHost: null })).status).toBe(429);
  });

  it("records not found yet stay pending, with a line each", async () => {
    const app = appFor();
    await post(app, { action: "add", businessId: B, userId: USER, domain: "notyet-goods.com", senderLocalPart: "hello", siteHost: null });
    const checked = await post(app, { action: "check", businessId: B, siteHost: null });
    expect(checked.body.domain?.status).toBe("pending");
    expect(checked.body.domain?.records.every((r) => r.found === false)).toBe(true);
  });

  it("refuses what is not a domain, or a sender name with spaces, before calling SendGrid", async () => {
    const app = appFor();
    expect((await post(app, { action: "add", businessId: B, userId: USER, domain: "not a domain", senderLocalPart: "hello", siteHost: null })).status).toBe(400);
    expect((await post(app, { action: "add", businessId: B, userId: USER, domain: "foundmill-ish.com", senderLocalPart: "hello", siteHost: null })).status).toBe(400);
    expect((await post(app, { action: "add", businessId: B, userId: USER, domain: "ok.com", senderLocalPart: "Hi There", siteHost: null })).status).toBe(400);
  });

  it("never writes a mock answer for a person's project on staging", async () => {
    const res = await post(appFor({ appEnv: "staging" }), { action: "add", businessId: B, userId: USER, domain: "real-goods.com", senderLocalPart: "hello", siteHost: null });
    expect(res.status).toBe(409);
    expect((await repos.projectDomains.get(db, B))?.domain).toBe("notyet-goods.com");
  });

  it("live: calls SendGrid on the platform key, and removes the authentication with the row", async () => {
    const calls: string[] = [];
    const connector = createSendingDomainConnector({
      secrets: { sendgridApiKey: "SG.k" },
      dns: { resolveCname: async () => [], resolveMx: async () => [], resolveTxt: async () => [] },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/whitelabel/domains": async () => (calls.push("add"), Response.json({ id: 77, dns: { mail_cname: { host: "em.live-goods.com", type: "cname", data: "u7.wl.sendgrid.net" } } })),
        "DELETE https://api.sendgrid.com/v3/whitelabel/domains/77": async () => (calls.push("delete"), new Response(null, { status: 204 })),
      }),
    });
    const app = appFor({ connector, mode: "live" });
    expect((await post(app, { action: "add", businessId: B, userId: USER, domain: "live-goods.com", senderLocalPart: "hello", siteHost: null })).body.domain?.records.map((r) => r.host)).toEqual(["_foundmill.live-goods.com", "em.live-goods.com"]);
    expect((await post(app, { action: "remove", businessId: B })).body.domain).toBeNull();
    expect(await repos.projectDomains.get(db, B)).toBeNull();
    // Replacing notyet-goods.com tried to remove its (mock) authentication too; only the live calls are counted here.
    expect(calls).toEqual(["add", "delete"]);
  });
});
