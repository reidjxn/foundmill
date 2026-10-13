import { buildMockConnector } from "../../define";
import { deterministicEmbedding, MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { estimateCostMinor, estimateTokens, VOYAGE_KEY, VOYAGE_MODELS, VOYAGE_RATE_LIMITS, voyageTools } from "./tools";

export const voyageMock = buildMockConnector({
  key: VOYAGE_KEY,
  displayName: "Voyage AI",
  phase: 1,
  auth: { kind: "api_key", platformKey: true },
  tools: voyageTools,
  rateLimits: VOYAGE_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    embed: async ({ input, model, outputDimension }) => {
      const totalTokens = estimateTokens(input);
      return { model, dimension: outputDimension, embeddings: input.map((text) => deterministicEmbedding(`${model}:${text}`, outputDimension)), totalTokens, costEstimateMinor: estimateCostMinor(model, totalTokens) };
    },
    list_models: async () => ({ models: VOYAGE_MODELS.map((m) => ({ ...m, dimensions: [...m.dimensions] })) }),
  },
  connect: async (businessId) => mockIntegrationRecord(VOYAGE_KEY, businessId, { accountLabel: "Voyage (platform, mock)" }),
  healthcheck: async () => mockHealth(VOYAGE_KEY),
});
