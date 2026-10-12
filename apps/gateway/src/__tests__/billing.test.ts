/**
 * `POST /v1/billing/checkout-sessions` (audit 2026-10-12 #22): only the api opens a checkout; live mode creates a
 * Stripe Checkout session on the platform account (platform key, no Stripe-Account header, the checkout id in the
 * metadata) and answers with Stripe's page; mock mode runs the mock tool and answers with the success URL; a missing
 * STRIPE_SECRET_KEY is a clear 503; every opened checkout is audited.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRegistry, createStripeConnector, jsonResponse, routedFetch, stripeMock } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { createGatewayApp } from "../app";
import type { GatewayDeps } from "../pipeline";
import { MemoryRateLimitStore } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { signServiceToken } from "../tokens";
import { silentLog, TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let businessId: string;
beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  businessId = (await repos.businesses.create(db, { name: "Checkout Co" })).id;
}, 120_000);
afterAll(() => h?.close());

type Seen = { auth: string; account: string | null; body: URLSearchParams };

function appFor(mode: "mock" | "live", opts: { secretKey?: string; seen?: Seen[] } = {}) {
  const live = createStripeConnector({
    secrets: opts.secretKey ? { stripeSecretKey: opts.secretKey } : {},
    fetch: routedFetch({
      "POST https://api.stripe.com/v1/checkout/sessions": async (req) => {
        const body = new URLSearchParams(await req.text());
        opts.seen?.push({ auth: req.headers.get("authorization") ?? "", account: req.headers.get("stripe-account"), body });
        return jsonResponse({ id: "cs_test_platform123456", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_platform123456", mode: "payment", status: "open", payment_status: "unpaid", amount_total: Number(body.get("line_items[0][price_data][unit_amount]")), currency: body.get("line_items[0][price_data][currency]"), customer: null, customer_email: body.get("customer_email"), expires_at: 1_792_000_000, metadata: {} });
      },
    }),
  });
  const deps: GatewayDeps = { db, registry: createRegistry([live]), vault: null, mode, rateLimits: new MemoryRateLimitStore(), recipients: new UntrustedRecipientRegistry(), log: silentLog };
  return createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET });
}

const request = (checkoutId: string) => ({
  businessId,
  checkoutId,
  kind: "credits",
  amountMinor: 5000,
  currency: "USD",
  description: "Foundmill credits",
  successUrl: `https://foundmill.com/b/${businessId}/settings/billing?checkout=${checkoutId}`,
  cancelUrl: `https://foundmill.com/b/${businessId}/settings/billing?checkout=${checkoutId}&canceled=1`,
  customerEmail: "founder@example.com",
});

async function post(app: ReturnType<typeof appFor>, body: unknown, svc = "api") {
  const res = await app.request("/v1/billing/checkout-sessions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, svc)}` }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("platform checkout sessions", () => {
  it("live: a Checkout session on the platform account, for exactly the amount, with the checkout id in its metadata", async () => {
    const seen: Seen[] = [];
    const app = appFor("live", { secretKey: "sk_test_platform", seen });
    const checkoutId = crypto.randomUUID();
    const res = await post(app, request(checkoutId));
    expect(res).toMatchObject({ status: 201, body: { mode: "live", session: { id: "cs_test_platform123456", url: "https://checkout.stripe.com/c/pay/cs_test_platform123456", amountTotalMinor: 5000, currency: "USD" } } });
    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.auth).toBe("Bearer sk_test_platform");
    expect(call.account).toBeNull();
    expect(call.body.get("mode")).toBe("payment");
    expect(call.body.get("line_items[0][price_data][unit_amount]")).toBe("5000");
    expect(call.body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(call.body.get("metadata[foundmill_checkout_id]")).toBe(checkoutId);
    expect(call.body.get("metadata[foundmill_business_id]")).toBe(businessId);
    expect(call.body.get("success_url")).toContain(`checkout=${checkoutId}`);
    const audit = await repos.audit.list(db, businessId, { action: "gateway.billing.checkout_created" });
    expect(audit.items.find((a) => (a.target as { id?: string }).id === checkoutId)).toMatchObject({ actorKind: "system", details: { mode: "live", sessionId: "cs_test_platform123456", amountMinor: 5000 } });
  });

  it("mock: the mock tool checks the same arguments and the simulated checkout is the success page", async () => {
    const before = stripeMock.sentInvoices.length;
    const checkoutId = crypto.randomUUID();
    const res = await post(appFor("mock"), request(checkoutId));
    expect(res).toMatchObject({ status: 201, body: { mode: "mock", session: { url: request(checkoutId).successUrl, amountTotalMinor: 5000, currency: "USD" } } });
    expect((res.body.session as { id: string }).id).toMatch(/^cs_test_/);
    expect(stripeMock.sentInvoices.length).toBe(before);
  });

  it("refuses other services, bad amounts and other currencies; without STRIPE_SECRET_KEY it says payments are not set up", async () => {
    const live = appFor("live");
    expect(await post(live, request(crypto.randomUUID()), "orchestrator")).toMatchObject({ status: 403, body: { error: { code: "forbidden_service" } } });
    expect((await post(live, { ...request(crypto.randomUUID()), amountMinor: 0 })).status).toBe(400);
    expect((await post(live, { ...request(crypto.randomUUID()), amountMinor: 2_000_000 })).status).toBe(400);
    expect((await post(live, { ...request(crypto.randomUUID()), currency: "EUR" })).status).toBe(400);
    expect(await post(live, { ...request(crypto.randomUUID()), businessId: "00000000-0000-4000-8000-000000000000" })).toMatchObject({ status: 404, body: { error: { code: "business_not_found" } } });
    expect(await post(live, request(crypto.randomUUID()))).toMatchObject({ status: 503, body: { error: { code: "payments_unconfigured", message: expect.stringMatching(/not set up/) } } });
    const res = await live.request("/v1/billing/checkout-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request(crypto.randomUUID())) });
    expect(res.status).toBe(401);
  });
});
