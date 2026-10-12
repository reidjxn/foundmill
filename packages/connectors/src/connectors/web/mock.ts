import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { htmlToText, WEB_KEY, WEB_RATE_LIMITS, webTools } from "./tools";

/** Deterministic pages for mock mode: one page per address, generated from the address itself (no network). */
export function mockPage(url: string): { html: string } {
  const host = new URL(url).hostname;
  return { html: `<html><head><title>${host}</title></head><body><h1>${host}</h1><p>A page about ${new URL(url).pathname.replace(/[/_-]+/g, " ").trim() || "the home page"} (mock ${stableHash(url, 8)}).</p><p>Contact: hello@${host}</p></body></html>` };
}

export function createWebMock() {
  return buildMockConnector({
    key: WEB_KEY,
    displayName: "Web search and pages",
    phase: 1,
    auth: { kind: "none" },
    tools: webTools,
    rateLimits: WEB_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      search_web: async ({ query, limit }) => {
        const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "results";
        const results = Array.from({ length: Math.min(limit, 3) }, (_, i) => ({ url: `https://example.com/${slug}/${i + 1}`, title: `${query} (result ${i + 1}, mock)`, pageAge: null }));
        return { query, results };
      },
      fetch_page: async ({ url, maxChars }) => {
        const { title, text } = htmlToText(mockPage(url).html, "text/html");
        return { url, finalUrl: url, status: 200, contentType: "text/html", title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(WEB_KEY, businessId, { accountLabel: "Built in" }),
    healthcheck: async () => mockHealth(WEB_KEY),
  });
}

export const webMock = createWebMock();
