import { buildMockConnector } from "../../define";
import { connectInputValue, ConnectInputError } from "../../contract";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { IN_HOST, IN_KEY, IN_KEY_FILE } from "./fixtures/indexnow";
import { assertUrlsOnSite, INDEXNOW_CONNECT_FIELDS, INDEXNOW_KEY, INDEXNOW_RATE_LIMITS, indexNowKeyFileUrl, indexNowTarget, indexNowTools, isIndexNowKey, normalizeIndexNowHost } from "./tools";

/**
 * Nothing is sent. The mock checks the same things the live tool does (https, the configured host, the key file's folder)
 * and answers "received"; the gateway marks every mock result simulated, so no agent reports it as submitted.
 */
export const indexNowMock = buildMockConnector({
  key: INDEXNOW_KEY,
  displayName: "IndexNow",
  phase: 3,
  auth: { kind: "api_key" },
  tools: indexNowTools,
  rateLimits: INDEXNOW_RATE_LIMITS,
  connectFields: INDEXNOW_CONNECT_FIELDS,
  now: () => MOCK_NOW,
  handlers: {
    submit_urls: async ({ urls }, ctx) => {
      const key = ctx.credential?.secret ?? (typeof ctx.integration.config.key === "string" ? ctx.integration.config.key : IN_KEY);
      const target = indexNowTarget(ctx.integration.config, key) ?? { host: IN_HOST, keyLocation: IN_KEY_FILE };
      assertUrlsOnSite(urls, target.host, target.keyLocation);
      return { submitted: urls.length, host: target.host, status: "received" as const, urls };
    },
  },
  connect: async (businessId, input) => {
    const hostInput = connectInputValue(input, "host");
    const keyInput = connectInputValue(input, "key");
    const host = hostInput ? normalizeIndexNowHost(hostInput) : IN_HOST;
    if (!host) throw new ConnectInputError(INDEXNOW_KEY, "host", "Enter your site's host name, for example northwindskincare.com");
    const key = keyInput ?? IN_KEY;
    if (!isIndexNowKey(key)) throw new ConnectInputError(INDEXNOW_KEY, "key", "The IndexNow key must be 8 to 128 letters, numbers or dashes");
    const keyLocation = connectInputValue(input, "keyLocation") ?? indexNowKeyFileUrl(host, key);
    return mockIntegrationRecord(INDEXNOW_KEY, businessId, { accountLabel: host, externalAccountId: host, config: { host, keyLocation, key } });
  },
  healthcheck: async () => mockHealth(INDEXNOW_KEY, { host: IN_HOST }),
});
