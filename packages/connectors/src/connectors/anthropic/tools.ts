/** Anthropic: model listing and BYOK key validation (BUILD §10.2). Completions live in packages/models. */
import { z } from "zod";
import { ModelKey } from "@foundmill/shared";
import { defineTool } from "../../define";

export const ModelInfoOut = z.object({
  id: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
  /** True when packages/models routes some work to this model id. */
  routed: z.boolean(),
});

export const anthropicTools = [
  defineTool({
    name: "list_models",
    description: "List the Anthropic models the configured key can use and flag the ones Founder Manager routes to (packages/models/src/routing.ts).",
    input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
    output: z.object({ models: z.array(ModelInfoOut), hasMore: z.boolean() }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }),
  defineTool({
    name: "get_model",
    description: "Fetch one Anthropic model by id (availability check for a route override).",
    input: z.object({ modelId: z.string().min(1).max(100) }),
    output: ModelInfoOut,
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }),
  defineTool({
    name: "validate_key",
    description: "Validate a bring-your-own Anthropic key (BUILD §10.2): the key is accepted and can see every routed model. The key comes from the call credential, never from arguments; nothing about it is returned.",
    input: z.object({}),
    output: z.object({
      valid: z.boolean(),
      reason: z.string().nullable(),
      routedModels: z.array(z.object({ key: ModelKey, modelId: z.string(), available: z.boolean() })),
      checkedAt: z.string(),
    }),
    hints: {},
    annotations: { readOnlyHint: true },
  }),
] as const;

export const ANTHROPIC_KEY = "anthropic";
export const ANTHROPIC_RATE_LIMITS = { perMinute: 50, perDay: 5_000 };
