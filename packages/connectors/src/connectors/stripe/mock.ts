import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, stableHash } from "../../mock-utils";
import { makeWebhookRequest, ReplayGuard } from "../../webhooks";
import { MOCK_NOW_UNIX, MOCK_STRIPE_ACCOUNT_ID, MOCK_STRIPE_WEBHOOK_SECRET, ST_ACCOUNT, ST_CHECKOUT_PAID, ST_CUSTOMERS, ST_INVOICES, ST_PAYOUTS, ST_TRIAL_SUBSCRIPTION } from "./fixtures/stripe";
import { mapAccount, mapBalance, mapCheckoutSession, mapCustomer, mapInvoice, mapPayout, STRIPE_KEY, STRIPE_RATE_LIMITS, stripeTools, type StCheckoutSession, type StCustomer, type StEvent, type StInvoice } from "./tools";
import { createStripeWebhook, normaliseStripeEvent, STRIPE_SIGNATURE_HEADER, stripeSignatureHeader } from "./webhooks";

const notFound = (what: string) => Object.assign(new Error(`No such ${what}`), { status: 404 });

/** A correctly signed Stripe event delivery (tests and simulations). */
export function signedStripeRequest(businessId: string, event: Omit<StEvent, "created"> & { created?: number }, opts: { secret?: string; timestamp?: number } = {}): Request {
  const body = JSON.stringify({ created: opts.timestamp ?? MOCK_NOW_UNIX, livemode: false, ...event });
  const timestamp = opts.timestamp ?? MOCK_NOW_UNIX;
  return makeWebhookRequest(`https://ingest.example/webhooks/${STRIPE_KEY}/${businessId}`, body, { "content-type": "application/json", [STRIPE_SIGNATURE_HEADER]: stripeSignatureHeader(opts.secret ?? MOCK_STRIPE_WEBHOOK_SECRET, body, timestamp) });
}

export const stripeEvent = <T>(type: string, object: T, id = `evt_${stableHash([type, object], 24)}`): StEvent<T> => ({ id, type, created: MOCK_NOW_UNIX, livemode: false, account: MOCK_STRIPE_ACCOUNT_ID, data: { object } });

