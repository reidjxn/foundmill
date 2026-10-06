/** Voyage AI embeddings for the entity linker and search (docs/ARCHITECTURE.md §1). */
import { z } from "zod";
import { defineTool } from "../../define";

export const VOYAGE_KEY = "voyage";
export const DEFAULT_VOYAGE_MODEL = "voyage-3.5";
export const VOYAGE_DIMENSIONS = [256, 512, 1024, 2048] as const;

export const VOYAGE_MODELS = [
  { id: "voyage-3.5", dimensions: [...VOYAGE_DIMENSIONS], contextLength: 32_000, pricePerMillionTokensMinor: 6 },
  { id: "voyage-3.5-lite", dimensions: [...VOYAGE_DIMENSIONS], contextLength: 32_000, pricePerMillionTokensMinor: 2 },
  { id: "voyage-3-large", dimensions: [...VOYAGE_DIMENSIONS], contextLength: 32_000, pricePerMillionTokensMinor: 18 },
  { id: "voyage-code-3", dimensions: [...VOYAGE_DIMENSIONS], contextLength: 32_000, pricePerMillionTokensMinor: 18 },
] as const;

/** Rough token estimate (≈ 4 characters per token) used for cost metering before the vendor answers. */
export const estimateTokens = (texts: readonly string[]): number => Math.max(1, Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4));

export function estimateCostMinor(model: string, tokens: number): number {
  const price = VOYAGE_MODELS.find((m) => m.id === model)?.pricePerMillionTokensMinor ?? 6;
  return Math.ceil((tokens * price) / 1_000_000);
}

export const EmbedInput = z.object({
  input: z.array(z.string().min(1).max(32_000)).min(1).max(128),
  model: z.string().default(DEFAULT_VOYAGE_MODEL),
  inputType: z.enum(["query", "document"]).optional(),
  outputDimension: z.union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048)]).default(1024),
});

export const voyageTools = [
  defineTool({
    name: "embed",
    description: "Embed up to 128 texts with a Voyage model. Returns one vector per input, in order; vectors are unit length.",
    input: EmbedInput,
    output: z.object({ model: z.string(), dimension: z.number().int(), embeddings: z.array(z.array(z.number())), totalTokens: z.number().int(), costEstimateMinor: z.number().int() }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
    costMinor: (args) => estimateCostMinor(args.model, estimateTokens(args.input)),
  }),
  defineTool({
    name: "list_models",
    description: "Voyage embedding models this platform supports, with dimensions and estimated price per million tokens (estimate).",
    input: z.object({}),
    output: z.object({ models: z.array(z.object({ id: z.string(), dimensions: z.array(z.number().int()), contextLength: z.number().int(), pricePerMillionTokensMinor: z.number().int() })) }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }),
] as const;

export const VOYAGE_RATE_LIMITS = { perMinute: 300, perDay: 100_000 };
