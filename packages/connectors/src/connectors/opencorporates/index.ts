/** Live OpenCorporates connector: `api_token` query parameter (redacted from logs by the http client). */
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { opencorporatesMock } from "./mock";
import { mapOcCompany, OPENCORPORATES_BASE_URL, OPENCORPORATES_KEY, OPENCORPORATES_RATE_LIMITS, opencorporatesTools, type OcCompanyResponse, type OcSearchResponse } from "./tools";

export function createOpencorporatesConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const http = createHttp({ connectorKey: OPENCORPORATES_KEY, baseUrl: OPENCORPORATES_BASE_URL, fetch });
  const token = (ctx?: ToolContext): string => {
    const t = ctx?.credential?.secret ?? secrets.opencorporatesApiToken;
    if (!t) throw new ConfigError(OPENCORPORATES_KEY, "OPENCORPORATES_API_TOKEN");
    return t;
  };

  return buildLiveConnector(
    {
      key: OPENCORPORATES_KEY,
      displayName: "OpenCorporates",
      phase: 1,
      auth: { kind: "api_key", platformKey: true },
      tools: opencorporatesTools,
      rateLimits: OPENCORPORATES_RATE_LIMITS,
      now,
      handlers: {
        search_companies: async ({ q, jurisdictionCode, page, perPage }, ctx) => {
          const res = await http.json<OcSearchResponse>("GET", "/companies/search", { query: { q, jurisdiction_code: jurisdictionCode, page, per_page: perPage, api_token: token(ctx) } });
          return { items: res.results.companies.map((c) => mapOcCompany(c.company)), totalCount: res.results.total_count, page: res.results.page, perPage: res.results.per_page };
        },
        get_company: async ({ jurisdictionCode, companyNumber }, ctx) => {
          const res = await http.json<OcCompanyResponse>("GET", `/companies/${jurisdictionCode}/${encodeURIComponent(companyNumber)}`, { query: { api_token: token(ctx) } });
          return mapOcCompany(res.results.company);
        },
      },
      connect: async (businessId) => {
        await http.json("GET", "/account_status", { query: { api_token: token() } });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: OPENCORPORATES_KEY, status: "connected", scopes: [], accountLabel: "OpenCorporates (platform token)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          const status = await http.json<{ account_status?: { usage?: { today?: number; this_month?: number } } }>("GET", "/account_status", { query: { api_token: token() } });
          return healthResult("connected", startedAt, { now, details: { usage: status.account_status?.usage ?? {} } });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    opencorporatesMock,
  );
}

export { opencorporatesMock } from "./mock";
export { opencorporatesTools, OPENCORPORATES_KEY } from "./tools";
