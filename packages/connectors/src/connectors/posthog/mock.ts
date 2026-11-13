import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { mapQuery, POSTHOG_KEY, POSTHOG_RATE_LIMITS, posthogTools, prepareQuery, type QueryInsightsOutput } from "./tools";

export const MOCK_NOTICE = "Simulated: this table is fixture data, not your PostHog project's analytics. Nothing was read from PostHog.";

const DAY_MS = 86_400_000;
const isoDay = (daysBack: number) => new Date(MOCK_NOW.getTime() - daysBack * DAY_MS).toISOString().slice(0, 10);

/** Deterministic tables for a few query shapes, and a small generic table for the rest. */
export function mockTable(sql: string): { columns: string[]; results: unknown[][] } {
  const q = sql.toLowerCase();
  if (/signup|sign_up|signed_up/.test(q)) {
    return { columns: ["source", "signups"], results: [["newsletter", 18], ["google", 11], ["instagram", 7], ["direct", 5], ["producthunt", 2]] };
  }
  if (/\$current_url|pathname|\$pathname/.test(q)) {
    return { columns: ["pathname", "views"], results: [["/", 214], ["/products/barrier-cream", 96], ["/refill", 58], ["/about", 31], ["/blog/dry-skin-guide", 27]] };
  }
  if (/\$pageview|pageview/.test(q) && /todate|tostartofday|day/.test(q)) {
    return { columns: ["day", "pageviews"], results: Array.from({ length: 7 }, (_, i) => [isoDay(6 - i), 30 + (Number.parseInt(stableHash(["pv", i], 4), 16) % 40)]) };
  }
  return { columns: ["event", "count"], results: [["$pageview", 312], ["signed_up", 43], ["purchase", 6]] };
}

export function mockQuery(query: string): QueryInsightsOutput {
  const { sql, limit } = prepareQuery(query);
  const out = mapQuery(mockTable(sql), limit);
  if (!out) throw new Error("mock table has no rows");
  return { ...out, simulated: true as const, notice: MOCK_NOTICE };
}

export const posthogMock = buildMockConnector({
  key: POSTHOG_KEY,
  displayName: "PostHog",
  phase: 2,
  auth: { kind: "api_key" },
  tools: posthogTools,
  rateLimits: POSTHOG_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    query_insights: async ({ query }) => mockQuery(query),
  },
  connect: async (businessId) => mockIntegrationRecord(POSTHOG_KEY, businessId, { accountLabel: "PostHog (mock)", config: { projectId: "12345", region: "us" } }),
  healthcheck: async () => mockHealth(POSTHOG_KEY, { region: "us", projectId: "12345" }),
});
