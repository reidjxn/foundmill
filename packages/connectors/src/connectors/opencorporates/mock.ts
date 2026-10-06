import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { OC_COMPANIES } from "./fixtures/companies";
import { mapOcCompany, OPENCORPORATES_KEY, OPENCORPORATES_RATE_LIMITS, opencorporatesTools } from "./tools";

const wildcard = (q: string) => new RegExp(`^${q.trim().split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}`, "i");

export const opencorporatesMock = buildMockConnector({
  key: OPENCORPORATES_KEY,
  displayName: "OpenCorporates",
  phase: 1,
  auth: { kind: "api_key" },
  tools: opencorporatesTools,
  rateLimits: OPENCORPORATES_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    search_companies: async ({ q, jurisdictionCode, page, perPage }) => {
      const re = q.includes("*") ? wildcard(q) : new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const hits = OC_COMPANIES.filter((c) => re.test(c.name) && (!jurisdictionCode || c.jurisdiction_code === jurisdictionCode));
      return { items: hits.slice((page - 1) * perPage, page * perPage).map(mapOcCompany), totalCount: hits.length, page, perPage };
    },
    get_company: async ({ jurisdictionCode, companyNumber }) => {
      const c = OC_COMPANIES.find((x) => x.jurisdiction_code === jurisdictionCode && x.company_number === companyNumber);
      if (!c) throw Object.assign(new Error(`company ${jurisdictionCode}/${companyNumber} not found`), { status: 404 });
      return mapOcCompany(c);
    },
  },
  connect: async (businessId) => mockIntegrationRecord(OPENCORPORATES_KEY, businessId, { accountLabel: "OpenCorporates (mock)" }),
  healthcheck: async () => mockHealth(OPENCORPORATES_KEY),
});
