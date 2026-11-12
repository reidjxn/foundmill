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
 * - `maxTokens` → `max_tokens` for a call that sends none (a request's own `maxTokens` wins). Opus 5.5 and Sonnet 5.5
 *   always think, and the thinking counts toward `max_tokens`, so a thinking route's budget is the reply plus the
 *   thinking at the route's effort: `THINKING_MAX_TOKENS` at the API default effort (Opus `medium`, Sonnet `high`),
 *   `LOW_EFFORT_MAX_TOKENS` at `low` (a route the founder waits on may keep the thinking ceiling at `low`: the budget is only
 *   a cap, and a cut-off graph costs a retry). Haiku 4.5 does not think unless asked, so its routes keep `PLAIN_MAX_TOKENS`. An
 *   override onto a thinking model never runs below that model's floor (a classifier moved to Opus still has room to
 *   think). Both thinking budgets stay well inside a non-streaming call's time limit.
 */
import type { Effort, Speed } from "./types";

export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];
export type ModelKey = keyof typeof MODELS;

/**
 * Image models (the other half of "model ids live only here"). Verified against OpenAI's docs on 2026-10-22: gpt-image-1
 * is deprecated (shutdown 2026-10-23) and gpt-image-2.5-flare is its fast, everyday replacement. Called only by the
 * gateway's `openai_images` connector; never routed through the Claude client or priced in the usage ledger.
 */
export const IMAGE_MODELS = {
  /** The AI-generated faces of anthropomorphic agents: one 1024 px portrait per persona catalog key (at most 240 ever). */
  portrait_image: "gpt-image-2.5-flare",
} as const;
export type ImageModelKey = keyof typeof IMAGE_MODELS;
export type ImageModelId = (typeof IMAGE_MODELS)[ImageModelKey];

/**
 * Speech models for Team call (docs/TEAM_CALL.md §3). Verified against ElevenLabs' model docs on 2026-11-12: Flash v2.5
 * is the lower-cost real-time text-to-speech model (~100 ms median latency, 40,000 characters a request), Scribe v3 the
 * batch transcription model (successor to Scribe v2). Called only by the gateway's `elevenlabs` connector; never routed
 * through the Claude client.
 */
export const SPEECH_MODELS = {
  /** An agent's spoken turn on a call. */
  call_speech: "eleven_flash_v2_5",
  /** What the founder said on a call, transcribed. */
  call_transcription: "scribe_v3",
} as const;
export type SpeechModelKey = keyof typeof SPEECH_MODELS;

/**
 * Older models a real Anthropic account still lists. Nothing routes to them; the mock `list_models` tool reports them
 * as not routed, so an agent reading the list sees what a live account shows.
 */
