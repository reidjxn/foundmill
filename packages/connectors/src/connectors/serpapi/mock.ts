import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { SKINCARE_AI_OVERVIEW, SKINCARE_ORGANIC } from "./fixtures/serp";
import { flattenAiOverview, mapOrganic, SERPAPI_KEY, SERPAPI_RATE_LIMITS, serpapiTools, type SearchGoogleOutput } from "./tools";

const SKINCARE = /skin|moisturi|serum|sunscreen|cleanser/i;

/** A skincare query gets the recorded results and an AI Overview; any other query gets three generated results and no overview. */
export function mockSearch(query: string, includeAiOverview: boolean): SearchGoogleOutput {
  const searchId = `mock_${stableHash(query.toLowerCase(), 12)}`;
  if (SKINCARE.test(query)) {
    return { query, organic: mapOrganic(SKINCARE_ORGANIC.map((r) => ({ ...r }))), aiOverview: includeAiOverview ? flattenAiOverview(SKINCARE_AI_OVERVIEW) : null, searchId };
  }
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "results";
  const organic = mapOrganic(Array.from({ length: 3 }, (_, i) => ({ position: i + 1, title: `${query} (result ${i + 1}, mock)`, link: `https://example.com/${slug}/${i + 1}`, snippet: `A page about ${query} (mock ${stableHash([query, i], 6)}).` })));
  return { query, organic, aiOverview: null, searchId };
}

export const serpapiMock = buildMockConnector({
  key: SERPAPI_KEY,
  displayName: "SerpApi",
  phase: 3,
  auth: { kind: "api_key" },
  tools: serpapiTools,
  rateLimits: SERPAPI_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    search_google: async ({ query, includeAiOverview }) => mockSearch(query, includeAiOverview),
  },
  connect: async (businessId) => mockIntegrationRecord(SERPAPI_KEY, businessId, { accountLabel: "SerpApi (mock)" }),
  healthcheck: async () => mockHealth(SERPAPI_KEY),
});
