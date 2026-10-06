import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { ECB_FIXTURE_RATES } from "./fixtures/rates";
import { convertWithRates, ECB_KEY, ECB_RATE_LIMITS, ecbTools } from "./tools";

export const ecbRatesMock = buildMockConnector({
  key: ECB_KEY,
  displayName: "ECB reference rates",
  phase: 1,
  auth: { kind: "none" },
  tools: ecbTools,
  rateLimits: ECB_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    get_daily_rates: async () => ECB_FIXTURE_RATES,
    convert: async ({ amountMinor, from, to }) => convertWithRates(ECB_FIXTURE_RATES, amountMinor, from, to),
  },
  connect: async (businessId) => mockIntegrationRecord(ECB_KEY, businessId, { accountLabel: "ECB (public, mock)" }),
  healthcheck: async () => mockHealth(ECB_KEY, { date: ECB_FIXTURE_RATES.date }),
});
