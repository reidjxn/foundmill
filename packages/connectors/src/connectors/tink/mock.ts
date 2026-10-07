import { buildMockConnector } from "../../define";
import { generateBankHistory } from "../../fixtures/bank-history";
import { addDays, MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { bankingMockHandlers, bankSyncSimulation, consentExpirySimulation, type BankingMockOptions } from "../_shared/banking";
import { TINK_KEY, TINK_RATE_LIMITS, TINK_USER_SCOPES, tinkTools } from "./tools";

export const MOCK_TINK_INSTITUTION = "SEB";
export const MOCK_TINK_CONSENT_DAYS = 62;

/** One deterministic history per business (seeded by the business id), so demo businesses differ. */
export function tinkMockOptions(businessId: string): BankingMockOptions {
  return { provider: TINK_KEY, history: generateBankHistory({ seed: `tink:${businessId}`, asOf: MOCK_NOW, currency: "EUR" }), institution: MOCK_TINK_INSTITUTION, consentExpiresAt: addDays(MOCK_NOW, MOCK_TINK_CONSENT_DAYS), now: () => MOCK_NOW };
}

export function createTinkMock(businessId = "default") {
  const options = tinkMockOptions(businessId);
  return buildMockConnector({
    key: TINK_KEY,
    displayName: "Tink",
    phase: 2,
    auth: { kind: "oauth", scopes: TINK_USER_SCOPES.split(",") },
    tools: tinkTools,
    rateLimits: TINK_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: bankingMockHandlers(options),
    connect: async (bid) => mockIntegrationRecord(TINK_KEY, bid, { accountLabel: `${MOCK_TINK_INSTITUTION} (Tink, mock)`, externalAccountId: `tink_user_${stableHash(bid, 12)}`, scopes: TINK_USER_SCOPES.split(","), expiresAt: options.consentExpiresAt.toISOString(), config: { market: "SE", institution: MOCK_TINK_INSTITUTION } }),
    healthcheck: async () => mockHealth(TINK_KEY, { accounts: options.history.accounts.length, transactions: options.history.transactions.length }),
    simulations: {
      "bank.sync": (params) => bankSyncSimulation(tinkMockOptions(params.businessId), params),
      "credential.expiry": (params) => consentExpirySimulation(tinkMockOptions(params.businessId), TINK_KEY, params),
    },
  });
}

export const tinkMock = createTinkMock();
