/** Live Companies House connector: HTTP Basic with the API key as username (public data API). */
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { basicAuth, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { companiesHouseMock } from "./mock";
import { COMPANIES_HOUSE_BASE_URL, COMPANIES_HOUSE_KEY, COMPANIES_HOUSE_RATE_LIMITS, companiesHouseTools, mapOfficer, mapProfile, mapSearchItem, type ChCompanyProfile, type ChOfficersResponse, type ChSearchResponse } from "./tools";

export function createCompaniesHouseConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const http = (ctx?: ToolContext) => {
    const key = ctx?.credential?.secret ?? secrets.companiesHouseApiKey;
    if (!key) throw new ConfigError(COMPANIES_HOUSE_KEY, "COMPANIES_HOUSE_API_KEY", "register an application at developer.company-information.service.gov.uk");
    return createHttp({ connectorKey: COMPANIES_HOUSE_KEY, baseUrl: COMPANIES_HOUSE_BASE_URL, fetch, headers: { authorization: basicAuth(key) } });
  };

  return buildLiveConnector(
    {
      key: COMPANIES_HOUSE_KEY,
      displayName: "Companies House",
      phase: 1,
      auth: { kind: "api_key", platformKey: true },
      tools: companiesHouseTools,
      rateLimits: COMPANIES_HOUSE_RATE_LIMITS,
      now,
      handlers: {
        search_companies: async ({ q, itemsPerPage }, ctx) => {
          const res = await http(ctx).json<ChSearchResponse>("GET", "/search/companies", { query: { q, items_per_page: itemsPerPage } });
          return { items: (res.items ?? []).map(mapSearchItem), totalResults: res.total_results ?? res.items?.length ?? 0 };
        },
        get_company: async ({ companyNumber }, ctx) => mapProfile(await http(ctx).json<ChCompanyProfile>("GET", `/company/${companyNumber}`)),
        list_officers: async ({ companyNumber, itemsPerPage }, ctx) => {
          const res = await http(ctx).json<ChOfficersResponse>("GET", `/company/${companyNumber}/officers`, { query: { items_per_page: itemsPerPage } });
          return { items: (res.items ?? []).map(mapOfficer), activeCount: res.active_count ?? 0, resignedCount: res.resigned_count ?? 0 };
        },
      },
      connect: async (businessId) => {
        await http().json("GET", "/search/companies", { query: { q: "companies house", items_per_page: 1 } });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: COMPANIES_HOUSE_KEY, status: "connected", scopes: [], accountLabel: "Companies House (platform key)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          await http().json("GET", "/search/companies", { query: { q: "companies house", items_per_page: 1 } });
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    companiesHouseMock,
  );
}

export { companiesHouseMock } from "./mock";
export { companiesHouseTools, COMPANIES_HOUSE_KEY } from "./tools";
