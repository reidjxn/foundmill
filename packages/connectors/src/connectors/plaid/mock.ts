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

/**
 * The tools serve the calling business's own history (`ctx.businessId`), the same one its `bank.sync` simulation
 * reports. `businessId` pins every call to one history instead (tests of a single business).
 */
export function createPlaidMock(businessId?: string) {
  const optionsFor = (bid: string) => plaidMockOptions(businessId ?? bid);
  const consentExpiresAt = addDays(MOCK_NOW, MOCK_PLAID_CONSENT_DAYS);
  return buildMockConnector({
    key: PLAID_KEY,
    displayName: "Plaid",
    phase: 2,
    auth: { kind: "oauth", scopes: PLAID_PRODUCTS },
    tools: plaidTools,
    rateLimits: PLAID_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: bankingMockHandlers(optionsFor),
    connect: async (bid) => mockIntegrationRecord(PLAID_KEY, bid, { accountLabel: `${MOCK_PLAID_INSTITUTION} (Plaid sandbox, mock)`, externalAccountId: `item_${stableHash(bid, 16)}`, scopes: PLAID_PRODUCTS, expiresAt: consentExpiresAt.toISOString(), config: { env: "sandbox", institution: MOCK_PLAID_INSTITUTION } }),
    healthcheck: async (integration) => {
      const { history } = optionsFor(integration.businessId);
      return mockHealth(PLAID_KEY, { accounts: history.accounts.length, transactions: history.transactions.length });
    },
    simulations: {
      "bank.sync": (params) => bankSyncSimulation(optionsFor(params.businessId), params),
      "credential.expiry": (params) => consentExpirySimulation(optionsFor(params.businessId), PLAID_KEY, params),
    },
  });
}

export const plaidMock = createPlaidMock();
