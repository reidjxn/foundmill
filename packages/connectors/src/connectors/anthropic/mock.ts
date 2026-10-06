import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, simulate } from "../../mock-utils";
import { ANTHROPIC_MODEL_FIXTURES } from "./fixtures/models";
import { routedModelReport, toModelInfo } from "./shared";
import { ANTHROPIC_KEY, ANTHROPIC_RATE_LIMITS, anthropicTools } from "./tools";

/** A BYOK key is "valid" in mock mode when it looks like an Anthropic key and is not marked invalid. */
export const mockKeyLooksValid = (key: string | undefined): boolean => key === undefined || (/^sk-ant-/.test(key) && !/invalid|revoked|expired/i.test(key));

export const anthropicMock = buildMockConnector({
  key: ANTHROPIC_KEY,
  displayName: "Anthropic",
  phase: 1,
  auth: { kind: "api_key" },
  tools: anthropicTools,
  rateLimits: ANTHROPIC_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    list_models: async ({ limit }) => ({ models: ANTHROPIC_MODEL_FIXTURES.slice(0, limit).map(toModelInfo), hasMore: ANTHROPIC_MODEL_FIXTURES.length > limit }),
    get_model: async ({ modelId }) => {
      const m = ANTHROPIC_MODEL_FIXTURES.find((x) => x.id === modelId);
      if (!m) throw Object.assign(new Error(`model ${modelId} not found`), { status: 404 });
      return toModelInfo(m);
    },
    validate_key: async (_args, ctx) => {
      const valid = mockKeyLooksValid(ctx.credential?.secret);
      const available = new Set(valid ? ANTHROPIC_MODEL_FIXTURES.map((m) => m.id) : []);
      return { valid, reason: valid ? null : "Anthropic rejected the key (401 authentication_error)", routedModels: routedModelReport(available), checkedAt: MOCK_NOW.toISOString() };
    },
  },
  connect: async (businessId) => mockIntegrationRecord(ANTHROPIC_KEY, businessId, { accountLabel: "Anthropic (BYOK, mock)", scopes: ["models:read", "messages:write"] }),
  healthcheck: async () => mockHealth(ANTHROPIC_KEY, { models: ANTHROPIC_MODEL_FIXTURES.length }),
  simulations: {
    "credential.expiry": (params) => simulate("credential.expiry", { ...params, connectorKey: ANTHROPIC_KEY }),
  },
});
