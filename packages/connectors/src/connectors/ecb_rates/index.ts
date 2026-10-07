/** Live ECB connector: parses the public daily XML feed; cached for an hour since it changes once a day. */
import { uuid } from "@foundmill/shared";
import type { Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { ecbRatesMock } from "./mock";
import { convertWithRates, ECB_DAILY_XML_URL, ECB_KEY, ECB_RATE_LIMITS, ecbTools, parseEcbXml, type Rates } from "./tools";

export function createEcbRatesConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);
  const http = createHttp({ connectorKey: ECB_KEY, baseUrl: "https://www.ecb.europa.eu", fetch, headers: { accept: "application/xml,text/xml" } });
  let cache: { rates: Rates; at: number } | null = null;

  const rates = async (): Promise<Rates> => {
    if (cache && now().getTime() - cache.at < 60 * 60 * 1000) return cache.rates;
    const xml = await http.text("GET", ECB_DAILY_XML_URL);
    cache = { rates: parseEcbXml(xml), at: now().getTime() };
    return cache.rates;
  };

  return buildLiveConnector(
    {
      key: ECB_KEY,
      displayName: "ECB reference rates",
      phase: 1,
      auth: { kind: "none" },
      tools: ecbTools,
      rateLimits: ECB_RATE_LIMITS,
      now,
      handlers: {
        get_daily_rates: async () => rates(),
        convert: async ({ amountMinor, from, to }) => convertWithRates(await rates(), amountMinor, from, to),
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: ECB_KEY, status: "connected", scopes: [], accountLabel: "ECB (public)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          const r = await rates();
          return healthResult("connected", startedAt, { now, details: { date: r.date, currencies: Object.keys(r.rates).length } });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    ecbRatesMock,
  );
}

export { ecbRatesMock } from "./mock";
export { ecbTools, ECB_KEY } from "./tools";
