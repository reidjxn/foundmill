import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { MOCK_NOW } from "../../mock-utils";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { MOCK_NOW_UNIX, MOCK_STRIPE_ACCOUNT_ID, ST_CHECKOUT_PAID, ST_CUSTOMERS, ST_INVOICES, ST_TRIAL_SUBSCRIPTION } from "./fixtures/stripe";
import { createStripeConnector, PLATFORM_BILLING_INTEGRATION_ID } from "./index";
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
    { tool: "create_billing_portal_session", args: { customerId: "cus_MockAnnaLind01", returnUrl: "https://foundmill.test/billing" }, check: (r) => expect((r.data as { url: string }).url).toContain("billing.stripe.com") },
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
    { name: "account.application.deauthorized (no catalogue event; ingest marks the connection expired)", valid: () => signedStripeRequest(TEST_BUSINESS_ID, evt("account.application.deauthorized", { id: "ca_test_platform", object: "application" })), expectEvents: 0 },
  ],
});

describe("stripe webhooks: Foundmill's access withdrawn in Stripe", () => {
  it("names the account only for account.application.deauthorized", async () => {
    const hook = stripeMock.webhooks![0]!;
    expect(await hook.revokedAccount!(signedStripeRequest(TEST_BUSINESS_ID, evt("account.application.deauthorized", { id: "ca_test_platform", object: "application" })))).toBe(MOCK_STRIPE_ACCOUNT_ID);
    expect(await hook.revokedAccount!(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!)))).toBeNull();
  });
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
    // Founder, Nov 16, 2026: a payment page and a finalized invoice ask first (payment powers decide automated mode).
    expect(stripeMock.policyHints.create_checkout_session).toEqual({ irreversible: true });
    expect(stripeMock.policyHints.create_invoice).toEqual({ irreversible: true });
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
  it("carries the payer (customer id, email, name) so ingest can link or add the CRM record", async () => {
    const [paid] = await stripeMock.webhooks![0]!.normalise(signedStripeRequest(TEST_BUSINESS_ID, evt("invoice.paid", ST_INVOICES[0]!)));
    expect(paid!.payload).toMatchObject({ customer: { externalId: "cus_MockAnnaLind01", email: "anna.lind@example.com", name: "Anna Lind" }, source: null });
    const checkout = { ...ST_CHECKOUT_PAID, customer: null, customer_details: { email: "buyer@example.com", name: "Bea Buyer" }, metadata: { utm_source: "newsletter", utm_medium: "email", promo_code: "AUTUMN" } };
    const [oneOff] = await stripeMock.webhooks![0]!.normalise(signedStripeRequest(TEST_BUSINESS_ID, evt("checkout.session.completed", checkout)));
    expect(oneOff!.payload).toMatchObject({ customer: { externalId: null, email: "buyer@example.com", name: "Bea Buyer" }, source: { utmSource: "newsletter", utmMedium: "email", code: "AUTUMN" } });
    const [trial] = await stripeMock.webhooks![0]!.normalise(signedStripeRequest(TEST_BUSINESS_ID, evt("customer.subscription.created", ST_TRIAL_SUBSCRIPTION)));
    expect((trial!.payload as { customer: { externalId: string } }).customer.externalId).toMatch(/^cus_/);
  });
  it("simulates another customer per seed or email, and a renewal when firstPayment is false", async () => {
    const [defaultPayer] = await stripeMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID });
    expect(defaultPayer!.payload).toMatchObject({ customer: { externalId: "cus_MockAnnaLind01", name: "Anna Lind" }, firstPayment: true });
    const [other] = await stripeMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "second" });
    const [byEmail] = await stripeMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "third", email: "chosen@example.com" });
    expect((other!.payload as { customer: { externalId: string } }).customer.externalId).not.toBe("cus_MockAnnaLind01");
    expect((other!.payload as { entityId: string }).entityId).not.toBe((defaultPayer!.payload as { entityId: string }).entityId);
    expect(byEmail!.payload).toMatchObject({ customer: { email: "chosen@example.com" } });
    const [renewal] = await stripeMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "renewal", email: "chosen@example.com", firstPayment: false });
    expect(renewal!.payload).toMatchObject({ firstPayment: false, recurring: true });
    expect((renewal!.payload as { entityId: string }).entityId).toBe((byEmail!.payload as { entityId: string }).entityId);
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
  it("connect: an account id alone is refused before Stripe is called; a key issued by the account binds that key's own account (audit VGPC-X1)", async () => {
    const VICTIM = "acct_1VictimAccount0001";
    const calls: string[] = [];
    const connector = createStripeConnector({
      secrets: { stripeSecretKey: "sk_test_platform", stripeConnectClientId: "ca_test_platform" },
      fetch: routedFetch({
        [`GET https://api.stripe.com/v1/accounts/${VICTIM}`]: (req) => (calls.push(req.url), jsonResponse({ object: "account", id: VICTIM, business_profile: { name: "Victim Ltd" } })),
        "GET https://api.stripe.com/v1/account": (req) => (calls.push(`${req.url} ${req.headers.get("authorization")}`), jsonResponse({ object: "account", id: "acct_1OwnKeyAccount004", country: "GB", default_currency: "gbp", charges_enabled: true, payouts_enabled: true })),
      }),
    });
    const err = await connector.connect(TEST_BUSINESS_ID, { accountId: VICTIM }).then(() => null, (e: unknown) => e as Error & { code?: string });
    expect(err?.code).toBe("connect_input_required");
    expect(err?.message).toMatch(/Sign in with Stripe/);
    expect(calls).toEqual([]);
    // A key issued by the account itself proves control: the key's own account is bound, whatever id was pasted next to it.
    const own = await connector.connect(TEST_BUSINESS_ID, { apiKey: "rk_test_business", accountId: VICTIM });
    expect(own).toMatchObject({ externalAccountId: "acct_1OwnKeyAccount004", config: { kind: "own" }, credentialToStore: { kind: "api_key", secret: "rk_test_business" } });
    expect(calls).toEqual(["https://api.stripe.com/v1/account Bearer rk_test_business"]);
  });

  describe("Sign in with Stripe (Connect OAuth)", () => {
    const START = { state: "eyJiIjoiYiJ9.c2ln", redirectUri: "https://foundmill.com/integrations/oauth/callback" };
    const signIn = (over: Record<string, unknown> = {}, seen: string[] = []) =>
      createStripeConnector({
        secrets: { stripeSecretKey: "sk_live_billing", stripeConnectSecretKey: "sk_test_connect", stripeConnectClientId: "ca_test_platform", ...over },
        fetch: routedFetch({
          "POST https://connect.stripe.com/oauth/token": async (req) => (seen.push(`token ${req.headers.get("authorization")} ${await req.text()}`), jsonResponse({ stripe_user_id: "acct_1Founder00000001", access_token: "sk_test_dropped", livemode: false, scope: "read_write" })),
          "GET https://api.stripe.com/v1/accounts/acct_1Founder00000001": (req) => (seen.push(`account ${req.headers.get("authorization")}`), jsonResponse({ object: "account", id: "acct_1Founder00000001", business_profile: { name: "Founder Ltd" }, country: "US", default_currency: "usd", charges_enabled: true, payouts_enabled: true })),
          "POST https://connect.stripe.com/oauth/deauthorize": async (req) => (seen.push(`deauthorize ${req.headers.get("authorization")} ${await req.text()}`), jsonResponse({ stripe_user_id: "acct_1Founder00000001" })),
        }),
      });

    it("the first step only answers Stripe's sign-in page for the signed state; nothing is stored", async () => {
      const seen: string[] = [];
      const first = await signIn({}, seen).connect(TEST_BUSINESS_ID, START);
      const url = new URL(String(first.config.authorizeUrl));
      expect(`${url.origin}${url.pathname}`).toBe("https://connect.stripe.com/oauth/authorize");
      expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "ca_test_platform", scope: "read_write", redirect_uri: START.redirectUri, state: START.state });
      expect(first).toMatchObject({ status: "disconnected", externalAccountId: null });
      expect(first.credentialToStore).toBeUndefined();
      expect(seen).toEqual([]);
      // Without the platform's client id nothing starts, and an unsigned start is refused.
      await expect(signIn({ stripeConnectClientId: undefined }).connect(TEST_BUSINESS_ID, START)).rejects.toMatchObject({ name: "ConfigError" });
      await expect(signIn().connect(TEST_BUSINESS_ID, {})).rejects.toThrow(/signed state/);
    });

    it("the code exchange names the account; Stripe's access token is dropped and calls use the Connect key with Stripe-Account", async () => {
      const seen: string[] = [];
      const connector = signIn({}, seen);
      const record = await connector.connect(TEST_BUSINESS_ID, { code: "ac_TestCode123", redirectUri: START.redirectUri });
      expect(record).toMatchObject({ status: "connected", externalAccountId: "acct_1Founder00000001", accountLabel: "Founder Ltd", config: { kind: "connect", defaultCurrency: "USD" } });
      expect(record.credentialToStore).toBeUndefined();
      expect(JSON.stringify(record)).not.toContain("sk_test_dropped");
      expect(seen[0]).toMatch(/^token Bearer sk_test_connect .*grant_type=authorization_code.*code=ac_TestCode123/);
      expect(seen[1]).toBe("account Bearer sk_test_connect");
      expect(seen.join(" ")).not.toContain("sk_live_billing");
    });

    it("disconnecting a sign-in withdraws Foundmill's access in Stripe; a pasted key is only forgotten", async () => {
      const seen: string[] = [];
      const connector = signIn({}, seen);
      const integration = { id: "int-1", businessId: TEST_BUSINESS_ID, connectorKey: "stripe", status: "connected" as const, scopes: [], accountLabel: null, externalAccountId: "acct_1Founder00000001", config: { kind: "connect" }, credentialRef: null, expiresAt: null, lastHealthAt: null, createdAt: MOCK_NOW.toISOString() };
      await connector.disconnect!(integration);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/^deauthorize Bearer sk_test_connect .*client_id=ca_test_platform.*stripe_user_id=acct_1Founder00000001/);
      await connector.disconnect!({ ...integration, config: { kind: "own" } });
      expect(seen).toHaveLength(1);
    });
  });

  it("checks health with the founder's own key or the Connect key for the signed-in account, never the platform key alone", async () => {
    const seen: string[] = [];
    const connector = createStripeConnector({
      secrets: { stripeSecretKey: "sk_live_platform" },
      fetch: routedFetch({
        "GET https://api.stripe.com/v1/account": (req) => (seen.push(`own ${req.headers.get("authorization")}`), jsonResponse({ object: "account", id: "acct_1OwnKeyAccount004", charges_enabled: true, payouts_enabled: true })),
        "GET https://api.stripe.com/v1/accounts/acct_1Founder00000001": (req) => (seen.push(`connect ${req.headers.get("authorization")}`), jsonResponse({ object: "account", id: "acct_1Founder00000001", charges_enabled: true, payouts_enabled: true })),
      }),
    });
    const base = { id: "int-1", businessId: TEST_BUSINESS_ID, connectorKey: "stripe", status: "connected" as const, scopes: [], accountLabel: null, credentialRef: null, expiresAt: null, lastHealthAt: null, createdAt: MOCK_NOW.toISOString() };
    const own = await connector.healthcheck({ ...base, externalAccountId: "acct_1OwnKeyAccount004", config: { kind: "own" } }, { kind: "api_key", secret: "rk_live_founder" } as never);
    expect(own.status).toBe("connected");
    const signedIn = await connector.healthcheck({ ...base, externalAccountId: "acct_1Founder00000001", config: { kind: "connect" } });
    expect(signedIn.status).toBe("connected");
    expect(seen).toEqual(["own Bearer rk_live_founder", "connect Bearer sk_live_platform"]);
    // A key-paste row without its key never falls back to the platform's own account.
    const orphan = await connector.healthcheck({ ...base, externalAccountId: "acct_1OwnKeyAccount004", config: { kind: "own" } });
    expect(orphan.status).toBe("disconnected");
    expect(seen).toHaveLength(2);
  });

  it("money never goes out: no Stripe tool that refunds, pays out, transfers or cancels has a handler, each stays a hard gate, and only money-in and read tools run (CLAUDE.md Never; founder, Nov 17, 2026)", async () => {
    const MONEY_OUT = /refund|payout|transfer|cancel|void|delete|reverse|credit_note|onboarding/i;
    const RUNS = ["create_billing_portal_session", "create_checkout_session", "create_customer", "create_invoice", "get_account", "get_balance", "get_customer", "get_invoice", "list_charges", "list_customers", "list_invoices", "list_payouts", "send_invoice"];
    const reached: string[] = [];
    const live = createStripeConnector({ secrets: { stripeSecretKey: "sk_test_platform" }, fetch: (async (input: RequestInfo | URL) => (reached.push(String(input instanceof Request ? input.url : input)), new Response("{}", { status: 500 }))) as typeof fetch });
    const names = live.tools.map((t) => t.name);
    const gated = names.filter((n) => live.policyHints[n]?.hardGate === true);
    expect(names.filter((n) => !gated.includes(n)).sort()).toEqual(RUNS);
    for (const name of names) {
      const description = live.tools.find((t) => t.name === name)?.description ?? "";
      if (name === "list_payouts" || name === "list_charges") continue; // read-only lists, annotated readOnlyHint
      if (MONEY_OUT.test(name) || /\b(refunds?|pays? out|transfers?|cancels?)\b/i.test(description)) expect(gated, name).toContain(name);
    }
    expect(gated.sort()).toEqual(["create_payout", "create_transfer", "refund_payment", "start_connect_onboarding"]);
    // A running tool cannot do it through an argument either (an update tool with `cancel_at`, a "refund" flag).
    // `cancelUrl` is only the page a customer returns to when they leave checkout.
    const ALLOWED = new Set(["cancelUrl"]);
    const fieldsOf = (schema: unknown): string[] => {
      if (!schema || typeof schema !== "object") return [];
      const o = schema as { properties?: Record<string, unknown>; items?: unknown };
      return [...Object.entries(o.properties ?? {}).flatMap(([k, v]) => [k, ...fieldsOf(v)]), ...fieldsOf(o.items)];
    };
    for (const name of RUNS) {
      const risky = fieldsOf(live.tools.find((t) => t.name === name)?.inputSchema).filter((f) => !ALLOWED.has(f) && /cancel|refund|payout|transfer|void|reverse|credit_?note|destination/i.test(f));
      expect(risky, name).toEqual([]);
    }
    // A hard-gated tool has no handler: the live call is answered with the founder's card and never reaches Stripe,
    // even with the founder's own key and a signed-in account present.
    const ARGS: Record<string, unknown> = { create_payout: { amountMinor: 1000, currency: "USD" }, create_transfer: { amountMinor: 1000, currency: "USD", destinationAccountId: "acct_1Other000" }, refund_payment: { paymentIntentId: "pi_Test000001" }, start_connect_onboarding: {} };
    const ctx = makeToolContext(live, { credential: { kind: "api_key", secret: "rk_test_founder" } as never });
    for (const name of gated) {
      const r = await live.callTool(name, ARGS[name], { ...ctx, integration: { ...ctx.integration, externalAccountId: "acct_1Founder00000001", config: { kind: "connect" } } });
      expect(r.ok, name).toBe(false);
      expect(r.error?.code, name).toBe("hard_gate");
    }
    expect(reached).toEqual([]);
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
  it("never uses the platform key outside a Connect account: the platform's own Stripe account is no business's", async () => {
    let called = false;
    const connector = createStripeConnector({ secrets: { stripeSecretKey: "sk_test_platform" }, fetch: async () => ((called = true), jsonResponse({ object: "balance", available: [], pending: [] })) });
    const ctx = makeToolContext(connector, { mode: "live" });
    ctx.integration = { ...ctx.integration, externalAccountId: "acct_business123", config: { kind: "own" } };
    await expect(connector.callTool("get_balance", {}, ctx)).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(called).toBe(false);
  });
  it("Foundmill's own billing may open a checkout on the platform account, and do nothing else there", async () => {
    const seen: string[] = [];
    const connector = createStripeConnector({
      secrets: { stripeSecretKey: "sk_test_platform" },
      fetch: async (url) => (seen.push(String(url)), jsonResponse(String(url).includes("checkout") ? { id: "cs_test_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_1", amount_total: 5000, currency: "usd", expires_at: null, status: "open", payment_status: "unpaid", mode: "payment", metadata: {} } : { object: "balance", available: [], pending: [] })),
    });
    const platform = { ...makeToolContext(connector, { mode: "live" }).integration, id: PLATFORM_BILLING_INTEGRATION_ID, credentialRef: null, externalAccountId: null, config: { kind: "platform" } };
    const ctx = { ...makeToolContext(connector, { mode: "live" }), integration: platform };
    const args = { mode: "payment", lines: [{ description: "Credits", amountMinor: 5000, quantity: 1, currency: "USD" }], successUrl: "https://foundmill.com/ok", cancelUrl: "https://foundmill.com/cancel" };
    expect(await connector.callTool("create_checkout_session", args, ctx)).toMatchObject({ ok: true });
    await expect(connector.callTool("get_balance", {}, ctx)).rejects.toMatchObject({ code: "connector_unconfigured" });
    // A stored row is never the platform's: any other id, or a credential reference, is refused.
    await expect(connector.callTool("create_checkout_session", args, { ...ctx, integration: { ...platform, id: crypto.randomUUID() } })).rejects.toMatchObject({ code: "connector_unconfigured" });
    // The billing portal opens for Foundmill's own subscribers only: a business's own record reaches no Stripe account.
    const portal = { customerId: "cus_MockAnnaLind01", returnUrl: "https://foundmill.com/billing" };
    expect(await connector.callTool("create_billing_portal_session", portal, makeToolContext(connector, { mode: "live" }))).toMatchObject({ ok: false });
    expect(seen).toHaveLength(1);
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
