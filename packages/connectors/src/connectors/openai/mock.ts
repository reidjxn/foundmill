import { PANEL_MODELS } from "@foundmill/models/routing";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, simulate } from "../../mock-utils";
import { OPENAI_FIXTURE_CITATIONS } from "./fixtures/panel";
import { OPENAI_KEY, OPENAI_CONNECT_FIELDS, OPENAI_RATE_LIMITS, openaiTools } from "./tools";

export const openaiMock = buildMockConnector({
  key: OPENAI_KEY,
  displayName: "OpenAI",
  phase: 3,
  auth: { kind: "api_key" },
  tools: openaiTools,
  rateLimits: OPENAI_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    ask_panel: async ({ question }) => ({
      question,
      answer: `This is a mock answer, not a real ChatGPT reply. For "${question}" a real answer would list a few options and the pages it drew on.`,
      citations: OPENAI_FIXTURE_CITATIONS.map((c) => ({ ...c })),
      model: PANEL_MODELS.openai,
    }),
  },
  connectFields: OPENAI_CONNECT_FIELDS,
  connect: async (businessId) => mockIntegrationRecord(OPENAI_KEY, businessId, { accountLabel: "OpenAI (your own key, mock)", scopes: ["responses:write"] }),
  healthcheck: async () => mockHealth(OPENAI_KEY, { model: PANEL_MODELS.openai }),
  simulations: {
    "credential.expiry": (params) => simulate("credential.expiry", { ...params, connectorKey: OPENAI_KEY }),
  },
});
