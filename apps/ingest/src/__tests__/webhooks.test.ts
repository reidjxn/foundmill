/**
 * Webhook receivers over a real ephemeral-port server: Stripe invoice.paid → payment.received + customer.converted
 * (+ the payer added to the CRM, conversion and journey rows), a renewal is revenue only, tampered signature 401,
 * replay 409, stale timestamp 401, idempotent duplicate,
 * SendGrid unsubscribe → lead.replied, GitHub merged PR → pr.merged (unmerged → nothing), unknown connector /
 * business 404, cross-business URL 422.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { signedGithubDeliveryRequest, signedSendgridEventRequest, signedStripeRequest } from "@foundmill/connectors";
import { mergedPullRequestPayload } from "@foundmill/connectors/connectors/github/mock";
import { GH_MERGED_PR } from "@foundmill/connectors/connectors/github/fixtures/repos";
import { sgEvent } from "@foundmill/connectors/connectors/sendgrid/mock";
import { MOCK_NOW_UNIX, ST_INVOICES, ST_TRIAL_SUBSCRIPTION } from "@foundmill/connectors/connectors/stripe/fixtures/stripe";
import { stripeEvent } from "@foundmill/connectors/connectors/stripe/mock";
import { listenIngest } from "../index";
import { createIngestHarness, deliver, json, type IngestHarness } from "./harness";

let hz: IngestHarness;
/** Conversion counts per business before any delivery (the db fixture seeds six). */
let baseA: Record<string, number>;

beforeAll(async () => {
  hz = await createIngestHarness("webhooks");
  baseA = await repos.journeys.countConversions(hz.db, hz.A.businessId);
}, 120_000);

afterAll(async () => {
  await hz.close();
});

const invoicePaid = (invoiceIndex = 0, overrides: Partial<(typeof ST_INVOICES)[number]> = {}, eventId?: string) => stripeEvent("invoice.paid", { ...ST_INVOICES[invoiceIndex]!, ...overrides }, eventId);

