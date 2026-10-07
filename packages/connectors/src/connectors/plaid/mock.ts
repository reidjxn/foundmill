import { buildMockConnector } from "../../define";
import { generateBankHistory } from "../../fixtures/bank-history";
import { addDays, MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { bankingMockHandlers, bankSyncSimulation, consentExpirySimulation, type BankingMockOptions } from "../_shared/banking";
import { PLAID_KEY, PLAID_PRODUCTS, PLAID_RATE_LIMITS, plaidTools } from "./tools";

export const MOCK_PLAID_INSTITUTION = "Mercury";
export const MOCK_PLAID_CONSENT_DAYS = 120;

export function plaidMockOptions(businessId: string): BankingMockOptions {
  return { provider: PLAID_KEY, history: generateBankHistory({ seed: `plaid:${businessId}`, asOf: MOCK_NOW, currency: "USD", companyName: "Ledgerly Inc", startMrrMinor: 610_000, growth: 0.06 }), institution: MOCK_PLAID_INSTITUTION, consentExpiresAt: addDays(MOCK_NOW, MOCK_PLAID_CONSENT_DAYS), now: () => MOCK_NOW };
}

export function createPlaidMock(businessId = "default") {
  const options = plaidMockOptions(businessId);
  return buildMockConnector({
    key: PLAID_KEY,
    displayName: "Plaid",
    phase: 2,
    auth: { kind: "oauth", scopes: PLAID_PRODUCTS },
    tools: plaidTools,
    rateLimits: PLAID_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: bankingMockHandlers(options),
    connect: async (bid) => mockIntegrationRecord(PLAID_KEY, bid, { accountLabel: `${MOCK_PLAID_INSTITUTION} (Plaid sandbox, mock)`, externalAccountId: `item_${stableHash(bid, 16)}`, scopes: PLAID_PRODUCTS, expiresAt: options.consentExpiresAt.toISOString(), config: { env: "sandbox", institution: MOCK_PLAID_INSTITUTION } }),
    healthcheck: async () => mockHealth(PLAID_KEY, { accounts: options.history.accounts.length, transactions: options.history.transactions.length }),
    simulations: {
      "bank.sync": (params) => bankSyncSimulation(plaidMockOptions(params.businessId), params),
      "credential.expiry": (params) => consentExpirySimulation(plaidMockOptions(params.businessId), PLAID_KEY, params),
    },
  });
}

export const plaidMock = createPlaidMock();
