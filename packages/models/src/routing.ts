/**
 * Model routing — the ONLY place model ids and per-route model settings live (BUILD §2.1 rule 8, §10.1).
 * Verified against Anthropic's model list on 2026-10-05 (docs/DECISIONS.md).
 *
 * Per-route settings, applied by the client to every call on the route (a request's own `effort` wins):
 * - `effort` → `output_config.effort`. Opus 5.5 always thinks (adaptive) and defaults to `medium`; `low` cuts the
 *   thinking prelude before the first token, which is what a founder waits on for a first draft. Routes without
 *   `effort` keep the API default. Dropped on a model without the parameter (Haiku 4.5).
 * - `speed: "fast"` → Opus fast mode (beta `fast-mode-2026-02-01`, top-level `speed: "fast"`, up to 2.5× output speed at
 *   2× the price). Honoured only when MODEL_FAST_MODE is on, so it costs nothing until someone opts in.
 */
import type { Effort, Speed } from "./types";

export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];
export type ModelKey = keyof typeof MODELS;

/** What each model accepts (Anthropic model docs, 2026-10-09): Haiku 4.5 has no `effort`; fast mode is Opus only. */
export const MODEL_CAPABILITIES: Record<ModelKey, { effort: boolean; fastMode: boolean }> = {
  opus: { effort: true, fastMode: true },
  sonnet: { effort: true, fastMode: false },
  haiku: { effort: false, fastMode: false },
};

/** Beta header for Opus fast mode (Claude API only; not Bedrock, Vertex or Foundry). */
export const FAST_MODE_BETA = "fast-mode-2026-02-01";

export interface RouteDefinition {
  model: ModelKey;
  locked?: boolean;
  warnOnDowngrade?: boolean;
  batch?: boolean;
  effort?: Effort;
  speed?: Extract<Speed, "fast">;
}

export const ROUTES = {
  inboxComposer: { model: "opus", locked: true }, // Inbox always Opus
  planCompiler: { model: "opus", locked: true },
  chiefOfStaff: { model: "opus", warnOnDowngrade: true },
  departmentLead: { model: "opus" },
  planner: { model: "opus" },
  codeReview: { model: "opus" },
  // Concept cards, compare and the card Q&A (Ideation Studio): first drafts the founder waits on.
  ideation: { model: "opus", effort: "low", speed: "fast" },
  // A short slate of names and angles drafted before the cards are written in parallel (audit P2).
  ideationSlate: { model: "opus", effort: "low", speed: "fast" },
  logoDesigner: { model: "opus", effort: "low", speed: "fast" }, // business logo marks as SVG (Commit screen, Settings › Business)
  // Vision, first specification and first roadmap, drafted once when a new business is first opened (BUILD §11.1, §11.5).
  foundations: { model: "opus", effort: "low", speed: "fast" },
  // The vision and a one-line thesis per section, drafted first so sections can be written in parallel (audit P3).
  foundationsSkeleton: { model: "opus", effort: "low", speed: "fast" },
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
  // Talking to an agent at their desk (audit-conversation §4): 1–3 short bubbles and 2–4 quick replies the founder waits
  // on, so Opus at low effort; callers cap max_tokens (~700) and cache the system prompt (house rules + instructions).
  conversation: { model: "opus", effort: "low" },
} as const satisfies Record<string, RouteDefinition>;
export type RouteKey = keyof typeof ROUTES;

export type RouteResolution = {
  route: RouteKey;
  modelKey: ModelKey;
  modelId: ModelId;
  locked: boolean;
  warning?: string;
  batch: boolean;
  /** The route's effort, when it sets one and the resolved model accepts it. */
  effort?: Effort;
  /** `fast` when the route asks for fast mode and the resolved model has it (the client still needs MODEL_FAST_MODE). */
  speed?: Extract<Speed, "fast">;
};

const RANK: Record<ModelKey, number> = { haiku: 0, sonnet: 1, opus: 2 };

/** A model key as a founder reads it in a warning ("opus" → "Opus"); never the route's internal name. */
function modelWord(key: ModelKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Resolve the model for a route, honouring locks and downgrade warnings (BUILD §10.1, §11.10 "Model selection"). */
export function resolveModel(route: RouteKey, override?: ModelKey): RouteResolution {
  const def: RouteDefinition = ROUTES[route];
  const locked = def.locked === true;
  let modelKey: ModelKey = def.model;
  let warning: string | undefined;
  if (override && override !== def.model) {
    if (locked) {
      warning = `This work is locked to ${modelWord(def.model)}, so ${modelWord(override)} is not used for it.`;
    } else {
      modelKey = override;
      if (def.warnOnDowngrade && RANK[override] < RANK[def.model]) {
        warning = `Moving from ${modelWord(def.model)} to ${modelWord(override)} lowers the quality of planning and routing.`;
      }
    }
  }
  const caps = MODEL_CAPABILITIES[modelKey];
  const resolution: RouteResolution = { route, modelKey, modelId: MODELS[modelKey], locked, warning, batch: def.batch === true };
  if (def.effort && caps.effort) resolution.effort = def.effort;
  if (def.speed === "fast" && caps.fastMode) resolution.speed = "fast";
  return resolution;
}
