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
  /**
   * Haiku 5.5 (WP-09 T4, taken into WP-13): also every call an account not on a paid plan makes outside agent sessions,
   * on Foundmill's key (founder, Nov 16, 2026; `resolveModel(..., { freePlan: true })`).
   */
  haiku: "claude-haiku-5-5",
  /**
   * GLM-5.3 Flash (Z.ai, MIT-licensed weights): the agent sessions of an account not on a paid plan (founder, Nov 16,
   * 2026; docs/holistic-plan/WP-13-free-plan-on-glm.md), served by Z.ai's Anthropic-compatible endpoint
   * (`MODEL_ENDPOINTS`). No other call reaches it.
   */
  glm: "glm-5.3-flash",
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];
export type ModelKey = keyof typeof MODELS;

/** Who serves a model: Anthropic's API, or Z.ai's Anthropic-compatible endpoint (the same client and protocol). */
export type ModelProvider = "anthropic" | "zai";
export const MODEL_PROVIDER: Record<ModelKey, ModelProvider> = { opus: "anthropic", sonnet: "anthropic", haiku: "anthropic", glm: "zai" };

/**
 * The endpoint of each provider other than Anthropic's default. Z.ai takes its key as `Authorization: Bearer` (its
 * Claude Code guide's `ANTHROPIC_AUTH_TOKEN`; probed Nov 16, 2026, WP-13 T1).
 */
export const MODEL_ENDPOINTS = {
  zai: { baseURL: "https://api.z.ai/api/anthropic", auth: "bearer" },
} as const satisfies Record<Exclude<ModelProvider, "anthropic">, { baseURL: string; auth: "bearer" | "x-api-key" }>;

/** How people read each model's name (model dialogs, warnings). */
export const MODEL_DISPLAY_NAMES: Record<ModelKey, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", glm: "GLM-5.3 Flash" };

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
  /** A voiceover for a short post video, on the founder's own ElevenLabs key (the `elevenlabs_voice` connector). Multilingual v2: $0.08 per 1,000 characters on the API prices (Nov 13, 2026), 10,000 characters a request. */
  post_voiceover: "eleven_multilingual_v2",
} as const;
export type SpeechModelKey = keyof typeof SPEECH_MODELS;

/**
 * Video models (Runway, the `runway` connector of PR #109, on the house business's own key). Verified against Runway's
 * pricing guide on 2026-11-13: gen4_turbo makes a clip from a picture at 5 credits a second. Called only through the
 * gateway's `runway` tools; never routed through the Claude client.
 */
export const VIDEO_MODELS = {
  /** One clip per card of a showcase video (apps/api `services/showcase.ts`). */
  showcase_clip: "gen4_turbo",
} as const;
export type VideoModelKey = keyof typeof VIDEO_MODELS;

/**
 * Panel models: the other assistants a project's AI visibility is checked against (the `openai`, `gemini` and
 * `perplexity` connectors' `ask_panel`). Each runs on the founder's own key at that vendor, with the vendor's web search
 * on, so the answer is close to what a person asking that assistant reads. Verified against each vendor's docs on
 * 2026-11-12. Called only by the gateway's connectors; never routed through the Claude client.
 */
export const PANEL_MODELS = {
  openai: "gpt-6-astra",
  gemini: "gemini-3.8-flash",
  perplexity: "perplexity/sonar",
} as const;
export type PanelModelKey = keyof typeof PANEL_MODELS;

/**
 * Older models a real Anthropic account still lists. Nothing routes to them; the mock `list_models` tool reports them
 * as not routed, so an agent reading the list sees what a live account shows.
 */
