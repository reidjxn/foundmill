/** Live Voyage AI connector over the official `voyageai` SDK (0.4). Platform key only (embeddings are a platform cost). */
import { VoyageAIClient } from "voyageai";
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { voyageMock } from "./mock";
import { DEFAULT_VOYAGE_MODEL, estimateCostMinor, estimateTokens, VOYAGE_KEY, VOYAGE_MODELS, VOYAGE_RATE_LIMITS, voyageTools } from "./tools";

export function createVoyageConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const client = (): VoyageAIClient => {
    if (!secrets.voyageApiKey) throw new ConfigError(VOYAGE_KEY, "VOYAGE_API_KEY");
    return new VoyageAIClient({ apiKey: secrets.voyageApiKey, fetch, maxRetries: 1, timeoutInSeconds: 30 });
  };

  return buildLiveConnector(
    {
      key: VOYAGE_KEY,
      displayName: "Voyage AI",
      phase: 1,
      auth: { kind: "api_key", platformKey: true },
      tools: voyageTools,
      rateLimits: VOYAGE_RATE_LIMITS,
      now,
      handlers: {
        embed: async ({ input, model, inputType, outputDimension }) => {
          const res = await client().embed({ input, model, inputType, outputDimension });
          const embeddings = (res.data ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding ?? []);
          if (embeddings.length !== input.length) throw new Error(`Voyage returned ${embeddings.length} vectors for ${input.length} inputs`);
          const totalTokens = res.usage?.totalTokens ?? estimateTokens(input);
          return { model: res.model ?? model, dimension: outputDimension, embeddings, totalTokens, costEstimateMinor: estimateCostMinor(model, totalTokens) };
        },
        list_models: async () => ({ models: VOYAGE_MODELS.map((m) => ({ ...m, dimensions: [...m.dimensions] })) }),
      },
      connect: async (businessId) => {
        await client().embed({ input: "ping", model: DEFAULT_VOYAGE_MODEL });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: VOYAGE_KEY, status: "connected", scopes: [], accountLabel: "Voyage (platform)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          await client().embed({ input: "ping", model: DEFAULT_VOYAGE_MODEL, outputDimension: 256 });
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { message: e instanceof Error ? e.message : String(e), now });
        }
      },
    },
    voyageMock,
  );
}

export { voyageMock } from "./mock";
export { voyageTools, VOYAGE_KEY } from "./tools";
