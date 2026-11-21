/**
 * The mock side of `opensrs`: offline and deterministic. A name in `domains`' taken list is taken; every other is
 * available at a fixed cost ($11.25 for .com, $14.00 for anything else); registration answers a stable order id.
 * Nothing is registered and nothing is paid.
 */
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { MOCK_TAKEN_LABELS } from "../domains/mock";
import { OPENSRS_KEY, OPENSRS_RATE_LIMITS, opensrsTools } from "./tools";

export const MOCK_COM_COST_MINOR = 1125;
export const MOCK_OTHER_COST_MINOR = 1400;

const yearAfter = (d: Date): string => new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())).toISOString();

export const opensrsMock = buildMockConnector({
  key: OPENSRS_KEY,
  displayName: "Domain registration",
  phase: 1,
  auth: { kind: "none" },
  tools: opensrsTools,
  rateLimits: OPENSRS_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    lookup_domain: async ({ domain }) => {
      const label = domain.split(".")[0]!;
      const available = !MOCK_TAKEN_LABELS.includes(label);
      return { domain, available, costMinor: available ? (domain.endsWith(".com") ? MOCK_COM_COST_MINOR : MOCK_OTHER_COST_MINOR) : null };
    },
    register_domain: async ({ domain, owner }) => ({ orderId: `mock-${stableHash([domain, owner.email], 10)}`, registeredAt: MOCK_NOW.toISOString(), expiresAt: yearAfter(MOCK_NOW) }),
    set_dns_zone: async () => ({ nameserversOk: true }),
  },
  connect: async (businessId) => mockIntegrationRecord(OPENSRS_KEY, businessId, { accountLabel: "Built in (mock)" }),
  healthcheck: async () => mockHealth(OPENSRS_KEY),
});
