/**
 * `POST /billing/stripe` (audit 2026-10-12 #22): the platform Stripe webhook is the only way a live top-up becomes
 * credits. Only a delivery signed with STRIPE_BILLING_WEBHOOK_SECRET is read (never the businesses' secret, never a
 * fixture secret; without the secret nothing is accepted); a paid session grants its checkout's USD credits once and is
 * audited; a replay is refused, a duplicate event or a mismatched session grants nothing; an unpaid or expired session
 * grants nothing; another business's checkout is never touched.
 */
import { MOCK_NOW, stripeSignatureHeader } from "@foundmill/connectors";
import { creditsState, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BILLING_WEBHOOK_PATH } from "../billing";
import { createIngestHarness, json, type IngestHarness } from "./harness";

const SECRET = "whsec_test_platform_billing_0123456789";
const T = Math.floor(MOCK_NOW.getTime() / 1000);
const period = MOCK_NOW.toISOString().slice(0, 7);

let hz: IngestHarness;
beforeAll(async () => {
  hz = await createIngestHarness("billing", { billingWebhookSecret: SECRET });
}, 120_000);
afterAll(() => hz?.close());

let n = 0;
async function liveCheckout(businessId: string, amountMinor = 5000) {
  const row = await repos.checkouts.create(hz.db, businessId, { mode: "live", amountMinor });
  return repos.checkouts.attachSession(hz.db, businessId, row.id, { mode: "live", externalId: `cs_test_${row.id.replace(/-/g, "").slice(0, 24)}`, checkoutUrl: "https://checkout.stripe.com/c/pay/x" });
}
const sessionEvent = (type: string, c: { id: string; businessId: string; externalId: string | null; amountMinor: number }, over: Record<string, unknown> = {}) => ({
  id: `evt_billing_${++n}`,
  type,
  created: T,
  livemode: false,
  data: { object: { id: c.externalId, object: "checkout.session", mode: "payment", payment_status: "paid", amount_total: Number(c.amountMinor), currency: "usd", metadata: { foundmill_checkout_id: c.id, foundmill_business_id: c.businessId, foundmill_kind: "credits" }, ...over } },
});
async function post(event: unknown, opts: { secret?: string; timestamp?: number; base?: string } = {}) {
  const body = JSON.stringify(event);
  const res = await fetch(`${opts.base ?? hz.base}${BILLING_WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(opts.secret ?? SECRET, body, opts.timestamp ?? T) }, body });
  return { status: res.status, body: await json(res) };
}
// What the business can spend this period: the balance row, or what its tier includes before the month's first row (a
// top-up that comes first starts the row with the included credits).
const balance = async (businessId: string) => Number((await creditsState(hz.db, await repos.businesses.get(hz.db, businessId), period))?.balanceMinor ?? 0);

describe("POST /billing/stripe", () => {
  it("a paid session grants its checkout's credits once and audits it; the same event again is refused as a replay", async () => {
    const c = await liveCheckout(hz.A.businessId, 5000);
    const before = await balance(hz.A.businessId);
    const event = sessionEvent("checkout.session.completed", c);
    expect(await post(event)).toEqual({ status: 200, body: { ok: true, eventId: event.id, outcome: "granted" } });
    expect(await balance(hz.A.businessId)).toBe(before + 5000);
    expect(await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).toMatchObject({ status: "paid", paidEventId: event.id, grantedPeriod: period });
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "billing.credits_purchased" });
    expect(audit.items.find((a) => (a.target as { id?: string }).id === c.id)).toMatchObject({ actorKind: "webhook", details: { amountMinor: 5000, currency: "USD", mode: "live", eventId: event.id } });
    expect((await post(event)).status).toBe(409);
    // Stripe announces the same payment again under another event (async success after completion): nothing more.
    expect((await post(sessionEvent("checkout.session.async_payment_succeeded", c))).body).toMatchObject({ outcome: "duplicate" });
    expect(await balance(hz.A.businessId)).toBe(before + 5000);
  });

  it("refuses a delivery signed with any other secret (a fixture's, the businesses' Stripe secret), a stale one, or none", async () => {
    const c = await liveCheckout(hz.A.businessId, 2500);
    const before = await balance(hz.A.businessId);
    expect((await post(sessionEvent("checkout.session.completed", c), { secret: "whsec_mock_platform_signing_secret" })).status).toBe(401);
    expect((await post(sessionEvent("checkout.session.completed", c), { timestamp: T - 3600 })).status).toBe(401);
    const unsigned = await fetch(`${hz.base}${BILLING_WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sessionEvent("checkout.session.completed", c)) });
    expect(unsigned.status).toBe(401);
    expect(await balance(hz.A.businessId)).toBe(before);
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).status).toBe("open");
  });

  it("without STRIPE_BILLING_WEBHOOK_SECRET every delivery is refused, in mock mode too", async () => {
    const built = hz.build({ billingWebhookSecret: null });
    const c = await liveCheckout(hz.A.businessId, 2500);
    const body = JSON.stringify(sessionEvent("checkout.session.completed", c));
    const res = await built.app.request(BILLING_WEBHOOK_PATH, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(SECRET, body, T) }, body });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "billing_webhook_unconfigured" });
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).status).toBe("open");
  });

  it("grants nothing for an unpaid session, another amount, a mock checkout, or a checkout of another business", async () => {
    const c = await liveCheckout(hz.A.businessId, 10_000);
    const before = await balance(hz.A.businessId);
    const beforeB = await balance(hz.B.businessId);
    expect((await post(sessionEvent("checkout.session.completed", c, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "awaiting_payment" });
    expect((await post(sessionEvent("checkout.session.completed", c, { amount_total: 100 }))).body).toMatchObject({ outcome: "mismatch" });
    expect((await post(sessionEvent("checkout.session.completed", c, { currency: "eur" }))).body).toMatchObject({ outcome: "mismatch" });
    expect((await post(sessionEvent("checkout.session.completed", { ...c, businessId: hz.B.businessId }))).body).toMatchObject({ outcome: "unknown" });
    const mock = await repos.checkouts.create(hz.db, hz.A.businessId, { mode: "mock", amountMinor: 10_000 });
    expect((await post(sessionEvent("checkout.session.completed", { ...mock, externalId: "cs_test_forged", amountMinor: 10_000 }))).body).toMatchObject({ outcome: "mismatch" });
    expect(await balance(hz.A.businessId)).toBe(before);
    expect(await balance(hz.B.businessId)).toBe(beforeB);
    // Not a Foundmill top-up at all (another product on the platform account): acknowledged and ignored.
    expect((await post({ ...sessionEvent("checkout.session.completed", c), data: { object: { id: "cs_test_other", mode: "payment", payment_status: "paid", amount_total: 999, currency: "usd", metadata: {} } } })).body).toMatchObject({ outcome: "ignored" });
    expect((await post({ id: "evt_billing_invoice", type: "invoice.paid", created: T, data: { object: {} } })).body).toMatchObject({ outcome: "ignored" });
  });

  it("an expired session closes its checkout", async () => {
    const c = await liveCheckout(hz.A.businessId, 2500);
    expect((await post(sessionEvent("checkout.session.expired", c, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "expired" });
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).status).toBe("expired");
  });
});
