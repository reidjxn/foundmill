import { MODELS, MODEL_PROVIDER } from "@foundmill/models/routing";
import type { z } from "zod";
import type { ModelInfoOut } from "./tools";

/** The routed models Anthropic serves: a founder's Anthropic key is checked against these, never against GLM (Z.ai). */
const ANTHROPIC_MODELS = (Object.entries(MODELS) as [keyof typeof MODELS, string][]).filter(([key]) => MODEL_PROVIDER[key] === "anthropic");

export const ROUTED_MODEL_IDS = new Set<string>(ANTHROPIC_MODELS.map(([, id]) => id));

export const toModelInfo = (m: { id: string; display_name: string; created_at: string }): z.infer<typeof ModelInfoOut> => ({
  id: m.id,
  displayName: m.display_name,
  createdAt: m.created_at,
  routed: ROUTED_MODEL_IDS.has(m.id),
});

export const routedModelReport = (available: ReadonlySet<string>) =>
  ANTHROPIC_MODELS.map(([key, modelId]) => ({ key, modelId, available: available.has(modelId) }));