describe("Stripe invoice.paid", () => {
  it("writes payment.received and customer.converted through the outbox, with a conversion and a journey row", async () => {
    const res = await deliver(hz.base, signedStripeRequest(hz.A.businessId, invoicePaid(0)));
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; accepted: number; written: number; duplicates: number; eventIds: string[]; connector: string }>(res);
    expect(body).toMatchObject({ ok: true, connector: "stripe", accepted: 1, written: 1, duplicates: 0 });
    expect(body.eventIds).toHaveLength(2);

    const payments = await hz.events(hz.A.businessId, "payment.received");
    expect(payments).toHaveLength(1);
    const payment = payments[0]!;
    expect(payment.payload).toMatchObject({ provider: "stripe", externalId: ST_INVOICES[0]!.id, firstPayment: true, recurring: true, amount: { amountMinor: 4900, currency: "EUR" } });
    expect(payment.actor).toEqual({ kind: "webhook", id: "stripe" });
    expect(payment.idempotencyKey).toBe(`stripe:payment.received:stripe:${ST_INVOICES[0]!.id}`);
    expect(payment.occurredAt.toISOString()).toBe(new Date((ST_INVOICES[0]!.status_transitions?.paid_at ?? 0) * 1000).toISOString());

    const converted = await hz.events(hz.A.businessId, "customer.converted");
    expect(converted).toHaveLength(1);
    const won = converted[0]!.payload as Record<string, unknown>;
    expect(won).toMatchObject({ kind: "payment", matchdayLevel: "cup", nthOfKind: 1, fullMatchDay: true, amount: { amountMinor: 4900, currency: "EUR" }, touchCount: 0, acquisitionCost: null });
    expect(won.entityId).toBe((payment.payload as { entityId: string }).entityId);

    const conversion = await repos.journeys.getConversion(hz.db, hz.A.businessId, won.conversionId as string);
    expect(conversion).toMatchObject({ kind: "payment", sourceEventId: payment.id, currency: "EUR", firstPayment: true });
    expect(Number(conversion.amountMinor)).toBe(4900);
    // The payer was not in the CRM: ingest added them, and every row names that record.
    expect(conversion.entityId).toBe(won.entityId);
    expect(payment.entityIds).toEqual([won.entityId]);
    const customer = await repos.entities.get(hz.db, hz.A.businessId, won.entityId as string);
    expect(customer).toMatchObject({ kind: "person", displayName: "Anna Lind", source: "stripe", identifiers: { email: "anna.lind@example.com", stripe_id: "cus_MockAnnaLind01" } });
    const journey = await repos.journeys.forConversion(hz.db, hz.A.businessId, conversion.id);
    expect(journey?.id).toBe(won.journeyId);
    expect(journey?.matchdayLevel).toBe("cup");
    expect(journey).toMatchObject({ attributionModel: "position_based_40_20_40", xcModelSource: "archetype_prior" });

    // Both rows sit in the outbox, unpublished, for the relay.
    const pending = await repos.events.outboxPending(hz.db, hz.A.businessId);
    expect(pending.map((p) => p.event.type).sort()).toEqual(["customer.converted", "payment.received"]);
  });

  it("rejects a tampered signature with 401 and writes nothing", async () => {
    const before = (await hz.events(hz.B.businessId)).length;
    const res = await deliver(hz.base, signedStripeRequest(hz.B.businessId, invoicePaid(2), { secret: "whsec_wrong" }));
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ ok: false, error: "invalid_signature", connector: "stripe" });
    expect((await hz.events(hz.B.businessId)).length).toBe(before);
  });

  it("refuses a replayed delivery with 409 (same event id, correct signature)", async () => {
    const req = signedStripeRequest(hz.A.businessId, invoicePaid(0));
    const res = await deliver(hz.base, req);
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ ok: false, error: "replayed" });
    expect(await hz.events(hz.A.businessId, "payment.received")).toHaveLength(1);
  });

  it("refuses a delivery whose timestamp is outside the replay window", async () => {
    const res = await deliver(hz.base, signedStripeRequest(hz.A.businessId, invoicePaid(1), { timestamp: MOCK_NOW_UNIX - 3600 }));
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ ok: false, error: "stale_timestamp" });
  });

  it("is idempotent on (connector, external id): a new delivery for the same invoice writes nothing", async () => {
    // A distinct Stripe event (new evt_ id) re-announcing invoice 0, e.g. a retried delivery after a redeploy.
    const res = await deliver(hz.base, signedStripeRequest(hz.A.businessId, invoicePaid(0, {}, "evt_retry_0001")));
    expect(res.status).toBe(200);
    const body = await json<{ written: number; duplicates: number; eventIds: string[] }>(res);
    expect(body).toMatchObject({ written: 0, duplicates: 1 });
    expect(await hz.events(hz.A.businessId, "payment.received")).toHaveLength(1);
    expect(await hz.events(hz.A.businessId, "customer.converted")).toHaveLength(1);
    expect((await repos.journeys.countConversions(hz.db, hz.A.businessId)).payment).toBe(baseA.payment! + 1);
  });

  it("records a renewal as revenue, not as a new customer: no journey and no customer.converted", async () => {
    const res = await deliver(hz.base, signedStripeRequest(hz.A.businessId, invoicePaid(1)));
    expect(res.status).toBe(200);
    const body = await json<{ written: number; eventIds: string[] }>(res);
    expect(body).toMatchObject({ written: 1 });
    expect(body.eventIds).toHaveLength(1); // the payment only
    const payments = await hz.events(hz.A.businessId, "payment.received");
    expect(payments).toHaveLength(2);
    const renewal = payments.find((p) => (p.payload as { externalId: string }).externalId === ST_INVOICES[1]!.id)!;
    expect(renewal.payload).toMatchObject({ firstPayment: false, recurring: true });
    const converted = await hz.events(hz.A.businessId, "customer.converted");
    expect(converted.map((c) => (c.payload as { nthOfKind: number }).nthOfKind)).toEqual([1]);
    const rows = await repos.journeys.listConversions(hz.db, hz.A.businessId, { kind: "payment", firstPayment: false });
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({ sourceEventId: renewal.id, firstPayment: false, entityId: (converted[0]!.payload as { entityId: string }).entityId });
    expect(await repos.journeys.forConversion(hz.db, hz.A.businessId, rows.items[0]!.id)).toBeNull();
    expect((await repos.journeys.countConversions(hz.db, hz.A.businessId)).payment).toBe(baseA.payment! + 1);
  });

  it("maps a trialing subscription to signup.created with a friendly Match Day", async () => {
    const res = await deliver(hz.base, signedStripeRequest(hz.B.businessId, stripeEvent("customer.subscription.created", ST_TRIAL_SUBSCRIPTION)));
    expect(res.status).toBe(200);
    const signups = await hz.events(hz.B.businessId, "signup.created");
    expect(signups).toHaveLength(1);
    expect(signups[0]!.payload).toMatchObject({ provider: "stripe", source: { utmSource: "instagram", utmMedium: "social" } });
    const converted = await hz.events(hz.B.businessId, "customer.converted");
    expect(converted).toHaveLength(1);
    expect(converted[0]!.payload).toMatchObject({ kind: "signup", matchdayLevel: "friendly", nthOfKind: 1, amount: null });
    // No money changed hands: the conversion row is in the business's own currency (0025), never a fixed EUR.
    const business = await repos.businesses.get(hz.db, hz.B.businessId);
    const conversion = await repos.journeys.getConversion(hz.db, hz.B.businessId, (converted[0]!.payload as { conversionId: string }).conversionId);
    expect(conversion.currency).toBe(business.currency);
  });

  it("answers 404 for a business that does not exist and releases the nonce so a retry is not a replay", async () => {
    const ghost = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
    const res = await deliver(hz.base, signedStripeRequest(ghost, invoicePaid(2, {}, "evt_ghost_0001")));
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ ok: false, error: "unknown_business" });
    expect(await hz.built.deps.nonces.has("stripe:acct_1MockNorthwind:evt_ghost_0001")).toBe(false);
  });
});

