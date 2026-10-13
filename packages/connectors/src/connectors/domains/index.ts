/**
 * Live domain-availability connector: asks the registry's RDAP server (found through IANA's bootstrap) whether a name is
 * registered, with a DNS estimate for the TLDs that have no RDAP server (rdap.ts). No account, no key; the gateway needs to
 * reach data.iana.org and the registries' RDAP hosts.
 */
import { uuid } from "@foundmill/shared";
import type { Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { domainsMock } from "./mock";
import { createDomainLookup, type DnsLike } from "./rdap";
import { DOMAINS_KEY, DOMAINS_RATE_LIMITS, domainsTools } from "./tools";

export interface DomainsConnectorOptions extends LiveConnectorOptions {
  /** DNS used for TLDs with no RDAP server (tests inject one). */
  dns?: DnsLike;
  timeoutMs?: number;
}

export function createDomainsConnector(options: DomainsConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);
  const lookup = createDomainLookup({ fetch, now, dns: options.dns, timeoutMs: options.timeoutMs });

  return buildLiveConnector(
    {
      key: DOMAINS_KEY,
      displayName: "Domain availability",
      phase: 1,
      auth: { kind: "none" },
      tools: domainsTools,
      rateLimits: DOMAINS_RATE_LIMITS,
      now,
      handlers: {
        check_domains: async ({ domains }) => ({ results: await lookup.check(domains) }),
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: DOMAINS_KEY, status: "connected", scopes: [], accountLabel: "Domain availability (public registries)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          await lookup.ready();
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    domainsMock,
  );
}

export { domainsMock, mockDomainAnswer, MOCK_TAKEN_LABELS, MOCK_UNKNOWN_MARKER } from "./mock";
export { createDomainLookup, parseBootstrap, registrationDetails, IANA_BOOTSTRAP_URL } from "./rdap";
export type { DnsLike } from "./rdap";
export { domainsTools, DOMAINS_KEY, DomainAnswer } from "./tools";