export const LISTED_UNROUTED_MODELS = [
  { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", createdAt: "2025-10-01T00:00:00Z" },
  { id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", createdAt: "2025-09-29T00:00:00Z" },
  { id: "claude-opus-4-1-20250805", displayName: "Claude Opus 4.1", createdAt: "2025-08-05T00:00:00Z" },
] as const;

/**
 * What each model accepts. Anthropic's models (Anthropic's model reference, Nov 16, 2026): fast mode is Opus only;
 * Haiku 5.5 takes `effort` (default `medium`) and, like the 5.5 models, refuses sampling parameters. GLM-5.3 Flash on
 * Z.ai's compatible endpoint, probed Nov 16, 2026 (WP-13 T1): `effort` honored, `temperature` accepted.
 */
export interface ModelCapabilities {
  effort: boolean;
  fastMode: boolean;
  /** Sampling parameters (`temperature`). */
  temperature: boolean;
}
export const MODEL_CAPABILITIES: Record<ModelKey, ModelCapabilities> = {
  opus: { effort: true, fastMode: true, temperature: false },
  sonnet: { effort: true, fastMode: false, temperature: false },
  haiku: { effort: true, fastMode: false, temperature: false },
  glm: { effort: true, fastMode: false, temperature: true },
};

/** Beta header for Opus fast mode (Claude API only; not Bedrock, Vertex or Foundry). */
export const FAST_MODE_BETA = "fast-mode-2026-02-01";

/**
 * Models that think by default (Opus 5.5 and Sonnet 5.5: adaptive thinking cannot be turned off; Haiku 5.5 thinks
 * unless told not to, which this platform never does; GLM-5.3 Flash cannot turn it off), and the thinking counts toward
 * `max_tokens`.
 */
export const ALWAYS_THINKS: Record<ModelKey, boolean> = { opus: true, sonnet: true, haiku: true, glm: true };

/**
 * `max_tokens` budgets (audit CML-03). A planner graph of 15 tasks, 15 scored channels or six jurisdiction cards is
 * 1.5k–3.5k tokens of JSON written after the thinking, so the default-effort budget leaves room for both; the low-effort
 * budget matches what the first-draft callers size for themselves (3k–8k).
 */
export const THINKING_MAX_TOKENS = 16_000;
export const LOW_EFFORT_MAX_TOKENS = 8_000;
export const PLAIN_MAX_TOKENS = 4_096;

/**
 * What a route does when the business's credits are low (`creditsAreLow`, packages/config): `"keep"` keeps its model;
 * a model key is the lower-cost model it moves to. Every route says which, so a new route is classified when it is added.
 *
 * Kept (founder-facing or high-stakes): the Inbox notes and the plan compiler (locked; a plan files real work), the Chief
 * of Staff, replies at the desk, Team call, the goal in the founder's own words, the project's public page (outward),
 * code review (what reaches main), the leads' Recommend answers (Legal's jurisdiction cards, Distribution's spend
 * scores), Ideation (the founder's first look at a concept), and the Haiku utilities (already the lowest cost; two of
 * them are the quarantine and moderation).
 *
 * Moved (routine work: research, drafts, internal prep, planning): the leads' own cycle work, the Planner, foundations,
 * logo drafts, skill grading and coaching move from Opus to Sonnet; worker sessions, journey commentary and the
 * nightly batch move from Sonnet to Haiku. An agent session whose tools reach outside the business or spend money, or
 * whose template does money or legal work, keeps its route whatever this says (apps/orchestrator `prepareSession`).
 */
export type LowCreditsRoute = "keep" | ModelKey;

export interface RouteDefinition {
  model: ModelKey;
  /** Where routine work goes when credits are low; `"keep"` for founder-facing and high-stakes work (see `LowCreditsRoute`). */
  lowCredits: LowCreditsRoute;
  locked?: boolean;
  warnOnDowngrade?: boolean;
  batch?: boolean;
  effort?: Effort;
  speed?: Extract<Speed, "fast">;
  /** `max_tokens` when the request sends none: the reply plus the thinking at the route's effort (header). */
  maxTokens: number;
  /** The route may send images with a message (`ChatMessage.images`); the client refuses images on any other route. */
  vision?: boolean;
}

export const ROUTES = {
  // Inbox always Opus. The Inbox notes, the plan compiler, the Planner and the leads' Recommend answers run at low effort
  // (founder, 2026-10-15: speed over the medium-effort default); the budgets stay at the thinking ceiling because
  // `max_tokens` is only a cap, and a 15-task graph must never be cut short.
  inboxComposer: { model: "opus", lowCredits: "keep", locked: true, effort: "low", maxTokens: THINKING_MAX_TOKENS },
  planCompiler: { model: "opus", lowCredits: "keep", locked: true, effort: "low", maxTokens: THINKING_MAX_TOKENS },
  chiefOfStaff: { model: "opus", lowCredits: "keep", warnOnDowngrade: true, maxTokens: THINKING_MAX_TOKENS },
  departmentLead: { model: "opus", lowCredits: "sonnet", maxTokens: THINKING_MAX_TOKENS },
  // Distribution's channel scores and Legal's jurisdiction cards: answers the founder waits on behind a Recommend button.
  leadRecommendation: { model: "opus", lowCredits: "keep", effort: "low", maxTokens: THINKING_MAX_TOKENS },
  planner: { model: "opus", lowCredits: "sonnet", effort: "low", maxTokens: THINKING_MAX_TOKENS },
  codeReview: { model: "opus", lowCredits: "keep", maxTokens: THINKING_MAX_TOKENS },
  // The second read of a long document an agent drafted (the specification, the roadmap, policies, a pitch): a different
  // agent checks it for inconsistencies, unsupported claims, unlabeled figures and claims that need a source. Nobody
  // waits on it, so Opus at the default effort; the cost is bounded by the caller (packages/agents second-read.ts: two
  // rounds at most, the document cut to a fixed size, a few claims fact-checked), never by this budget.
  documentReview: { model: "opus", lowCredits: "keep", maxTokens: THINKING_MAX_TOKENS },
  // Concept cards, compare and the card Q&A (Ideation Studio): first drafts the founder waits on.
  ideation: { model: "opus", lowCredits: "keep", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // A short slate of names and angles drafted before the cards are written in parallel (audit P2).
  ideationSlate: { model: "opus", lowCredits: "keep", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  logoDesigner: { model: "opus", lowCredits: "sonnet", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS }, // business logo marks as SVG (Commit screen, Settings › Business)
  // Vision, first specification and first roadmap, drafted once when a new business is first opened (BUILD §11.1, §11.5).
  foundations: { model: "opus", lowCredits: "sonnet", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The vision and a one-line thesis per section, drafted first so sections can be written in parallel (audit P3).
  foundationsSkeleton: { model: "opus", lowCredits: "sonnet", effort: "low", speed: "fast", maxTokens: LOW_EFFORT_MAX_TOKENS },
  skillGrader: { model: "opus", lowCredits: "sonnet", maxTokens: THINKING_MAX_TOKENS },
  coach: { model: "opus", lowCredits: "sonnet", maxTokens: THINKING_MAX_TOKENS },
  worker: { model: "sonnet", lowCredits: "haiku", maxTokens: THINKING_MAX_TOKENS },
  journeyCommentary: { model: "sonnet", lowCredits: "haiku", maxTokens: THINKING_MAX_TOKENS },
  nightlyBatch: { model: "sonnet", lowCredits: "haiku", batch: true, maxTokens: THINKING_MAX_TOKENS },
  linker: { model: "haiku", lowCredits: "keep", maxTokens: PLAIN_MAX_TOKENS },
  classifier: { model: "haiku", lowCredits: "keep", maxTokens: PLAIN_MAX_TOKENS },
  categoriser: { model: "haiku", lowCredits: "keep", maxTokens: PLAIN_MAX_TOKENS },
  quarantinedReader: { model: "haiku", lowCredits: "keep", maxTokens: PLAIN_MAX_TOKENS },
  moderation: { model: "haiku", lowCredits: "keep", maxTokens: PLAIN_MAX_TOKENS },
  // A task's title in the founder's words (ten words, no engineering terms): a short rewrite of a short text, batched.
  founderTitle: { model: "haiku", lowCredits: "keep", maxTokens: PLAIN_MAX_TOKENS },
  // Talking to an agent at their desk (audit-conversation §4): 1–3 short bubbles and 2–4 quick replies the founder waits
  // on, so Sonnet at low effort (founder, 2026-10-15: replies in seconds over Opus's nuance); callers cache the system
  // prompt (house rules + instructions) and size max_tokens for the reply (~700 tokens) plus the thinking Sonnet 5.5
  // always does, which counts toward max_tokens.
  conversation: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The founder's "Change it" words on the Chief of Staff's goal (founder, 2026-11-07): the model picks only the kind, the
  // target and the date (packages/shared writes every word the founder reads), so Sonnet at low effort answers in seconds.
  goalProposal: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // A new project's public page, drafted first after commit from the founder's own words (package 1.2): one short page
  // (a pitch, a few paragraphs, who it is for) that mostly keeps the founder's text, on the path before the vision.
  // Sonnet at low effort writes it in seconds and holds to "keep their words, invent nothing"; Opus would add cost and
  // wait for no gain on a page this short. Any failure falls back to the deterministic starter draft.
  // Also the posts the social agent drafts for the founder to share by tap (docs/NETWORK.md F3, F7; packages/agents
  // `post-draft.ts`): the same kind of work (one or two sentences of public copy from the page's own words, nothing
  // invented), so it shares the route and its settings and is told apart in the usage ledger by its kind (`post_draft`).
  projectPage: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // Team call (docs/TEAM_CALL.md §4): the next one to four spoken turns of a call. The founder is listening and waiting,
  // so Sonnet at low effort, like a reply at the desk; turns are short spoken sentences.
  teamCallTurn: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The call's summary and its action items as typed plan actions, written once when the call ends: Opus, which the
  // plan compiler also uses, because a wrong action files real work.
  teamCallWrapUp: { model: "opus", lowCredits: "keep", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The design check (item 13): a separate reviewer looks at the screenshots of the pages a code agent changed in a
  // founder's project (desktop and 390 px) and returns a short ranked list of fixes. The only route that carries images;
  // Opus for taste, at low effort because it runs inside the agent's session, before the acceptance tests.
  designReview: { model: "opus", lowCredits: "keep", effort: "low", vision: true, maxTokens: LOW_EFFORT_MAX_TOKENS },
  // The gateway's `web.search_web` (WP-09 T3): one server web search (`web_search_20260209`, which the reference lists
  // for the Fable, Opus and Sonnet models, not Haiku), on the platform key. The request sends its own max_tokens (2,048).
  webSearch: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS },
} as const satisfies Record<string, RouteDefinition>;
export type RouteKey = keyof typeof ROUTES;

/** Whether a route may send images (`RouteDefinition.vision`). */
export function routeAcceptsImages(route: RouteKey): boolean {
  return (ROUTES[route] as RouteDefinition).vision === true;
}

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
  /** True when low credits moved this call to the route's lower-cost model (`ResolveOptions.lowCredits`). */
  lowCredits?: true;
};

export interface ResolveOptions {
  /** The business's credits are low: routine routes move to their `lowCredits` model; kept routes are unchanged. */
  lowCredits?: boolean;
  /**
   * The account is not on a paid plan (WP-13): every route, a locked one included, runs on Haiku 5.5, the free plan's
   * model on Foundmill's key. A lock names the route's best model, which a paid plan or the founder's own key reaches;
   * no warning and no credit saver apply.
   */
  freePlan?: boolean;
}

// GLM is not on this ladder: it is the free plan's only model, not a step down from Haiku (`resolveModel`).
const RANK: Record<ModelKey, number> = { glm: 0, haiku: 0, sonnet: 1, opus: 2 };

/** A model key as a founder reads it in a warning ("opus" → "Opus"); never the route's internal name. */
function modelWord(key: ModelKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** The model a route's routine work moves to when credits are low, or null when the route keeps its model. */
export function lowCreditsModel(route: RouteKey): ModelKey | null {
  const def: RouteDefinition = ROUTES[route];
  return def.locked === true || def.lowCredits === "keep" ? null : def.lowCredits;
}

/**
 * Resolve the model for a route, honouring locks and downgrade warnings (BUILD §10.1, §11.10 "Model selection"). With
 * `lowCredits`, a routine route runs on its lower-cost model, or on the agent's chosen model when that is cheaper still;
 * a kept or locked route is unchanged.
 */
export function resolveModel(route: RouteKey, override?: ModelKey, options: ResolveOptions = {}): RouteResolution {
  const def: RouteDefinition = ROUTES[route];
  const locked = def.locked === true;
  let modelKey: ModelKey = def.model;
  let warning: string | undefined;
  if (options.freePlan) {
    modelKey = "haiku";
  } else if (override === "glm") {
    // A free account's agent session (WP-13 T4): GLM on every route, a locked one included, as `freePlan` does.
    modelKey = "glm";
  } else if (override && override !== def.model) {
    if (locked) {
      warning = `This work is locked to ${modelWord(def.model)}, so ${modelWord(override)} is not used for it.`;
    } else {
      modelKey = override;
      if (def.warnOnDowngrade && RANK[override] < RANK[def.model]) {
        warning = `Moving from ${modelWord(def.model)} to ${modelWord(override)} lowers the quality of planning and routing.`;
      }
    }
  }
  const saver = options.lowCredits && !options.freePlan && modelKey !== "glm" ? lowCreditsModel(route) : null;
  const moved = saver !== null && RANK[saver] < RANK[modelKey];
  if (moved) modelKey = saver;
  const caps = MODEL_CAPABILITIES[modelKey];
  const effort = def.effort && caps.effort ? def.effort : undefined;
  const resolution: RouteResolution = { route, modelKey, modelId: MODELS[modelKey], locked, warning, batch: def.batch === true, maxTokens: maxTokensFor(def.maxTokens, modelKey, effort) };
  if (moved) resolution.lowCredits = true;
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
