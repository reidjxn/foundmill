import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { mockScrapeFor } from "./fixtures/pages";
import { assertPublicUrl, capMarkdown, FIRECRAWL_KEY, FIRECRAWL_RATE_LIMITS, firecrawlTools } from "./tools";

export const MOCK_NOTICE = "Simulated: this is fixture content for the address, not the page itself. Nothing was read from the web.";

/** Deterministic pages, no network. The same address guard as the live connector applies. */
export const firecrawlMock = buildMockConnector({
  key: FIRECRAWL_KEY,
  displayName: "Firecrawl",
  phase: 3,
  auth: { kind: "api_key" },
  tools: firecrawlTools,
  rateLimits: FIRECRAWL_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    scrape_page: async ({ url }) => {
      const parsed = assertPublicUrl(url);
      const page = mockScrapeFor(parsed);
      return { url, finalUrl: parsed.toString(), statusCode: 200, title: page.title, description: page.description, ...capMarkdown(page.markdown), simulated: true as const, notice: MOCK_NOTICE };
    },
  },
  connect: async (businessId) => mockIntegrationRecord(FIRECRAWL_KEY, businessId, { accountLabel: "Firecrawl (mock)" }),
  healthcheck: async () => mockHealth(FIRECRAWL_KEY),
});
