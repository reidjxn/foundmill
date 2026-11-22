/** 0009 — finance: bank accounts, transactions, ledger, forecasts, cap table, usage, credits. */
import { MODEL_BILLING, MODEL_KEYS, SECURITY_KINDS, USAGE_KINDS } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { date, index, jsonb, numeric, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { businessCurrency, emptyList, emptyObject, id, minor, timestamps, timestampsWithArchive, tstz, usdCurrency } from "./_common";
import { businessId } from "./_refs";
import { agentSessions, agents } from "./agents";
import { entities } from "./crm";
import { integrations } from "./governance";

export const LEDGER_BASES = ["accrual", "cash"] as const;
export const FORECAST_SCENARIOS = ["base", "upside", "downside"] as const;
export const CATEGORY_SOURCES = ["rule", "model", "ledger", "user"] as const;

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    businessId: businessId(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    currency: businessCurrency(),
    balanceMinor: minor("balance_minor").notNull().default(0),
    balanceAt: tstz("balance_at"),
    consentExpiresAt: tstz("consent_expires_at"),
    integrationId: uuid("integration_id").references((): AnyPgColumn => integrations.id, { onDelete: "set null" }),
    ...timestampsWithArchive(),
  },
  (t) => [
    uniqueIndex("accounts_business_id_provider_external_id_key").on(t.businessId, t.provider, t.externalId),
    index("accounts_business_id_idx").on(t.businessId),
    index("accounts_integration_id_idx").on(t.integrationId),
  ],
);
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    businessId: businessId(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    bookedAt: tstz("booked_at").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: businessCurrency(),
    counterparty: text("counterparty"),
    counterpartyEntityId: uuid("counterparty_entity_id").references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
    description: text("description").notNull().default(""),
    category: text("category"),
    categorySource: text("category_source", { enum: CATEGORY_SOURCES }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("transactions_account_id_external_id_key").on(t.accountId, t.externalId),
    index("transactions_business_id_idx").on(t.businessId, t.bookedAt),
    index("transactions_account_id_idx").on(t.accountId, t.bookedAt),
    index("transactions_category_idx").on(t.businessId, t.category),
    index("transactions_counterparty_entity_id_idx").on(t.counterpartyEntityId),
  ],
);
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export const ledgerSnapshots = pgTable(
  "ledger_snapshots",
  {
    id: id(),
    businessId: businessId(),
    period: text("period").notNull(),
    basis: text("basis", { enum: LEDGER_BASES }).notNull().default("cash"),
    currency: businessCurrency(),
    pnl: jsonb("pnl").$type<Record<string, unknown>>().notNull().default(emptyObject),
    source: text("source"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ledger_snapshots_business_id_period_basis_key").on(t.businessId, t.period, t.basis), index("ledger_snapshots_business_id_idx").on(t.businessId, t.period)],
);
export type LedgerSnapshot = typeof ledgerSnapshots.$inferSelect;
export type NewLedgerSnapshot = typeof ledgerSnapshots.$inferInsert;

export const forecasts = pgTable(
  "forecasts",
  {
    id: id(),
    businessId: businessId(),
    scenario: text("scenario", { enum: FORECAST_SCENARIOS }).notNull(),
    currency: businessCurrency(),
    drivers: jsonb("drivers").$type<Record<string, unknown>>().notNull().default(emptyObject),
    series: jsonb("series").$type<unknown[]>().notNull().default(emptyList),
    generatedByAgentId: uuid("generated_by_agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    ...timestampsWithArchive(),
  },
  (t) => [index("forecasts_business_id_idx").on(t.businessId, t.scenario, t.createdAt), index("forecasts_generated_by_agent_id_idx").on(t.generatedByAgentId)],
);
export type Forecast = typeof forecasts.$inferSelect;
export type NewForecast = typeof forecasts.$inferInsert;

export const securities = pgTable(
  "securities",
  {
    id: id(),
    businessId: businessId(),
    class: text("class").notNull(),
    kind: text("kind", { enum: SECURITY_KINDS }).notNull(),
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull().default(emptyObject),
    authorisedQuantity: minor("authorised_quantity"),
    currency: businessCurrency(),
    ...timestampsWithArchive(),
  },
  (t) => [uniqueIndex("securities_business_id_class_key").on(t.businessId, t.class), index("securities_business_id_idx").on(t.businessId)],
);
export type Security = typeof securities.$inferSelect;
export type NewSecurity = typeof securities.$inferInsert;

export const capTableEntries = pgTable(
  "cap_table_entries",
  {
    id: id(),
    businessId: businessId(),
    holderEntityId: uuid("holder_entity_id").notNull().references((): AnyPgColumn => entities.id, { onDelete: "restrict" }),
    securityId: uuid("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 20, scale: 4 }).notNull(),
    priceMinor: minor("price_minor"),
    currency: businessCurrency(),
    vesting: jsonb("vesting").$type<Record<string, unknown>>(),
    issuedAt: date("issued_at", { mode: "string" }),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("cap_table_entries_business_id_idx").on(t.businessId),
    index("cap_table_entries_holder_entity_id_idx").on(t.holderEntityId),
    index("cap_table_entries_security_id_idx").on(t.securityId),
  ],
);
export type CapTableEntry = typeof capTableEntries.$inferSelect;
export type NewCapTableEntry = typeof capTableEntries.$inferInsert;

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references((): AnyPgColumn => agentSessions.id, { onDelete: "set null" }),
    kind: text("kind", { enum: USAGE_KINDS }).notNull(),
    modelKey: text("model_key", { enum: MODEL_KEYS }),
    quantity: minor("quantity").notNull().default(0),
    unit: text("unit").notNull().default("tokens"),
    /** The cost rounded to a whole minor unit (one row's display figure). Sums use `costMicroMinor`. */
    costMinor: minor("cost_minor").notNull().default(0),
    /**
     * The exact cost in millionths of a minor unit (0039): what sums add before rounding once, so calls under half a
     * cent are not lost. Null on rows written before 0039 (they count as `costMinor` × 1,000,000).
     */
    costMicroMinor: minor("cost_micro_minor"),
    /** USD for every platform cost (tokens, sandbox, training; 0024); a tool row keeps the vendor's currency. */
    currency: usdCurrency(),
    billedTo: text("billed_to", { enum: MODEL_BILLING }).notNull().default("credits"),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(emptyObject),
    /** 0036: what the booking settles (`session:<id>:sandbox`, ...); a repeat with the same key is not booked again. */
    idempotencyKey: text("idempotency_key"),
    ...timestamps(),
  },
  (t) => [
    index("usage_ledger_business_id_idx").on(t.businessId, t.occurredAt),
    index("usage_ledger_agent_id_idx").on(t.agentId, t.occurredAt),
    index("usage_ledger_session_id_idx").on(t.sessionId),
    index("usage_ledger_kind_idx").on(t.businessId, t.kind, t.occurredAt),
    uniqueIndex("usage_ledger_idempotency_idx").on(t.businessId, t.idempotencyKey).where(sql`idempotency_key is not null`),
  ],
);
export type UsageEntry = typeof usageLedger.$inferSelect;
export type NewUsageEntry = typeof usageLedger.$inferInsert;

export const creditBalances = pgTable(
  "credit_balances",
  {
    id: id(),
    businessId: businessId(),
    period: text("period").notNull(),
    balanceMinor: minor("balance_minor").notNull().default(0),
    grantedMinor: minor("granted_minor").notNull().default(0),
    spentMinor: minor("spent_minor").notNull().default(0),
    /** Charges below a whole cent not yet charged to the balance, in millionths of a cent (0039; always under 1,000,000). */
    carryMicroMinor: minor("carry_micro_minor").notNull().default(0),
    /** Always USD (a check holds it, 0024): credits are bought and charged in the model price list's currency. */
    currency: usdCurrency(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("credit_balances_business_id_period_key").on(t.businessId, t.period), index("credit_balances_business_id_idx").on(t.businessId, t.period)],
);
export type CreditBalance = typeof creditBalances.$inferSelect;

/**
 * 0157 — the owner's included budget for a month, shared by all their projects (founder, Nov 19, 2026): account-scoped,
 * service role only. A charge draws on it first, then on the project's own `credit_balances` row (what the project bought).
 */
export const ownerCredits = pgTable(
  "owner_credits",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    grantedMinor: minor("granted_minor").notNull().default(0),
    balanceMinor: minor("balance_minor").notNull().default(0),
    spentMinor: minor("spent_minor").notNull().default(0),
    currency: usdCurrency(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("owner_credits_user_id_period_key").on(t.userId, t.period)],
);
export type OwnerCredits = typeof ownerCredits.$inferSelect;

/**
 * 0098 — a paid top-up as a lot (founder, 2026-11-13: bought credits last 12 months). The month's `credit_balances`
 * row stays the balance; the lots say how much of it is bought credit, what is left of each purchase and when it
 * expires (`repos.usage`: charges spend included credits first, then lots by expiry; a new month carries live lots over).
 */
export const creditLots = pgTable(
  "credit_lots",
  {
    id: id(),
    businessId: businessId(),
    checkoutId: uuid("checkout_id"),
    amountMinor: minor("amount_minor").notNull(),
    remainingMinor: minor("remaining_minor").notNull(),
    currency: usdCurrency(),
    purchasedAt: tstz("purchased_at").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [index("credit_lots_business_id_idx").on(t.businessId, t.expiresAt).where(sql`remaining_minor > 0`), uniqueIndex("credit_lots_checkout_id_key").on(t.checkoutId).where(sql`checkout_id is not null`)],
);
export type CreditLot = typeof creditLots.$inferSelect;
export type NewCreditBalance = typeof creditBalances.$inferInsert;
