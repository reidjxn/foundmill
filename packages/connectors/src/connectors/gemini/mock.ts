import { PANEL_MODELS } from "@foundmill/models/routing";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { mockPanelAnswer, PANEL_CITATIONS } from "./fixtures/panel";
import { GEMINI_CONNECT_FIELDS, GEMINI_KEY, GEMINI_RATE_LIMITS, geminiTools } from "./tools";

export const geminiMock = buildMockConnector({
  key: GEMINI_KEY,
  displayName: "Google Gemini",
  phase: 3,
  auth: { kind: "api_key" },
  connectFields: GEMINI_CONNECT_FIELDS,
  tools: geminiTools,
  rateLimits: GEMINI_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    ask_panel: async ({ question }) => ({ question, answer: mockPanelAnswer(question), citations: PANEL_CITATIONS.map((c) => ({ ...c })), model: PANEL_MODELS.gemini }),
  },
  connect: async (businessId) => mockIntegrationRecord(GEMINI_KEY, businessId, { accountLabel: "Google Gemini (your own key, mock)", scopes: ["generate"] }),
  healthcheck: async () => mockHealth(GEMINI_KEY, { model: PANEL_MODELS.gemini }),
});
