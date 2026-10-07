/**
 * Plaid (open banking, US/CA/UK/EU — BUILD §13.2 phase 2). Thin client over the documented endpoints:
 *   POST /link/token/create, POST /item/public_token/exchange, POST /item/get,
 *   POST /accounts/get, POST /accounts/balance/get, POST /transactions/sync, POST /transactions/get
 * Every request carries `client_id` + `secret` in the JSON body. Transfer/payment-initiation products are
 * never wrapped (AC-11.8.5).
 */
import { BANKING_RATE_LIMITS, makeBankingTools, type BankAccountT, type BankTransactionT } from "../_shared/banking";

export const PLAID_KEY = "plaid";
export const PLAID_ENV_URLS = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" } as const;
export const PLAID_LINK_URL = "https://plaid.com/docs/link/";
export const PLAID_PRODUCTS = ["transactions"];

export const plaidTools = makeBankingTools({ key: PLAID_KEY, linkName: "Plaid Link", linkUrl: PLAID_LINK_URL });
export const PLAID_RATE_LIMITS = BANKING_RATE_LIMITS;

/* ---- Vendor shapes ---- */
export interface PlAccount { account_id: string; name: string; official_name?: string | null; type: string; subtype?: string | null; mask?: string | null; balances: { available?: number | null; current?: number | null; iso_currency_code?: string | null; unofficial_currency_code?: string | null; last_updated_datetime?: string | null } }
export interface PlTransaction { transaction_id: string; account_id: string; amount: number; iso_currency_code?: string | null; date: string; authorized_date?: string | null; name: string; merchant_name?: string | null; pending: boolean; personal_finance_category?: { primary?: string; detailed?: string } | null; payment_meta?: { reference_number?: string | null } | null }
export interface PlItem { item_id: string; institution_id?: string | null; institution_name?: string | null; consent_expiration_time?: string | null; error?: { error_code: string } | null }
export interface PlSyncResponse { added: PlTransaction[]; modified: PlTransaction[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }

const minor = (v: number | null | undefined): number => Math.round((v ?? 0) * 100);

export const mapPlaidAccount = (a: PlAccount, institution: string | null, fallbackAt: string): BankAccountT => {
  const currency = (a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? "USD").toUpperCase();
  const type = a.type === "depository" ? (a.subtype === "savings" ? "savings" : "checking") : a.type === "credit" ? "credit_card" : a.type === "loan" ? "loan" : a.type === "investment" ? "investment" : "other";
  return { id: a.account_id, name: a.official_name ?? a.name, type, currency, iban: null, mask: a.mask ?? null, booked: { amountMinor: minor(a.balances.current), currency }, available: a.balances.available === null || a.balances.available === undefined ? null : { amountMinor: minor(a.balances.available), currency }, balanceAt: a.balances.last_updated_datetime ?? fallbackAt, institution };
};

/** Plaid reports outflows as positive amounts; the platform convention is signed (inflow positive). */
export const mapPlaidTransaction = (t: PlTransaction): BankTransactionT => ({ id: t.transaction_id, accountId: t.account_id, amount: { amountMinor: -minor(t.amount), currency: (t.iso_currency_code ?? "USD").toUpperCase() }, bookedDate: t.date, valueDate: t.authorized_date ?? null, description: t.name, counterparty: t.merchant_name ?? null, status: t.pending ? "pending" : "booked", reference: t.payment_meta?.reference_number ?? null, category: t.personal_finance_category?.primary ?? null });
