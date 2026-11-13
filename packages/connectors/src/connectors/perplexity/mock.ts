import { PANEL_MODELS } from "@foundmill/models/routing";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, simulate } from "../../mock-utils";
import { PERPLEXITY_FIXTURE_CITATIONS } from "./fixtures/panel";
import { PERPLEXITY_CONNECT_FIELDS, PERPLEXITY_KEY, PERPLEXITY_RATE_LIMITS, perplexityTools } from "./tools";

export const perplexityMock = buildMockConnector({
  key: PERPLEXITY_KEY,
  displayName: "Perplexity",
  phase: 3,
  auth: { kind: "api_key" },
  tools: perplexityTools,
  rateLimits: PERPLEXITY_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    ask_panel: async ({ question }) => ({
      question,
      answer: `This is a mock answer, not a real Perplexity reply. For "${question}" a real answer would list a few options and the sources it drew on.`,
      citations: PERPLEXITY_FIXTURE_CITATIONS.map((c) => ({ ...c })),
      model: PANEL_MODELS.perplexity,
    }),
  },
  connectFields: PERPLEXITY_CONNECT_FIELDS,
  connect: async (businessId) => mockIntegrationRecord(PERPLEXITY_KEY, businessId, { accountLabel: "Perplexity (your own key, mock)", scopes: ["agent:write"] }),
  healthcheck: async () => mockHealth(PERPLEXITY_KEY, { model: PANEL_MODELS.perplexity }),
  simulations: {
    "credential.expiry": (params) => simulate("credential.expiry", { ...params, connectorKey: PERPLEXITY_KEY }),
  },
});
