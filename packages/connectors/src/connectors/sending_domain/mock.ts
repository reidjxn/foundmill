/**
 * The mock side of `sending_domain`: deterministic and offline. A domain whose name contains `notyet` is never found (so
 * the "not found yet" lines are testable); every other one is found on the first check. Nothing leaves the process.
 */
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { SENDING_DOMAIN_KEY, SENDING_DOMAIN_RATE_LIMITS, sendingDomainTools, type DnsRecordT } from "./tools";

/** A domain (or record host) containing this is never found by the mock. */
export const MOCK_NOT_YET_MARKER = "notyet";

/** The three CNAMEs SendGrid returns for automatic security, with a stable mock user id. */
export function mockSendgridRecords(domain: string, subdomain: string): DnsRecordT[] {
  const u = Number.parseInt(stableHash([domain], 6), 16) % 90_000_000 + 10_000_000;
  return [
    { type: "CNAME", host: `${subdomain}.${domain}`, value: `u${u}.wl.sendgrid.net` },
    { type: "CNAME", host: `s1._domainkey.${domain}`, value: `s1.domainkey.u${u}.wl.sendgrid.net` },
    { type: "CNAME", host: `s2._domainkey.${domain}`, value: `s2.domainkey.u${u}.wl.sendgrid.net` },
  ];
}

export const sendingDomainMock = buildMockConnector({
  key: SENDING_DOMAIN_KEY,
  displayName: "Your own domain",
  phase: 1,
  auth: { kind: "none" },
  tools: sendingDomainTools,
  rateLimits: SENDING_DOMAIN_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    authenticate_domain: async ({ domain, subdomain }) => {
      const sendgridDomainId = String(Number.parseInt(stableHash([domain, subdomain], 8), 16));
      return { sendgridDomainId, records: mockSendgridRecords(domain, subdomain) };
    },
    validate_domain: async ({ domain }) => {
      const found = !domain.includes(MOCK_NOT_YET_MARKER);
      const results = mockSendgridRecords(domain, "em").map((r) => ({ host: r.host, found, ...(found ? {} : { reason: "Not found yet." }) }));
      return { valid: found, results };
    },
    delete_domain: async () => ({ deleted: true }),
    check_records: async ({ records }) => ({ results: records.map((r) => (r.host.includes(MOCK_NOT_YET_MARKER) ? { found: false, reason: "Not found yet." } : { found: true })) }),
  },
  connect: async (businessId) => mockIntegrationRecord(SENDING_DOMAIN_KEY, businessId, { accountLabel: "Built in (mock)" }),
  healthcheck: async () => mockHealth(SENDING_DOMAIN_KEY),
});
