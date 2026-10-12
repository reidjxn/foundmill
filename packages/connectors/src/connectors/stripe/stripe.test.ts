import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { MOCK_NOW } from "../../mock-utils";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { MOCK_NOW_UNIX, MOCK_STRIPE_ACCOUNT_ID, ST_CHECKOUT_PAID, ST_CUSTOMERS, ST_INVOICES, ST_TRIAL_SUBSCRIPTION } from "./fixtures/stripe";
import { createStripeConnector } from "./index";
import { createStripeMock, signedStripeRequest, stripeEvent, stripeMock } from "./mock";
import { parseStripeSignature, verifyStripeSignature } from "./webhooks";

let n = 0;
const evt = <T>(type: string, object: T) => stripeEvent(type, object, `evt_test_${++n}`);

describeConnectorContract("stripe (mock)", {
  connector: stripeMock,
  mode: "mock",
  calls: [
    { tool: "get_account", args: {}, check: (r) => expect(r.data).toMatchObject({ id: MOCK_STRIPE_ACCOUNT_ID, country: "SE", defaultCurrency: "EUR", chargesEnabled: true }) },
    { tool: "get_balance", args: {}, check: (r) => expect(r.data).toMatchObject({ available: [{ amountMinor: 236_540, currency: "EUR" }] }) },
    { tool: "list_customers", args: {}, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(3) },
    { tool: "list_customers", args: { email: "anna.lind@example.com" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { id: string }[] }).items.map((c) => c.id)).toEqual(["cus_MockAnnaLind01"]) },
    { tool: "get_customer", args: { customerId: "cus_DoesNotExist01" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "get_customer", args: { customerId: "not-an-id" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "create_customer", args: { email: "new@example.com", name: "New Person" }, check: (r) => expect(r.data).toMatchObject({ email: "new@example.com", name: "New Person" }) },
    { tool: "list_invoices", args: { status: "paid" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(3) },
    { tool: "get_invoice", args: { invoiceId: "in_MockMaja0001Open" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ status: "open", amountDueMinor: 12_000, currency: "EUR", lines: [{ description: "Wholesale sample kit" }] }) },
    { tool: "create_invoice", args: { customerId: "cus_MockMajaBerg003", currency: "eur", lines: [{ description: "Consulting", amountMinor: 50_000 }] }, check: (r) => expect(r.data).toMatchObject({ status: "open", currency: "EUR", amountDueMinor: 50_000 }) },
    { tool: "send_invoice", args: { invoiceId: "in_MockAnna0001Paid" }, expectOk: false, check: (r) => expect(r.error?.status).toBe(400) },
    { tool: "create_checkout_session", args: { mode: "payment", lines: [{ description: "Sample kit", amountMinor: 12_000, currency: "EUR" }], successUrl: "https://northwind.example/ok", cancelUrl: "https://northwind.example/cancel" }, check: (r) => expect(r.data).toMatchObject({ mode: "payment", paymentStatus: "unpaid", amountTotalMinor: 12_000, url: expect.stringContaining("checkout.stripe.com") }) },
    { tool: "create_checkout_session", args: { mode: "subscription", successUrl: "https://northwind.example/ok", cancelUrl: "https://northwind.example/cancel" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "list_payouts", args: { limit: 2 }, check: (r) => expect((r.data as { items: unknown[] }).items).toHaveLength(2) },
  ],
  webhooks: [
    {
      name: "invoice.paid (subscription_create)",
      valid: () => signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!)),
      tampered: () => signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!), { secret: "whsec_wrong" }),
      replay: true,
      expectEvents: 1,
      expectTypes: ["payment.received"],
    },
    { name: "checkout.session.completed (one-off, paid)", valid: () => signedStripeRequest(TEST_BUSINESS_ID, evt("checkout.session.completed", ST_CHECKOUT_PAID)), expectEvents: 1, expectTypes: ["payment.received"] },
    { name: "checkout.session.completed (subscription mode → invoice.paid follows)", valid: () => signedStripeRequest(TEST_BUSINESS_ID, evt("checkout.session.completed", { ...ST_CHECKOUT_PAID, mode: "subscription" as const })), expectEvents: 0 },
    { name: "customer.subscription.created (trialing)", valid: () => signedStripeRequest(TEST_BUSINESS_ID, evt("customer.subscription.created", ST_TRIAL_SUBSCRIPTION)), expectEvents: 1, expectTypes: ["signup.created"] },
    { name: "customer.subscription.deleted (no catalogue event)", valid: () => signedStripeRequest(TEST_BUSINESS_ID, evt("customer.subscription.deleted", { ...ST_TRIAL_SUBSCRIPTION, status: "canceled" })), expectEvents: 0 },
  ],
});