export const LISTED_UNROUTED_MODELS = [
  { id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", createdAt: "2025-09-29T00:00:00Z" },
  { id: "claude-opus-4-1-20250805", displayName: "Claude Opus 4.1", createdAt: "2025-08-05T00:00:00Z" },
] as const;

/** What each model accepts (Anthropic model docs, 2026-10-09): Haiku 4.5 has no `effort`; fast mode is Opus only. */
export const MODEL_CAPABILITIES: Record<ModelKey, { effort: boolean; fastMode: boolean }> = {
  opus: { effort: true, fastMode: true },
  sonnet: { effort: true, fastMode: false },
  haiku: { effort: false, fastMode: false },
};

/** Beta header for Opus fast mode (Claude API only; not Bedrock, Vertex or Foundry). */
export const FAST_MODE_BETA = "fast-mode-2026-02-01";

/**
 * Models that always think (Opus 5.5 and Sonnet 5.5: adaptive thinking cannot be turned off, and it counts toward
 * `max_tokens`). Haiku 4.5 only thinks when a budget is sent, which this platform never does.
 */
export const ALWAYS_THINKS: Record<ModelKey, boolean> = { opus: true, sonnet: true, haiku: false };

/**
 * `max_tokens` budgets (audit CML-03). A planner graph of 15 tasks, 15 scored channels or six jurisdiction cards is
 * 1.5k–3.5k tokens of JSON written after the thinking, so the default-effort budget leaves room for both; the low-effort
 * budget matches what the first-draft callers size for themselves (3k–8k).
 */
export const THINKING_MAX_TOKENS = 16_000;
export const LOW_EFFORT_MAX_TOKENS = 8_000;
export const PLAIN_MAX_TOKENS = 4_096;

export interface RouteDefinition {
  model: ModelKey;
  locked?: boolean;
  warnOnDowngrade?: boolean;
  batch?: boolean;
  effort?: Effort;
  speed?: Extract<Speed, "fast">;
  /** `max_tokens` when the request sends none: the reply plus the thinking at the route's effort (header). */
  maxTokens: number;
}

export const ROUTES = {
  // Inbox always Opus. The Inbox notes, the plan compiler, the Planner and the leads' Recommend answers run at low effort
  // (founder, 2026-10-15: speed over the medium-effort default); the budgets stay at the thinking ceiling because
  // `max_tokens` is only a cap, and a 15-task graph must never be cut short.
  inboxComposer: { model: "opus", locked: true, effort: "low", maxTokens: THINKING_MAX_TOKENS },
  planCompiler: { model: "opus", locked: true, effort: "low", maxTokens: THINKING_MAX_TOKENS },
  chiefOfStaff: { model: "opus", warnOnDowngrade: true, maxTokens: THINKING_MAX_TOKENS },
  departmentLead: { model: "opus", maxTokens: THINKING_MAX_TOKENS },
  // Distribution's channel scores and Legal's jurisdiction cards: answers the founder waits on behind a Recommend button.
  leadRecommendation: { model: "opus", effort: "low", maxTokens: THINKING_MAX_TOKENS },
  planner: { model: "opus", effort: "low", maxTokens: THINKING_MAX_TOKENS },
  codeReview: { model: "opus", maxTokens: THINKING_MAX_TOKENS },
  // Concept cards, compare and the card Q&A (Ideation Studio): first drafts the founder waits on.
  ideation: { model: "opus", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // A short slate of names and angles drafted before the cards are written in parallel (audit P2).
  ideationSlate: { model: "opus", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  logoDesigner: { model: "opus", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS }, // business logo marks as SVG (Commit screen, Settings › Business)
  // Vision, first specification and first roadmap, drafted once when a new business is first opened (BUILD §11.1, §11.5).
  foundations: { model: "opus", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The vision and a one-line thesis per section, drafted first so sections can be written in parallel (audit P3).
  foundationsSkeleton: { model: "opus", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  skillGrader: { model: "opus", maxTokens: THINKING_MAX_TOKENS },
  coach: { model: "opus", maxTokens: THINKING_MAX_TOKENS },
  worker: { model: "sonnet", maxTokens: THINKING_MAX_TOKENS },
  journeyCommentary: { model: "sonnet", maxTokens: THINKING_MAX_TOKENS },
  nightlyBatch: { model: "sonnet", batch: true, maxTokens: THINKING_MAX_TOKENS },
  linker: { model: "haiku", maxTokens: PLAIN_MAX_TOKENS },
  classifier: { model: "haiku", maxTokens: PLAIN_MAX_TOKENS },
  categoriser: { model: "haiku", maxTokens: PLAIN_MAX_TOKENS },
  quarantinedReader: { model: "haiku", maxTokens: PLAIN_MAX_TOKENS },
  moderation: { model: "haiku", maxTokens: PLAIN_MAX_TOKENS },
  // A task's title in the founder's words (ten words, no engineering terms): a short rewrite of a short text, batched.
  founderTitle: { model: "haiku", maxTokens: PLAIN_MAX_TOKENS },
  // Talking to an agent at their desk (audit-conversation §4): 1–3 short bubbles and 2–4 quick replies the founder waits
  // on, so Sonnet at low effort (founder, 2026-10-15: replies in seconds over Opus's nuance); callers cache the system
  // prompt (house rules + instructions) and size max_tokens for the reply (~700 tokens) plus the thinking Sonnet 5.5
  // always does, which counts toward max_tokens.
  conversation: { model: "sonnet", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The founder's "Change it" words on the Chief of Staff's goal (founder, 2026-11-07): the model picks only the kind, the
  // target and the date (packages/shared writes every word the founder reads), so Sonnet at low effort answers in seconds.
  goalProposal: { model: "sonnet", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // A new project's public page, drafted first after commit from the founder's own words (package 1.2): one short page
  // (a pitch, a few paragraphs, who it is for) that mostly keeps the founder's text, on the path before the vision.
  // Sonnet at low effort writes it in seconds and holds to "keep their words, invent nothing"; Opus would add cost and
  // wait for no gain on a page this short. Any failure falls back to the deterministic starter draft.
  projectPage: { model: "sonnet", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // Team call (docs/TEAM_CALL.md §4): the next one to four spoken turns of a call. The founder is listening and waiting,
  // so Sonnet at low effort, like a reply at the desk; turns are short spoken sentences.
  teamCallTurn: { model: "sonnet", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The call's summary and its action items as typed plan actions, written once when the call ends: Opus, which the
  // plan compiler also uses, because a wrong action files real work.
  teamCallWrapUp: { model: "opus", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
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
  /** `max_tokens` for a request that sends none: the route's budget, raised to the resolved model's thinking floor. */
  maxTokens: number;
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
  const effort = def.effort && caps.effort ? def.effort : undefined;
  const resolution: RouteResolution = { route, modelKey, modelId: MODELS[modelKey], locked, warning, batch: def.batch === true, maxTokens: maxTokensFor(def.maxTokens, modelKey, effort) };
  if (effort) resolution.effort = effort;
  if (def.speed === "fast" && caps.fastMode) resolution.speed = "fast";
  return resolution;
}

/**
 * The `max_tokens` a call runs with when it sends none: the route's budget, never below the thinking floor of the model
 * that serves it at that effort (a request's own `effort` is applied by the client and does not move this default).
 */
export function maxTokensFor(routeBudget: number, modelKey: ModelKey, effort?: Effort): number {
  if (!ALWAYS_THINKS[modelKey]) return routeBudget;
  return Math.max(routeBudget, effort === "low" ? LOW_EFFORT_MAX_TOKENS : THINKING_MAX_TOKENS);
}
