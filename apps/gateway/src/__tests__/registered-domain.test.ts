/**
 * `POST /v1/domains/register` (WP-08 domain plan, Path A): only the api asks; a quote is OpenSRS's cost plus $3; a mock
 * registration runs only for a paid domain checkout (0149), once, with the founder as owner and every record set, and
 * never on a simulated payment when OpenSRS is live; nothing simulated is written for a person's project on staging.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpensrsConnector, createRegistry, MOCK_COM_COST_MINOR, opensrsMock, sendingDomainMock } from "@foundmill/connectors";
import { repos, settleCreditCheckout, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { createGatewayApp } from "../app";
import type { GatewayDeps } from "../pipeline";
import { MemoryRateLimitStore } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { signServiceToken } from "../tokens";
import { silentLog, TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let A: string;
let USER: string;
const OWNER = { firstName: "Maya", lastName: "Lee", address1: "12 Elm Street", city: "Springfield", state: "IL", postalCode: "62701", country: "US", phone: "+1.2175550123", email: "maya@example.com" };
const PRICE = MOCK_COM_COST_MINOR + 300;

/** A domain checkout for acme-goods.com with the founder's details: open, or paid on the mock. */
async function order(status: "open" | "paid"): Promise<string> {
  const c = await repos.checkouts.create(db, A, { kind: "domain", mode: "mock", amountMinor: PRICE, domainName: "acme-goods.com", createdBy: USER });
  await repos.domainRegistrants.put(db, A, c.id, OWNER);
  if (status === "paid") await settleCreditCheckout(db, { businessId: A, checkoutId: c.id, externalId: null, eventId: `mock:${c.id}`, amountMinor: PRICE, currency: "USD", mode: "mock", paidAt: new Date(), actor: { kind: "user", id: USER } });
  return c.id;
}

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  A = (await repos.businesses.create(db, { name: "Acme Goods" })).id;
  USER = await h.createUser("registrant@test.local");
}, 120_000);
afterAll(() => h?.close());

function appFor(opts: { live?: boolean; appEnv?: string } = {}) {
  const registry = createRegistry([opts.live ? createOpensrsConnector({ secrets: {} }) : opensrsMock, sendingDomainMock]);
  const deps: GatewayDeps = { db, registry, vault: null, mode: "mock", ...(opts.live ? { liveConnectors: ["opensrs"] } : {}), rateLimits: new MemoryRateLimitStore(), recipients: new UntrustedRecipientRegistry(), log: silentLog, ...(opts.appEnv ? { appEnv: opts.appEnv } : {}) };
  return createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET });
}

async function post(app: ReturnType<typeof appFor>, body: unknown, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await app.request("/v1/domains/register", { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { quote?: { priceMinor: number | null; available: boolean }; domain?: { domain: string; source: string; records: { purpose: string; type: string }[]; priceMinor: number } | null; error?: { code: string } } };
}

describe("registering a domain through the gateway", () => {
  it("only the api may ask", async () => {
    expect((await post(appFor(), { action: "quote", businessId: A, domain: "acme.com" }, "orchestrator")).status).toBe(403);
    expect((await post(appFor(), { action: "quote", businessId: A, domain: "acme.com" }, null)).status).toBe(401);
  });

  it("quotes cost plus $3", async () => {
    expect((await post(appFor(), { action: "quote", businessId: A, domain: "acme-goods.com" })).body.quote).toEqual({ domain: "acme-goods.com", available: true, priceMinor: PRICE });
  });

  it("registers nothing without a paid domain checkout, and never on a simulated payment when OpenSRS is live", async () => {
    const open = await order("open");
    expect((await post(appFor(), { action: "register", businessId: A, userId: USER, checkoutId: open, siteHost: null })).body.error?.code).toBe("not_paid");
    const mockPaid = await order("paid");
    expect((await post(appFor({ live: true }), { action: "register", businessId: A, userId: USER, checkoutId: mockPaid, siteHost: null })).body.error?.code).toBe("not_paid");
    expect(await repos.projectDomains.get(db, A)).toBeNull();
  });

  it("nothing simulated for a person's project on staging", async () => {
    expect((await post(appFor({ appEnv: "staging" }), { action: "register", businessId: A, userId: USER, checkoutId: await order("paid"), siteHost: null })).status).toBe(409);
  });

  it("a mock registration writes the row with its records, as the founder's, once per payment", async () => {
    const paid = await order("paid");
    const res = await post(appFor(), { action: "register", businessId: A, userId: USER, checkoutId: paid, siteHost: "acme.foundmill.app" });
    expect(res.status).toBe(200);
    expect(res.body.domain).toMatchObject({ domain: "acme-goods.com", source: "registered", priceMinor: PRICE });
    expect(res.body.domain?.records.map((r) => r.purpose)).toEqual(["sending", "sending", "sending", "sending", "site", "inbound", "dmarc"]);
    const row = await repos.projectDomains.get(db, A);
    expect(row).toMatchObject({ addedBy: USER, simulated: true, registrarOrderId: expect.stringMatching(/^mock-/) });
    expect(await repos.domainRegistrants.get(db, A, paid)).toBeNull();
    expect((await post(appFor(), { action: "register", businessId: A, userId: USER, checkoutId: paid, siteHost: null })).status).toBe(409);
  });

  it("a registered domain is never replaced or removed by the own-domain route", async () => {
    const headers = { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, "api")}` };
    const res = await appFor().request("/v1/domains/own", { method: "POST", headers, body: JSON.stringify({ action: "remove", businessId: A }) });
    expect(res.status).toBe(409);
    expect((await repos.projectDomains.get(db, A))?.source).toBe("registered");
  });
});
