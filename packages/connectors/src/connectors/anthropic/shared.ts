import { MODELS } from "@founder-manager/models/routing";
import type { z } from "zod";
import type { ModelInfoOut } from "./tools";

export const ROUTED_MODEL_IDS = new Set<string>(Object.values(MODELS));

export const toModelInfo = (m: { id: string; display_name: string; created_at: string }): z.infer<typeof ModelInfoOut> => ({
  id: m.id,
  displayName: m.display_name,
  createdAt: m.created_at,
  routed: ROUTED_MODEL_IDS.has(m.id),
});

export const routedModelReport = (available: ReadonlySet<string>) =>
  (Object.entries(MODELS) as [keyof typeof MODELS, string][]).map(([key, modelId]) => ({ key, modelId, available: available.has(modelId) }));
