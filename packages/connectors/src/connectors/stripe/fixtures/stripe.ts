/** Deterministic Stripe fixtures for Northwind Skincare's subscription business (test mode). */
import { MOCK_NOW } from "../../../mock-utils";
import type { StAccount, StCheckoutSession, StCustomer, StInvoice, StPayout, StSubscription } from "../tools";

export const MOCK_STRIPE_WEBHOOK_SECRET = "whsec_mock_founder_manager";
export const MOCK_STRIPE_ACCOUNT_ID = "acct_1MockNorthwind";

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
export const MOCK_NOW_UNIX = Math.floor(MOCK_NOW.getTime() / 1000);

export const ST_ACCOUNT: StAccount = { id: MOCK_STRIPE_ACCOUNT_ID, business_profile: { name: "Northwind Skincare AB" }, country: "SE", default_currency: "eur", charges_enabled: true, payouts_enabled: true, type: "standard" };

export const ST_CUSTOMERS: StCustomer[] = [
  { id: "cus_MockAnnaLind01", email: "anna.lind@example.com", name: "Anna Lind", created: unix("2026-07-14T09:12:00Z"), currency: "eur", balance: 0, delinquent: false, metadata: { plan: "pro" } },
  { id: "cus_MockOmarHaddad2", email: "omar.haddad@example.com", name: "Omar Haddad", created: unix("2026-08-02T15:40:00Z"), currency: "eur", balance: 0, delinquent: false, metadata: { plan: "starter" } },
  { id: "cus_MockMajaBerg003", email: "maja@sensitiveskinclub.se", name: "Maja Berg", created: unix("2026-09-28T11:03:00Z"), currency: "eur", balance: 0, delinquent: false, metadata: {} },
];

const line = (description: string, amount: number): StInvoice["lines"] => ({ data: [{ description, amount, quantity: 1, price: { nickname: description, product: { name: description } } }] });

export const ST_INVOICES: StInvoice[] = [
  { id: "in_MockAnna0001Paid", number: "NW-0001", customer: "cus_MockAnnaLind01", customer_email: "anna.lind@example.com", status: "paid", currency: "eur", amount_due: 4900, amount_paid: 4900, subscription: "sub_MockAnnaPro01", billing_reason: "subscription_create", created: unix("2026-07-14T09:13:00Z"), due_date: null, status_transitions: { paid_at: unix("2026-07-14T09:13:20Z") }, hosted_invoice_url: "https://invoice.stripe.com/i/mock/in_MockAnna0001Paid", lines: line("Pro monthly", 4900) },
  { id: "in_MockAnna0002Paid", number: "NW-0002", customer: "cus_MockAnnaLind01", customer_email: "anna.lind@example.com", status: "paid", currency: "eur", amount_due: 4900, amount_paid: 4900, subscription: "sub_MockAnnaPro01", billing_reason: "subscription_cycle", created: unix("2026-08-14T09:13:00Z"), due_date: null, status_transitions: { paid_at: unix("2026-08-14T09:14:02Z") }, hosted_invoice_url: "https://invoice.stripe.com/i/mock/in_MockAnna0002Paid", lines: line("Pro monthly", 4900) },
  { id: "in_MockOmar0001Paid", number: "NW-0003", customer: "cus_MockOmarHaddad2", customer_email: "omar.haddad@example.com", status: "paid", currency: "eur", amount_due: 2900, amount_paid: 2900, subscription: "sub_MockOmarStart1", billing_reason: "subscription_create", created: unix("2026-08-02T15:41:00Z"), due_date: null, status_transitions: { paid_at: unix("2026-08-02T15:41:30Z") }, hosted_invoice_url: "https://invoice.stripe.com/i/mock/in_MockOmar0001Paid", lines: line("Starter monthly", 2900) },
  { id: "in_MockMaja0001Open", number: "NW-0004", customer: "cus_MockMajaBerg003", customer_email: "maja@sensitiveskinclub.se", status: "open", currency: "eur", amount_due: 12_000, amount_paid: 0, subscription: null, billing_reason: "manual", created: unix("2026-10-01T08:00:00Z"), due_date: unix("2026-10-15T08:00:00Z"), status_transitions: { paid_at: null }, hosted_invoice_url: "https://invoice.stripe.com/i/mock/in_MockMaja0001Open", lines: line("Wholesale sample kit", 12_000) },
];

export const ST_PAYOUTS: StPayout[] = [
  { id: "po_MockPayout0003", amount: 182_400, currency: "eur", status: "paid", arrival_date: unix("2026-10-03T00:00:00Z"), automatic: true, description: "STRIPE PAYOUT" },
  { id: "po_MockPayout0002", amount: 176_900, currency: "eur", status: "paid", arrival_date: unix("2026-09-26T00:00:00Z"), automatic: true, description: "STRIPE PAYOUT" },
  { id: "po_MockPayout0001", amount: 171_300, currency: "eur", status: "paid", arrival_date: unix("2026-09-19T00:00:00Z"), automatic: true, description: "STRIPE PAYOUT" },
];

export const ST_TRIAL_SUBSCRIPTION: StSubscription = { id: "sub_MockMajaTrial01", customer: "cus_MockMajaBerg003", status: "trialing", created: unix("2026-09-28T11:04:00Z"), trial_end: unix("2026-10-12T11:04:00Z"), currency: "eur", items: { data: [{ price: { id: "price_MockPro01", nickname: "Pro monthly" } }] }, metadata: { utm_source: "instagram", utm_medium: "social" } };

export const ST_CHECKOUT_PAID: StCheckoutSession = { id: "cs_test_MockKit0001", url: null, mode: "payment", status: "complete", payment_status: "paid", amount_total: 12_000, currency: "eur", customer: null, customer_email: null, customer_details: { email: "lotta@brightdental.se", name: "Lotta Ek" }, expires_at: null, payment_intent: "pi_MockKit0001", metadata: { productRef: "Wholesale sample kit" } };
