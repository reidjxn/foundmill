/** Live web reader: public pages only, within robots.txt, size- and time-capped (./reader.ts). No account, no key. */
import { uuid } from "@foundmill/shared";
import type { Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { webMock } from "./mock";
import { createPageReader, defaultLookup, type HostLookup } from "./reader";
import { WEB_KEY, WEB_RATE_LIMITS, webTools } from "./tools";

export interface WebConnectorOptions extends LiveConnectorOptions {
  /** DNS lookup used for the address checks (tests inject one). */
  lookup?: HostLookup;
  timeoutMs?: number;
}

export function createWebConnector(options: WebConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);
  const read = createPageReader({ fetch, now, lookup: options.lookup ?? defaultLookup, timeoutMs: options.timeoutMs });

  return buildLiveConnector(
    {
      key: WEB_KEY,
      displayName: "Public web pages",
      phase: 1,
      auth: { kind: "none" },
      tools: webTools,
      rateLimits: WEB_RATE_LIMITS,
      now,
      handlers: {
        fetch: async ({ url, maxChars }) => read(url, maxChars),
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: WEB_KEY, status: "connected", scopes: [], accountLabel: "Public web pages", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      // Nothing to check: there is no account, and each read reports its own failure.
      healthcheck: async () => healthResult("connected", now().getTime(), { now }),
    },
    webMock,
  );
}

export { webMock } from "./mock";
export { webTools, WEB_KEY, WEB_USER_AGENT, WEB_ROBOTS_TOKEN } from "./tools";
export { htmlToText, isPublicAddress, robotsAllows } from "./reader";
