/**
 * Tink (open banking, EU/UK — BUILD §13.2 phase 2). Thin client over the documented endpoints:
 *   POST /api/v1/oauth/token                      client credentials / authorization code → access token
 *   POST /api/v1/user/create                      create the Tink user that owns the consent
 *   POST /api/v1/oauth/authorization-grant/delegate  code for Tink Link (founder grants consent there)
 *   POST /api/v1/oauth/authorization-grant        code for a user access token (continuous access)
 *   GET  /data/v2/accounts, GET /data/v2/transactions, GET /api/v1/provider-consents
 * Payment initiation endpoints are never wrapped (AC-11.8.5).
 */
import { BANKING_RATE_LIMITS, makeBankingTools, type BankAccountT, type BankTransactionT } from "../_shared/banking";

export const TINK_KEY = "tink";
export const TINK_BASE_URL = "https://api.tink.com";
export const TINK_LINK_URL = "https://link.tink.com/1.0/transactions/connect-accounts";
/** Tink Link's actor client id (public, from the Tink docs). */
export const TINK_LINK_ACTOR_CLIENT_ID = "df05e4b379934cd09963197cc855bfe9";
export const TINK_USER_SCOPES = "accounts:read,balances:read,transactions:read,provider-consents:read";
export const TINK_PLATFORM_SCOPES = "authorization:grant,user:create,user:read";

export const tinkTools = makeBankingTools({ key: TINK_KEY, linkName: "Tink Link", linkUrl: TINK_LINK_URL });
export const TINK_RATE_LIMITS = BANKING_RATE_LIMITS;

/* ---- Vendor shapes (Data API v2) ---- */
export interface TkAmount { value: { unscaledValue: string; scale: string }; currencyCode: string }
export interface TkAccount { id: string; name: string; type: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | string; balances?: { booked?: { amount: TkAmount }; available?: { amount: TkAmount } }; identifiers?: { iban?: { iban: string; bban?: string }; financialInstitution?: { accountNumber?: string } }; dates?: { lastRefreshed?: string }; financialInstitutionId?: string }
export interface TkTransaction { id: string; accountId: string; amount: TkAmount; descriptions?: { original?: string; display?: string }; dates?: { booked?: string; value?: string }; status: "BOOKED" | "PENDING" | "UNDEFINED"; reference?: string; merchantInformation?: { merchantName?: string }; types?: { type?: string }; categories?: { pfm?: { name?: string } } }
export interface TkProviderConsent { credentialsId: string; providerName: string; status: string; sessionExpiryDate?: number; accountIds?: string[] }

export const tinkAmountMinor = (a: TkAmount): number => {
  const unscaled = Number.parseInt(a.value.unscaledValue, 10);
  const scale = Number.parseInt(a.value.scale, 10);
  const v = unscaled * 10 ** (2 - scale);
  return Math.sign(v) * Math.round(Math.abs(v)); // half away from zero, as banks round
};

export const mapTinkAccount = (a: TkAccount, institution: string | null, fallbackAt: string): BankAccountT => {
  const booked = a.balances?.booked?.amount;
  const available = a.balances?.available?.amount;
  const currency = (booked?.currencyCode ?? available?.currencyCode ?? "EUR").toUpperCase();
  const iban = a.identifiers?.iban?.iban ?? null;
  return { id: a.id, name: a.name, type: a.type === "CHECKING" ? "checking" : a.type === "SAVINGS" ? "savings" : a.type === "CREDIT_CARD" ? "credit_card" : "other", currency, iban, mask: (iban ?? a.identifiers?.financialInstitution?.accountNumber ?? "").slice(-4) || null, booked: { amountMinor: booked ? tinkAmountMinor(booked) : 0, currency }, available: available ? { amountMinor: tinkAmountMinor(available), currency } : null, balanceAt: a.dates?.lastRefreshed ?? fallbackAt, institution };
};

export const mapTinkTransaction = (t: TkTransaction): BankTransactionT => ({ id: t.id, accountId: t.accountId, amount: { amountMinor: tinkAmountMinor(t.amount), currency: t.amount.currencyCode.toUpperCase() }, bookedDate: t.dates?.booked ?? t.dates?.value ?? "", valueDate: t.dates?.value ?? null, description: t.descriptions?.display ?? t.descriptions?.original ?? "", counterparty: t.merchantInformation?.merchantName ?? null, status: t.status === "PENDING" ? "pending" : "booked", reference: t.reference ?? null, category: t.categories?.pfm?.name ?? t.types?.type ?? null });