describe("stripe hard gates", () => {
  it("never moves money: payouts, transfers, refunds and Connect onboarding are human-action descriptors", async () => {
    const ctx = makeToolContext(stripeMock);
    for (const [tool, args] of [
      ["create_payout", { amountMinor: 50_000, currency: "EUR" }],
      ["create_transfer", { amountMinor: 50_000, currency: "EUR", destinationAccountId: "acct_1Other000" }],
      ["refund_payment", { paymentIntentId: "pi_MockKit0001" }],
      ["start_connect_onboarding", {}],
    ] as const) {
      const r = await stripeMock.callTool(tool, args, ctx);
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe("hard_gate");
      expect(r.data).toMatchObject({ tool, url: expect.stringContaining("dashboard.stripe.com") });
      expect(stripeMock.policyHints[tool]?.hardGate).toBe(true);
    }
    expect(stripeMock.policyHints.create_payout).toMatchObject({ spendsMoney: true, irreversible: true });
    expect(stripeMock.policyHints.create_checkout_session).toEqual({});
    expect(stripeMock.policyHints.send_invoice).toEqual({ contactsThirdParty: true, irreversible: true });
  });
});

describe("stripe webhook normalisation and signature details", () => {
  it("maps invoice.paid into payment.received with first-payment and recurring flags", async () => {
    const [first] = await stripeMock.webhooks![0]!.normalise(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!)));
    expect(first!.payload).toMatchObject({ provider: "stripe", externalId: "in_MockAnna0001Paid", amount: { amountMinor: 4900, currency: "EUR" }, firstPayment: true, recurring: true, productRef: "Pro monthly" });
    expect(first!.occurredAt.toISOString()).toBe("2026-07-14T09:13:20.000Z");
    const [renewal] = await stripeMock.webhooks![0]!.normalise(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[1]!)));
    expect(renewal!.payload).toMatchObject({ firstPayment: false, recurring: true });
    expect(renewal!.entityIds).toEqual(first!.entityIds);
  });
  it("rejects stale timestamps, malformed headers and events without an id", async () => {
    const webhook = stripeMock.webhooks![0]!;
    expect(await webhook.verify(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!), { timestamp: MOCK_NOW_UNIX - 3600 }))).toBe(false);
    const body = JSON.stringify(evt("invoice.paid", ST_INVOICES[0]!));
    expect(await webhook.verify(new Request(`https://ingest.example/webhooks/stripe/${TEST_BUSINESS_ID}`, { method: "POST", body, headers: { "stripe-signature": "garbage" } }))).toBe(false);
    expect(await webhook.verify(signedStripeRequest(TEST_BUSINESS_ID, { id: "", type: "invoice.paid", data: { object: {} } }))).toBe(false);
    expect(parseStripeSignature("t=1,v1=abc,v0=def,v1=ghi")).toEqual({ timestamp: 1, signatures: ["abc", "ghi"] });
    expect(verifyStripeSignature("s", "{}", "t=1,v1=00", 1000)).toBe(false);
  });
  it("simulations are deterministic and schema-valid", async () => {
    const a = await stripeMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "x", amountMinor: 9900 });
    const b = await stripeMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "x", amountMinor: 9900 });
    expect(a).toEqual(b);
    expect(a[0]!.payload).toMatchObject({ amount: { amountMinor: 9900, currency: "EUR" }, provider: "stripe" });
    expect((await stripeMock.simulate("signup.created", { businessId: TEST_BUSINESS_ID }))[0]!.type).toBe("signup.created");
    expect((await stripeMock.simulate("checkout.completed", { businessId: TEST_BUSINESS_ID }))[0]!.payload).toMatchObject({ amount: { amountMinor: 12_000 }, productRef: "Wholesale sample kit" });
  });
  it("mock state: created invoices can be sent once they are open", async () => {
    const mock = createStripeMock();
    const ctx = makeToolContext(mock);
    const created = await mock.callTool("create_invoice", { customerId: ST_CUSTOMERS[0]!.id, currency: "EUR", lines: [{ description: "Kit", amountMinor: 1000, quantity: 2 }] }, ctx);
    const id = (created.data as { id: string }).id;
    const sent = await mock.callTool("send_invoice", { invoiceId: id }, ctx);
    expect(sent.ok).toBe(true);
    expect(mock.sentInvoicesFor(ctx.businessId)).toEqual([id]);
  });
});

