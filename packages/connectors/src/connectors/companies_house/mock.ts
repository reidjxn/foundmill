import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { CH_COMPANIES, CH_OFFICERS } from "./fixtures/companies";
import { COMPANIES_HOUSE_KEY, COMPANIES_HOUSE_RATE_LIMITS, companiesHouseTools, mapOfficer, mapProfile, mapSearchItem } from "./tools";

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

export const companiesHouseMock = buildMockConnector({
  key: COMPANIES_HOUSE_KEY,
  displayName: "Companies House",
  phase: 1,
  auth: { kind: "api_key", platformKey: true },
  tools: companiesHouseTools,
  rateLimits: COMPANIES_HOUSE_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    search_companies: async ({ q, itemsPerPage }) => {
      const needle = q.trim().toUpperCase();
      const hits = CH_COMPANIES.filter((c) => c.company_name.includes(needle) || c.company_number === needle);
      return { items: hits.slice(0, itemsPerPage).map((c) => mapSearchItem({ company_number: c.company_number, title: c.company_name, company_status: c.company_status, date_of_creation: c.date_of_creation, address_snippet: `${c.registered_office_address?.address_line_1}, ${c.registered_office_address?.locality}, ${c.registered_office_address?.postal_code}` })), totalResults: hits.length };
    },
    get_company: async ({ companyNumber }) => {
      const c = CH_COMPANIES.find((x) => x.company_number === companyNumber);
      if (!c) throw notFound(`company ${companyNumber}`);
      return mapProfile(c);
    },
    list_officers: async ({ companyNumber, itemsPerPage }) => {
      if (!CH_COMPANIES.some((x) => x.company_number === companyNumber)) throw notFound(`company ${companyNumber}`);
      const officers = CH_OFFICERS[companyNumber] ?? [];
      return { items: officers.slice(0, itemsPerPage).map(mapOfficer), activeCount: officers.filter((o) => !o.resigned_on).length, resignedCount: officers.filter((o) => o.resigned_on).length };
    },
  },
  connect: async (businessId) => mockIntegrationRecord(COMPANIES_HOUSE_KEY, businessId, { accountLabel: "Companies House (mock)" }),
  healthcheck: async () => mockHealth(COMPANIES_HOUSE_KEY),
});