describe("SendGrid and GitHub", () => {
  it("SendGrid unsubscribe → lead.replied with an unsubscribe sentiment", async () => {
    const res = await deliver(hz.base, signedSendgridEventRequest(hz.A.businessId, [sgEvent("unsubscribe", "lead@example.com"), sgEvent("delivered", "lead@example.com")]));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, connector: "sendgrid", accepted: 1, written: 1 });
    const replies = await hz.events(hz.A.businessId, "lead.replied");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.payload).toMatchObject({ sentiment: "unsubscribe", channelKey: "email_automation", requestsMeeting: false });
    // Not a conversion trigger: no conversion rows were added for it.
    expect(await repos.journeys.countConversions(hz.db, hz.A.businessId)).toEqual({ ...baseA, payment: baseA.payment! + 1 });
  });

  it("GitHub pull_request closed + merged → pr.merged; the same PR re-delivered is a duplicate", async () => {
    const res = await deliver(hz.base, signedGithubDeliveryRequest(hz.A.businessId, "pull_request", mergedPullRequestPayload()));
    expect(res.status).toBe(200);
    const merged = await hz.events(hz.A.businessId, "pr.merged");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.payload).toMatchObject({ prNumber: GH_MERGED_PR.number, branch: "feat/annual-plan", baseBranch: "main", mergeCommitSha: GH_MERGED_PR.merge_commit_sha });
    expect(merged[0]!.idempotencyKey).toContain(`#${GH_MERGED_PR.number}:`);

    const again = await deliver(hz.base, signedGithubDeliveryRequest(hz.A.businessId, "pull_request", mergedPullRequestPayload(), { deliveryId: "another-delivery-id" }));
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ written: 0, duplicates: 1 });
    expect(await hz.events(hz.A.businessId, "pr.merged")).toHaveLength(1);
  });

  it("GitHub pull_request closed without merge verifies but emits nothing", async () => {
    const payload = mergedPullRequestPayload({ ...GH_MERGED_PR, number: 42, merged: false, merged_at: null, merge_commit_sha: null });
    const res = await deliver(hz.base, signedGithubDeliveryRequest(hz.A.businessId, "pull_request", payload));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, accepted: 0, written: 0 });
    expect(await hz.events(hz.A.businessId, "pr.merged")).toHaveLength(1);
  });

  it("GitHub delivery with a bad secret is 401", async () => {
    const res = await deliver(hz.base, signedGithubDeliveryRequest(hz.B.businessId, "pull_request", mergedPullRequestPayload(), { secret: "nope", deliveryId: "bad-secret-delivery" }));
    expect(res.status).toBe(401);
  });
});