describe("stripe live (canned responses)", () => {
  it("sends the Stripe-Account header for Connect integrations and maps customers", async () => {
    let auth = "";
    let account = "";
    const connector = createStripeConnector({
      secrets: { stripeSecretKey: "sk_test_platform" },
      fetch: routedFetch({
        "GET https://api.stripe.com/v1/customers": (req) => ((auth = req.headers.get("authorization") ?? ""), (account = req.headers.get("stripe-account") ?? ""), jsonResponse({ object: "list", data: [ST_CUSTOMERS[0]], has_more: false })),
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live" });
    ctx.integration = { ...ctx.integration, externalAccountId: MOCK_STRIPE_ACCOUNT_ID, config: { kind: "connect" } };
    const r = await connector.callTool("list_customers", { email: "anna.lind@example.com" }, ctx);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(auth).toBe("Bearer sk_test_platform");
    expect(account).toBe(MOCK_STRIPE_ACCOUNT_ID);
    expect(isUntrusted(r.data) && r.data.content).toMatchObject({ items: [{ id: "cus_MockAnnaLind01", currency: "EUR" }], hasMore: false });
  });
  it("prefers the business's own key and verifies webhooks with the per-business secret", async () => {
    let auth = "";
    const connector = createStripeConnector({
      secrets: { stripeSecretKey: "sk_test_platform", stripeWebhookSecret: "whsec_platform" },
      getBusinessSecret: async (_b, name) => (name === "stripe_webhook_secret" ? "whsec_business" : null),
      fetch: routedFetch({ "GET https://api.stripe.com/v1/balance": (req) => ((auth = req.headers.get("authorization") ?? ""), jsonResponse({ object: "balance", available: [{ amount: 100, currency: "eur" }], pending: [] })) }),
      now: () => MOCK_NOW,
    });
    const r = await connector.callTool("get_balance", {}, makeToolContext(connector, { mode: "live", credential: { kind: "api_key", secret: "rk_test_business" } }));
    expect(r.ok).toBe(true);
    expect(auth).toBe("Bearer rk_test_business");
    const webhook = connector.webhooks![0]!;
    expect(await webhook.verify(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!), { secret: "whsec_business" }))).toBe(true);
    expect(await webhook.verify(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!), { secret: "whsec_platform" }))).toBe(false);
  });
  it("throws ConfigError without any key", async () => {
    const c = createStripeConnector({ secrets: {} });
    await expect(c.callTool("get_balance", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(await c.webhooks![0]!.verify(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!)))).toBe(false);
  });
});

describe.skipIf(!envKeysPresent("STRIPE_SECRET_KEY"))("stripe (live, test mode)", () => {
  const connector = createStripeConnector({ secrets: { stripeSecretKey: process.env.STRIPE_SECRET_KEY, stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET } });
  describeConnectorContract("stripe live", { connector, mode: "live", deterministic: false, connectInput: { apiKey: process.env.STRIPE_SECRET_KEY }, calls: [{ tool: "get_balance", args: {} }, { tool: "list_customers", args: { limit: 1 } }] });
});
