/**
 * Stripe (Connect + webhooks, BUILD §13.2 phase 2). Read customers, invoices, balance and payouts; create
 * customers, draft/send invoices and checkout sessions (the customer pays — the business never spends).
 * Anything that moves money out (payouts, transfers, refunds) or accepts Stripe's terms (Connect
 * onboarding) is a hard gate (BUILD §2.2): the tool exists only as a human-action descriptor.
 */
import { z } from "zod";
import type { ConnectField } from "../../contract";
import { defineTool } from "../../define";

export const STRIPE_KEY = "stripe";

/**
 * What the founder enters in Settings › Integrations to connect their own Stripe account live (a Connect account comes
 * from the `start_connect_onboarding` hard gate instead).
 */
export const STRIPE_CONNECT_FIELDS: ConnectField[] = [
  { name: "apiKey", label: "Restricted key", secret: true, required: true, placeholder: "rk_live_…", hint: "A restricted key from your Stripe dashboard with read access plus write access to customers, invoices and Checkout. Stripe fees stay on your account." },
];
export const STRIPE_API_VERSION = "2025-09-30.clover";
export const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com";

const StripeId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,}$`), `Stripe ${prefix}_ id`);
const Currency = z.string().length(3).transform((c) => c.toUpperCase());

export const Customer = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  created: z.string(),
  currency: z.string().nullable(),
  balanceMinor: z.number().int(),
  delinquent: z.boolean(),
  metadata: z.record(z.string(), z.string()),
});
export type CustomerT = z.infer<typeof Customer>;

export const Invoice = z.object({
  id: z.string(),
  number: z.string().nullable(),
  customerId: z.string().nullable(),
  customerEmail: z.string().nullable(),
  status: z.enum(["draft", "open", "paid", "uncollectible", "void"]),
  currency: z.string(),
  amountDueMinor: z.number().int(),
  amountPaidMinor: z.number().int(),
  subscriptionId: z.string().nullable(),
  billingReason: z.string().nullable(),
  created: z.string(),
  dueDate: z.string().nullable(),
  paidAt: z.string().nullable(),
  hostedInvoiceUrl: z.string().nullable(),
  lines: z.array(z.object({ description: z.string().nullable(), amountMinor: z.number().int(), quantity: z.number().int().nullable() })),
});
export type InvoiceT = z.infer<typeof Invoice>;

export const CheckoutSession = z.object({ id: z.string(), url: z.string().nullable(), mode: z.enum(["payment", "subscription", "setup"]), status: z.string().nullable(), paymentStatus: z.string(), amountTotalMinor: z.number().int().nullable(), currency: z.string().nullable(), customerEmail: z.string().nullable(), expiresAt: z.string().nullable() });

export const Payout = z.object({ id: z.string(), amountMinor: z.number().int(), currency: z.string(), status: z.string(), arrivalDate: z.string(), automatic: z.boolean(), description: z.string().nullable() });
export const Charge = z.object({ id: z.string(), customerId: z.string().nullable(), amountMinor: z.number().int(), refundedMinor: z.number().int(), currency: z.string(), status: z.string(), paid: z.boolean(), refunded: z.boolean(), invoiceId: z.string().nullable(), created: z.string(), description: z.string().nullable() });

const LineItem = z.object({ description: z.string().min(1).max(500), amountMinor: z.number().int().positive(), quantity: z.number().int().positive().default(1) });

export const stripeTools = [
  defineTool({ name: "get_account", description: "The connected Stripe account: capabilities, payout schedule, default currency.", input: z.object({}), output: z.object({ id: z.string(), businessName: z.string().nullable(), country: z.string(), defaultCurrency: z.string(), chargesEnabled: z.boolean(), payoutsEnabled: z.boolean(), type: z.string().nullable() }), hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({ name: "get_balance", description: "Available and pending balance per currency.", input: z.object({}), output: z.object({ available: z.array(z.object({ amountMinor: z.number().int(), currency: z.string() })), pending: z.array(z.object({ amountMinor: z.number().int(), currency: z.string() })) }), hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({ name: "list_customers", description: "Customers, newest first; filter by exact email.", input: z.object({ email: z.email().optional(), limit: z.number().int().min(1).max(100).default(20), startingAfter: z.string().optional() }), output: z.object({ items: z.array(Customer), hasMore: z.boolean() }), hints: {}, untrusted: "api", untrustedRef: (a) => `customers:${a.email ?? "all"}`, annotations: { readOnlyHint: true } }),
  defineTool({ name: "get_customer", description: "One customer by id.", input: z.object({ customerId: StripeId("cus") }), output: Customer, hints: {}, untrusted: "api", untrustedRef: (a) => a.customerId, annotations: { readOnlyHint: true } }),
  defineTool({ name: "create_customer", description: "Create a customer record (no email is sent).", input: z.object({ email: z.email(), name: z.string().min(1).max(200).optional(), metadata: z.record(z.string().max(40), z.string().max(500)).default({}) }), output: Customer, hints: {}, annotations: { idempotentHint: true } }),
  defineTool({ name: "list_invoices", description: "Invoices, newest first; filter by customer and status.", input: z.object({ customerId: StripeId("cus").optional(), status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).optional(), limit: z.number().int().min(1).max(100).default(20) }), output: z.object({ items: z.array(Invoice), hasMore: z.boolean() }), hints: {}, untrusted: "api", untrustedRef: (a) => `invoices:${a.customerId ?? "all"}:${a.status ?? "any"}`, annotations: { readOnlyHint: true } }),
  defineTool({ name: "get_invoice", description: "One invoice with its lines.", input: z.object({ invoiceId: StripeId("in") }), output: Invoice, hints: {}, untrusted: "api", untrustedRef: (a) => a.invoiceId, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "create_invoice",
    description: "Create and finalize an invoice for a customer (collection by email, due in N days). Nothing is sent until send_invoice.",
    input: z.object({ customerId: StripeId("cus"), currency: Currency, lines: z.array(LineItem).min(1).max(50), daysUntilDue: z.number().int().min(1).max(90).default(14), memo: z.string().max(2000).optional() }),
    output: Invoice,
    hints: {},
  }),
  defineTool({ name: "send_invoice", description: "Email a finalized invoice to the customer (external message on behalf of the business; BUILD §2.3).", input: z.object({ invoiceId: StripeId("in") }), output: Invoice, hints: { contactsThirdParty: true, irreversible: true } }),
  defineTool({
    name: "create_checkout_session",
    description: "Hosted checkout link for a one-off payment or a subscription. The customer pays; the business spends nothing.",
    input: z.object({ mode: z.enum(["payment", "subscription"]), priceId: StripeId("price").optional(), lines: z.array(LineItem.extend({ currency: Currency })).max(20).default([]), successUrl: z.url(), cancelUrl: z.url(), customerEmail: z.email().optional(), customerId: StripeId("cus").optional(), metadata: z.record(z.string().max(40), z.string().max(500)).default({}) }).refine((a) => a.priceId || a.lines.length > 0, { message: "priceId or lines required" }),
    output: CheckoutSession,
    hints: {},
  }),
  defineTool({ name: "list_charges", description: "Payments taken, newest first, with how much of each was refunded; filter by customer.", input: z.object({ customerId: StripeId("cus").optional(), limit: z.number().int().min(1).max(100).default(25) }), output: z.object({ items: z.array(Charge), hasMore: z.boolean() }), hints: {}, untrusted: "api", untrustedRef: (a) => `charges:${a.customerId ?? "all"}`, annotations: { readOnlyHint: true } }),
  defineTool({ name: "list_payouts", description: "Recent payouts to the bank account.", input: z.object({ limit: z.number().int().min(1).max(100).default(10) }), output: z.object({ items: z.array(Payout) }), hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "create_payout",
    description: "HARD GATE (BUILD §2.2): moving money to a bank account is never automated. Returns the dashboard location for the founder.",
    input: z.object({ amountMinor: z.number().int().positive(), currency: Currency, reason: z.string().max(1000).optional() }),
    hints: { hardGate: true, spendsMoney: true, irreversible: true },
    humanAction: (a) => ({ title: `Pay out ${(a.amountMinor / 100).toFixed(2)} ${a.currency} yourself`, instructions: `Open Stripe → Balance → Pay out funds and create the payout of ${(a.amountMinor / 100).toFixed(2)} ${a.currency} if you agree.${a.reason ? ` Why: ${a.reason}` : ""} Agents cannot move money.`, url: `${STRIPE_DASHBOARD_URL}/balance/overview` }),
  }),
  defineTool({
    name: "create_transfer",
    description: "HARD GATE (BUILD §2.2): transfers between Stripe accounts move money and are never automated.",
    input: z.object({ amountMinor: z.number().int().positive(), currency: Currency, destinationAccountId: StripeId("acct"), reason: z.string().max(1000).optional() }),
    hints: { hardGate: true, spendsMoney: true, irreversible: true },
    humanAction: (a) => ({ title: `Transfer ${(a.amountMinor / 100).toFixed(2)} ${a.currency} to ${a.destinationAccountId}`, instructions: `Create the transfer in the Stripe dashboard (Connect → Transfers) if you agree.${a.reason ? ` Why: ${a.reason}` : ""} Agents cannot move money.`, url: `${STRIPE_DASHBOARD_URL}/connect/transfers` }),
  }),
  defineTool({
    name: "refund_payment",
    description: "HARD GATE (BUILD §2.2): refunds move money back to a customer; the founder issues them.",
    input: z.object({ paymentIntentId: StripeId("pi"), amountMinor: z.number().int().positive().optional(), reason: z.string().max(1000).optional() }),
    hints: { hardGate: true, spendsMoney: true, irreversible: true },
    humanAction: (a) => ({ title: `Refund ${a.paymentIntentId}`, instructions: `Open the payment in Stripe and refund ${a.amountMinor ? `${(a.amountMinor / 100).toFixed(2)}` : "the full amount"} if you agree.${a.reason ? ` Why: ${a.reason}` : ""}`, url: `${STRIPE_DASHBOARD_URL}/payments/${a.paymentIntentId}` }),
  }),
  defineTool({
    name: "start_connect_onboarding",
    description: "HARD GATE (BUILD §2.2): Stripe Connect onboarding accepts Stripe's terms and verifies the founder's identity; only the founder can complete it.",
    input: z.object({ country: z.string().length(2).default("SE"), reason: z.string().max(1000).optional() }),
    hints: { hardGate: true, irreversible: true },
    humanAction: (a) => ({ title: "Complete Stripe onboarding yourself", instructions: `Create or connect the Stripe account for ${a.country} in the Stripe dashboard, accept the Connected Account Agreement and complete identity verification. Then paste the account id (acct_…) into Settings → Integrations → Stripe.`, url: `${STRIPE_DASHBOARD_URL}/register` }),
  }),
] as const;

export const STRIPE_RATE_LIMITS = { perMinute: 60, perDay: 20_000 };

/* ---- Vendor shapes (subset of the 2025-09-30 API) ---- */
export interface StCustomer { id: string; object?: "customer"; deleted?: boolean; email?: string | null; name?: string | null; created: number; currency?: string | null; balance?: number; delinquent?: boolean | null; metadata?: Record<string, string> }
export interface StInvoiceLine { description?: string | null; amount: number; quantity?: number | null; price?: { nickname?: string | null; product?: string | { name?: string } | null } | null; pricing?: { price_details?: { price?: string; product?: string } } }
export interface StInvoice {
  id: string; number?: string | null; customer?: string | { id: string } | null; customer_email?: string | null; status?: string | null; currency: string; amount_due: number; amount_paid: number;
  subscription?: string | { id: string } | null; parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null; billing_reason?: string | null; created: number; due_date?: number | null;
  status_transitions?: { paid_at?: number | null } | null; hosted_invoice_url?: string | null; lines?: { data: StInvoiceLine[] }; metadata?: Record<string, string>;
}
export interface StCheckoutSession { id: string; url?: string | null; mode: "payment" | "subscription" | "setup"; status?: string | null; payment_status: string; amount_total?: number | null; currency?: string | null; customer?: string | { id: string } | null; customer_email?: string | null; customer_details?: { email?: string | null; name?: string | null } | null; expires_at?: number | null; subscription?: string | null; payment_intent?: string | null; metadata?: Record<string, string> | null }
export interface StSubscription { id: string; customer: string | { id: string }; status: string; created: number; trial_end?: number | null; currency?: string; items?: { data: { price?: { id?: string; nickname?: string | null; product?: string | { name?: string } | null } }[] }; metadata?: Record<string, string> }
export interface StPayout { id: string; amount: number; currency: string; status: string; arrival_date: number; automatic: boolean; description?: string | null }
export interface StCharge { id: string; customer: string | null; amount: number; amount_refunded: number; currency: string; status: string; paid: boolean; refunded: boolean; invoice?: string | null; created: number; description?: string | null }
export interface StAccount { id: string; business_profile?: { name?: string | null } | null; country?: string; default_currency?: string; charges_enabled?: boolean; payouts_enabled?: boolean; type?: string | null; settings?: { dashboard?: { display_name?: string | null } } }
export interface StBalance { available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] }
export interface StEvent<T = unknown> { id: string; type: string; created: number; livemode?: boolean; account?: string; data: { object: T } }

export const refId = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : (v?.id ?? null));
const iso = (s: number | null | undefined): string | null => (typeof s === "number" ? new Date(s * 1000).toISOString() : null);

export const mapCustomer = (c: StCustomer): CustomerT => ({ id: c.id, email: c.email ?? null, name: c.name ?? null, created: iso(c.created)!, currency: c.currency?.toUpperCase() ?? null, balanceMinor: c.balance ?? 0, delinquent: c.delinquent ?? false, metadata: c.metadata ?? {} });

export const invoiceSubscriptionId = (i: StInvoice): string | null => refId(i.subscription) ?? refId(i.parent?.subscription_details?.subscription);

export const mapInvoice = (i: StInvoice): InvoiceT => ({
  id: i.id, number: i.number ?? null, customerId: refId(i.customer), customerEmail: i.customer_email ?? null,
  status: (["draft", "open", "paid", "uncollectible", "void"] as const).find((s) => s === i.status) ?? "draft",
  currency: i.currency.toUpperCase(), amountDueMinor: i.amount_due, amountPaidMinor: i.amount_paid, subscriptionId: invoiceSubscriptionId(i), billingReason: i.billing_reason ?? null,
  created: iso(i.created)!, dueDate: iso(i.due_date), paidAt: iso(i.status_transitions?.paid_at), hostedInvoiceUrl: i.hosted_invoice_url ?? null,
  lines: (i.lines?.data ?? []).map((l) => ({ description: l.description ?? l.price?.nickname ?? null, amountMinor: l.amount, quantity: l.quantity ?? null })),
});

export const mapCheckoutSession = (s: StCheckoutSession): z.infer<typeof CheckoutSession> => ({ id: s.id, url: s.url ?? null, mode: s.mode, status: s.status ?? null, paymentStatus: s.payment_status, amountTotalMinor: s.amount_total ?? null, currency: s.currency?.toUpperCase() ?? null, customerEmail: s.customer_email ?? s.customer_details?.email ?? null, expiresAt: iso(s.expires_at) });

export const mapCharge = (c: StCharge): z.infer<typeof Charge> => ({ id: c.id, customerId: c.customer ?? null, amountMinor: c.amount, refundedMinor: c.amount_refunded, currency: c.currency.toUpperCase(), status: c.status, paid: c.paid, refunded: c.refunded, invoiceId: c.invoice ?? null, created: iso(c.created)!, description: c.description ?? null });
export const mapPayout = (p: StPayout): z.infer<typeof Payout> => ({ id: p.id, amountMinor: p.amount, currency: p.currency.toUpperCase(), status: p.status, arrivalDate: iso(p.arrival_date)!, automatic: p.automatic, description: p.description ?? null });

export const mapAccount = (a: StAccount) => ({ id: a.id, businessName: a.business_profile?.name ?? a.settings?.dashboard?.display_name ?? null, country: a.country ?? "", defaultCurrency: (a.default_currency ?? "").toUpperCase(), chargesEnabled: a.charges_enabled ?? false, payoutsEnabled: a.payouts_enabled ?? false, type: a.type ?? null });

export const mapBalance = (b: StBalance) => ({ available: b.available.map((x) => ({ amountMinor: x.amount, currency: x.currency.toUpperCase() })), pending: b.pending.map((x) => ({ amountMinor: x.amount, currency: x.currency.toUpperCase() })) });

/** Product label for `payment.received.productRef`. */
export function invoiceProductRef(i: StInvoice): string | null {
  const line = i.lines?.data[0];
  if (!line) return null;
  const product = line.price?.product;
  return line.description ?? line.price?.nickname ?? (typeof product === "object" && product?.name ? product.name : null);
}
