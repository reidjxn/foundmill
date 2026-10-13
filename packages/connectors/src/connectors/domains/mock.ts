import { parseDomain } from "@foundmill/shared";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { DOMAINS_KEY, DOMAINS_RATE_LIMITS, domainsTools, type DomainAnswer } from "./tools";

/** Names the mock answers `taken` for on every TLD (well-known brands and the documentation names). */
export const MOCK_TAKEN_LABELS: readonly string[] = ["google", "apple", "example", "northwind", "microsoft", "amazon", "stripe", "github", "notion", "openai", "shopify", "slack", "test", "foundmill"];

/**
 * A name containing this answers `unknown`, so the "Couldn't check" row and its Retry are testable in mock mode. The Commit
 * screen builds labels from letters and digits only (a business name has no hyphen in its domain), so a label that starts
 * with "unknown" counts too: typing "unknown-brand" asks about `unknownbrand.com`.
 */
export const MOCK_UNKNOWN_MARKER = "unknown-";
const MOCK_UNKNOWN_PREFIX = "unknown";

/** Deterministic and honest: a fixed list is taken, the marker is unknown, everything else is available; always "Mock". */
export function mockDomainAnswer(input: string): DomainAnswer {
  const parsed = parseDomain(input);
  const domain = parsed?.domain ?? input.trim().toLowerCase();
  const base = { domain, provenance: "Mock" as const, estimate: false, checkedAt: MOCK_NOW.toISOString() };
  if (!parsed) return { ...base, status: "unknown", reason: "That is not a domain name we look up." };
  if (parsed.label.includes(MOCK_UNKNOWN_MARKER) || parsed.label.startsWith(MOCK_UNKNOWN_PREFIX)) return { ...base, status: "unknown", reason: "Mock mode: a name starting with “unknown” is never answered." };
  if (MOCK_TAKEN_LABELS.includes(parsed.label)) return { ...base, status: "taken", registrar: "Mock Registrar", expires: "2027-01-15" };
  return { ...base, status: "available" };
}

export const domainsMock = buildMockConnector({
  key: DOMAINS_KEY,
  displayName: "Domain availability",
  phase: 1,
  auth: { kind: "none" },
  tools: domainsTools,
  rateLimits: DOMAINS_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    check_domains: async ({ domains }) => ({ results: [...new Set(domains.map((d) => d.trim().toLowerCase()))].map(mockDomainAnswer) }),
  },
  connect: async (businessId) => mockIntegrationRecord(DOMAINS_KEY, businessId, { accountLabel: "Domain availability (mock)" }),
  healthcheck: async () => mockHealth(DOMAINS_KEY),
});
