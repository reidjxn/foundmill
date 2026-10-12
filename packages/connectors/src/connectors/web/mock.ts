import { AppError } from "@foundmill/shared";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { MOCK_DOWN_HOST, MOCK_ROBOTS_BLOCKED_HOST, mockPageFor } from "./fixtures/pages";
import { WEB_KEY, WEB_RATE_LIMITS, webTools } from "./tools";

export const webMock = buildMockConnector({
  key: WEB_KEY,
  displayName: "Public web pages",
  phase: 1,
  auth: { kind: "none" },
  tools: webTools,
  rateLimits: WEB_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    fetch: async ({ url, maxChars }) => {
      const u = new URL(url);
      if (u.hostname === MOCK_ROBOTS_BLOCKED_HOST) throw new AppError("robots_disallowed", `${u.host}'s robots.txt does not allow reading this page`, 403);
      if (u.hostname === MOCK_DOWN_HOST) throw new AppError("unreachable", `${u.host} could not be reached`, 502);
      const page = mockPageFor(u);
      const text = page.paragraphs.join("\n\n");
      return { url, finalUrl: u.toString(), status: 200, contentType: "text/html; charset=utf-8", title: page.title, description: page.description, text: text.slice(0, maxChars), truncated: text.length > maxChars, fetchedAt: MOCK_NOW.toISOString(), robots: "allowed" as const };
    },
  },
  connect: async (businessId) => mockIntegrationRecord(WEB_KEY, businessId, { accountLabel: "Public web pages (mock)" }),
  healthcheck: async () => mockHealth(WEB_KEY),
});