/** One Stripe account per business (the fixtures are copied for each): customers, invoices and checkout sessions one business creates, no other business sees. */
export function createStripeMock() {
  const world = perBusiness(() => ({
    customers: new Map<string, StCustomer>(ST_CUSTOMERS.map((c) => [c.id, structuredClone(c)])),
    invoices: new Map<string, StInvoice>(ST_INVOICES.map((i) => [i.id, structuredClone(i)])),
    sessions: new Map<string, StCheckoutSession>(),
    sent: [] as string[],
  }));
  const webhook = createStripeWebhook({ secretFor: async () => MOCK_STRIPE_WEBHOOK_SECRET, replay: new ReplayGuard({ now: () => MOCK_NOW.getTime() }), now: () => MOCK_NOW });

  const connector = buildMockConnector({
    key: STRIPE_KEY,
    displayName: "Stripe",
    phase: 2,
    auth: { kind: "oauth", scopes: ["read_write"] },
    tools: stripeTools,
    rateLimits: STRIPE_RATE_LIMITS,
    now: () => MOCK_NOW,
    webhooks: [webhook],
    handlers: {
      get_account: async () => mapAccount(ST_ACCOUNT),
      get_balance: async () => mapBalance({ available: [{ amount: 236_540, currency: "eur" }], pending: [{ amount: 48_120, currency: "eur" }] }),
      list_customers: async ({ email, limit }, ctx) => {
        const all = [...world(ctx.businessId).customers.values()].filter((c) => !email || c.email?.toLowerCase() === email.toLowerCase()).sort((a, b) => b.created - a.created);
        return { items: all.slice(0, limit).map(mapCustomer), hasMore: all.length > limit };
      },
      get_customer: async ({ customerId }, ctx) => {
        const c = world(ctx.businessId).customers.get(customerId);
        if (!c) throw notFound(`customer: ${customerId}`);
        return mapCustomer(c);
      },
      create_customer: async ({ email, name, metadata }, ctx) => {
        const { customers } = world(ctx.businessId);
        const existing = [...customers.values()].find((c) => c.email?.toLowerCase() === email.toLowerCase());
        if (existing) return mapCustomer(existing);
        const c: StCustomer = { id: `cus_${stableHash(["cus", email], 14)}`, email, name: name ?? null, created: MOCK_NOW_UNIX, currency: null, balance: 0, delinquent: false, metadata };
        customers.set(c.id, c);
        return mapCustomer(c);
      },
      list_invoices: async ({ customerId, status, limit }, ctx) => {
        const all = [...world(ctx.businessId).invoices.values()].filter((i) => (!customerId || i.customer === customerId) && (!status || i.status === status)).sort((a, b) => b.created - a.created);
        return { items: all.slice(0, limit).map(mapInvoice), hasMore: all.length > limit };
      },
      get_invoice: async ({ invoiceId }, ctx) => {
        const i = world(ctx.businessId).invoices.get(invoiceId);
        if (!i) throw notFound(`invoice: ${invoiceId}`);
        return mapInvoice(i);
      },
      create_invoice: async ({ customerId, currency, lines, daysUntilDue, memo }, ctx) => {
        const { customers, invoices } = world(ctx.businessId);
        const c = customers.get(customerId);
        if (!c) throw notFound(`customer: ${customerId}`);
        const id = `in_${stableHash(["in", customerId, lines, currency], 14)}`;
        const existing = invoices.get(id);
        if (existing) return mapInvoice(existing);
        const total = lines.reduce((a, l) => a + l.amountMinor * l.quantity, 0);
        const inv: StInvoice = { id, number: `NW-${String(1000 + invoices.size).padStart(4, "0")}`, customer: customerId, customer_email: c.email ?? null, status: "open", currency: currency.toLowerCase(), amount_due: total, amount_paid: 0, subscription: null, billing_reason: "manual", created: MOCK_NOW_UNIX, due_date: MOCK_NOW_UNIX + daysUntilDue * 86_400, status_transitions: { paid_at: null }, hosted_invoice_url: `https://invoice.stripe.com/i/mock/${id}`, lines: { data: lines.map((l) => ({ description: l.description, amount: l.amountMinor * l.quantity, quantity: l.quantity })) }, metadata: memo ? { memo } : {} };
        invoices.set(id, inv);
        return mapInvoice(inv);
      },
      send_invoice: async ({ invoiceId }, ctx) => {
        const { invoices, sent } = world(ctx.businessId);
        const i = invoices.get(invoiceId);
        if (!i) throw notFound(`invoice: ${invoiceId}`);
        if (i.status !== "open") throw Object.assign(new Error(`invoice ${invoiceId} is ${i.status}; only open invoices can be sent`), { status: 400 });
        sent.push(invoiceId);
        return mapInvoice(i);
      },
      create_checkout_session: async ({ mode, priceId, lines, successUrl, customerEmail, customerId, metadata }, ctx) => {
        const { sessions } = world(ctx.businessId);
        const id = `cs_test_${stableHash(["cs", mode, priceId, lines, successUrl, customerEmail, customerId], 20)}`;
        const existing = sessions.get(id);
        if (existing) return mapCheckoutSession(existing);
        const total = lines.reduce((a, l) => a + l.amountMinor * l.quantity, 0) || (mode === "subscription" ? 4900 : 0);
        const currency = lines[0]?.currency ?? "EUR";
        const s: StCheckoutSession = { id, url: `https://checkout.stripe.com/c/pay/${id}`, mode, status: "open", payment_status: "unpaid", amount_total: total, currency: currency.toLowerCase(), customer: customerId ?? null, customer_email: customerEmail ?? null, expires_at: MOCK_NOW_UNIX + 24 * 3600, metadata };
        sessions.set(id, s);
        return mapCheckoutSession(s);
      },
      list_payouts: async ({ limit }) => ({ items: ST_PAYOUTS.slice(0, limit).map(mapPayout) }),
    },
    connect: async (businessId) => mockIntegrationRecord(STRIPE_KEY, businessId, { accountLabel: "Northwind Skincare AB (Stripe test mode, mock)", externalAccountId: MOCK_STRIPE_ACCOUNT_ID, scopes: ["read_write"], config: { kind: "connect", livemode: false } }),
    healthcheck: async (integration) => mockHealth(STRIPE_KEY, { customers: world(integration.businessId).customers.size, invoices: world(integration.businessId).invoices.size }),
    simulations: {
      // Simulations normalise the payload a signed delivery would carry; the replay guard is a webhook concern.
      "payment.received": (params) => {
        const inv = ST_INVOICES[0]!;
        const amount = typeof params.amountMinor === "number" ? params.amountMinor : inv.amount_paid;
        const paidAt = Math.floor((params.occurredAt ?? MOCK_NOW).getTime() / 1000);
        const id = `in_sim${stableHash([params.businessId, params.seed ?? "default"], 14)}`;
        return normaliseStripeEvent(stripeEvent("invoice.paid", { ...inv, id, amount_paid: amount, amount_due: amount, created: paidAt, status_transitions: { paid_at: paidAt } }), params.businessId);
      },
      "checkout.completed": (params) => normaliseStripeEvent(stripeEvent("checkout.session.completed", { ...ST_CHECKOUT_PAID, id: `cs_test_sim${stableHash([params.businessId, params.seed ?? "default"], 16)}` }, `evt_${stableHash(["cs", params.seed ?? "default"], 24)}`), params.businessId),
      "signup.created": (params) => normaliseStripeEvent(stripeEvent("customer.subscription.created", { ...ST_TRIAL_SUBSCRIPTION, id: `sub_sim${stableHash([params.businessId, params.seed ?? "default"], 14)}`, created: Math.floor((params.occurredAt ?? MOCK_NOW).getTime() / 1000) }), params.businessId),
    },
  });
  /** `sentInvoicesFor(businessId)`: the invoices that business's agents sent (tests). */
  return Object.assign(connector, { sentInvoicesFor: (businessId: string) => world(businessId).sent });
}

export const stripeMock = createStripeMock();
