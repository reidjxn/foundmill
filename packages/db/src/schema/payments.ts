/**
 * 0033 — paying for credits: one row per Stripe Checkout session on the platform account (a credit top-up), written by
 * the api (open) and settled by the platform Stripe webhook in apps/ingest or a simulated payment in mock mode (paid).
 */
import { sql } from "drizzle-orm";
import { char, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, minor, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { creditBalances } from "./finance";

export const BILLING_CHECKOUT_KINDS = ["credits"] as const;
export const BILLING_CHECKOUT_STATUSES = ["open", "paid", "expired", "failed"] as const;
export const BILLING_CHECKOUT_MODES = ["mock", "live"] as const;
export type BillingCheckoutStatus = (typeof BILLING_CHECKOUT_STATUSES)[number];
export type BillingCheckoutMode = (typeof BILLING_CHECKOUT_MODES)[number];

export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: BILLING_CHECKOUT_KINDS }).notNull().default("credits"),
    status: text("status", { enum: BILLING_CHECKOUT_STATUSES }).notNull().default("open"),
    mode: text("mode", { enum: BILLING_CHECKOUT_MODES }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    /** Credits are USD (contract 5); the column holds nothing else. */
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    createdBy: uuid("created_by"),
    /** The Stripe Checkout session (`cs_…`); null until the gateway answered. */
    externalId: text("external_id"),
    checkoutUrl: text("checkout_url"),
    expiresAt: tstz("expires_at"),
    paidAt: tstz("paid_at"),
    /** The Stripe event that settled it, or `mock:<checkout id>`. */
    paidEventId: text("paid_event_id"),
    grantedPeriod: text("granted_period"),
    creditBalanceId: uuid("credit_balance_id").references(() => creditBalances.id, { onDelete: "set null" }),
    failure: text("failure"),
    ...timestamps(),
  },
  (t) => [
    index("billing_checkouts_business_id_idx").on(t.businessId, t.createdAt.desc()),
    uniqueIndex("billing_checkouts_external_id_key").on(t.externalId).where(sql`external_id is not null`),
    index("billing_checkouts_credit_balance_id_idx").on(t.creditBalanceId),
  ],
);
export type BillingCheckout = typeof billingCheckouts.$inferSelect;
export type NewBillingCheckout = typeof billingCheckouts.$inferInsert;
