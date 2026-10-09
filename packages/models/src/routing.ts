/**
 * Model routing — the ONLY place model ids live (BUILD §2.1 rule 8, §10.1).
 * Verified against Anthropic's model list on 2026-10-05 (docs/DECISIONS.md).
 */
export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];
export type ModelKey = keyof typeof MODELS;

export const ROUTES = {
  inboxComposer: { model: "opus", locked: true }, // Inbox always Opus
  planCompiler: { model: "opus", locked: true },
  chiefOfStaff: { model: "opus", warnOnDowngrade: true },
  departmentLead: { model: "opus" },
  planner: { model: "opus" },
  codeReview: { model: "opus" },
  ideation: { model: "opus" },
  logoDesigner: { model: "opus" }, // business logo marks as SVG (Commit screen, Settings › Business)
  skillGrader: { model: "opus" },
  coach: { model: "opus" },
  worker: { model: "sonnet" },
  journeyCommentary: { model: "sonnet" },
  nightlyBatch: { model: "sonnet", batch: true },
  linker: { model: "haiku" },
  classifier: { model: "haiku" },
  categoriser: { model: "haiku" },
  quarantinedReader: { model: "haiku" },
  moderation: { model: "haiku" },
} as const;
export type RouteKey = keyof typeof ROUTES;

export type RouteResolution = {
  route: RouteKey;
  modelKey: ModelKey;
  modelId: ModelId;
  locked: boolean;
  warning?: string;
  batch: boolean;
};

const RANK: Record<ModelKey, number> = { haiku: 0, sonnet: 1, opus: 2 };

/** Resolve the model for a route, honouring locks and downgrade warnings (BUILD §10.1, §11.10 "Model selection"). */
export function resolveModel(route: RouteKey, override?: ModelKey): RouteResolution {
  const def = ROUTES[route] as { model: ModelKey; locked?: boolean; warnOnDowngrade?: boolean; batch?: boolean };
  const locked = def.locked === true;
  let modelKey: ModelKey = def.model;
  let warning: string | undefined;
  if (override && override !== def.model) {
    if (locked) {
      warning = `Route "${route}" is locked to ${def.model}; override "${override}" ignored.`;
    } else {
      modelKey = override;
      if (def.warnOnDowngrade && RANK[override] < RANK[def.model]) {
        warning = `Downgrading "${route}" from ${def.model} to ${override} reduces quality of planning and routing.`;
      }
    }
  }
  return { route, modelKey, modelId: MODELS[modelKey], locked, warning, batch: def.batch === true };
}