describe("routing", () => {
  it("404s an unknown connector and a non-UUID business segment", async () => {
    const res = await fetch(`${hz.base}/webhooks/nope/${hz.A.businessId}`, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: "unknown_connector" });
    const bad = await fetch(`${hz.base}/webhooks/stripe/not-a-uuid`, { method: "POST", body: "{}" });
    expect(bad.status).toBe(404);
    expect(await json(bad)).toMatchObject({ error: "unknown_business" });
  });

  it("a shared endpoint without a business in the URL is refused when no resolver can map the account", async () => {
    const req = signedStripeRequest(hz.A.businessId, invoicePaid(2, {}, "evt_shared_0001"));
    const res = await fetch(`${hz.base}/webhooks/stripe`, { method: "POST", headers: req.headers, body: await req.text() });
    // No business in the URL and no account→business resolver: the mock verifies with its platform secret but
    // normalise finds no business, so nothing is accepted and nothing is written.
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ accepted: 0, written: 0 });
    expect(await hz.events(hz.A.businessId, "payment.received")).toHaveLength(2);
  });

  it("/health reports the mode, the nonce store and the mounted webhooks", async () => {
    const res = await fetch(`${hz.base}/health`);
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; service: string; db: boolean; mode: string; nonceStore: string; webhooks: { connector: string; path: string }[] }>(res);
    expect(body).toMatchObject({ ok: true, service: "ingest", db: true, mode: "mock", nonceStore: "memory" });
    expect(body.webhooks.map((w) => w.path)).toEqual(expect.arrayContaining(["/webhooks/stripe/:businessId", "/webhooks/sendgrid-inbound/:businessId", "/webhooks/github/:businessId", "/webhooks/shopify/:businessId", "/webhooks/dropbox_sign/:businessId"]));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("listenIngest binds an ephemeral port on :: (falling back to 0.0.0.0) and stops cleanly", async () => {
    const running = await listenIngest(hz.built.app, 0);
    try {
      expect(running.port).toBeGreaterThan(0);
      const res = await fetch(`${running.url}/health`);
      expect(res.status).toBe(200);
    } finally {
      await running.stop();
    }
  });
});

describe("bounded bodies (WP-11 T15)", () => {
  const big = "x".repeat(2 * 1024 * 1024);
  // In process (hz.built.app.request): over a socket an early answer closes the connection before 2 MB is uploaded.
  const post = (path: string, headers: Record<string, string> = {}) => hz.built.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: big });

  it("refuses 2 MB to a connector's webhook with 413 before its verifier runs", async () => {
    const res = await post(`/webhooks/stripe/${hz.A.businessId}`, { "stripe-signature": "t=1,v1=00" });
    expect(res.status).toBe(413);
    expect(await json<{ error: string }>(res)).toMatchObject({ error: "payload_too_large" });
    expect((await post("/webhooks/stripe")).status).toBe(413);
  });

  it("lets 2 MB through to GitHub, whose own cap is 25 MB, and judges it by its signature", async () => {
    const res = await post(`/webhooks/github/${hz.A.businessId}`, { "x-github-event": "ping", "x-hub-signature-256": "sha256=00", "x-github-delivery": "d-1" });
    expect(res.status).not.toBe(413);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses 2 MB to Foundmill's own billing webhook", async () => {
    expect((await post("/billing/stripe", { "stripe-signature": "t=1,v1=00" })).status).toBe(413);
  });

  it("/health says whether the platform address's mail can arrive, as three booleans", async () => {
    const body = await json<{ platformMail: Record<string, unknown> }>(await fetch(`${hz.base}/health`));
    expect(Object.keys(body.platformMail).sort()).toEqual(["domain", "events", "inbound"]);
    for (const v of Object.values(body.platformMail)) expect(typeof v).toBe("boolean");
  });
});
