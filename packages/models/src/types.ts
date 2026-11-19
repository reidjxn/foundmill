/**
 * Public types for @foundmill/models (docs/ARCHITECTURE.md §6).
 *
 * A `ModelClient` is the only way the platform talks to Claude. It exists in two modes: `live` (Anthropic SDK) and
 * `mock` (deterministic fixtures). Both return the same `CompleteResult` shape so every caller works unchanged under
 * MODEL_MODE=mock.
 */
import type { z } from "zod";
import type { MeterResult } from "./pricing";
import type { ModelId, ModelKey, RouteKey } from "./routing";

export type ModelMode = "mock" | "live";

export type ChatRole = "user" | "assistant";

/** Media types an image block may carry (Anthropic image input). */
export const CHAT_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ChatImageMediaType = (typeof CHAT_IMAGE_MEDIA_TYPES)[number];

/** An image sent with a message, base64 without a data: prefix. Only routes marked `vision` in routing.ts accept them. */
export interface ChatImage {
  mediaType: ChatImageMediaType;
  data: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Images sent before the text of this (user) message; the route must be a `vision` route (client throws otherwise). */
  images?: readonly ChatImage[];
}

/** Effort hint for the live client (`output_config.effort`). Ignored in mock mode. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Inference speed of a live call. `fast` is Opus fast mode (beta, 2× price), only when MODEL_FAST_MODE is on. */
export type Speed = "standard" | "fast";

/** Where a call's cost should be booked. All fields optional; forwarded verbatim to `onUsage`. */
export interface UsageAttribution {
  businessId?: string;
  /**
   * The person a call with no business is for (a draft before commit): who pays is read from their plan (WP-13), and
   * the call is booked to their account usage and capped per account (WP-09 T2).
   */
  userId?: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  inboxItemId?: string;
  kind?: string;
}

export interface CompleteRequest<T = unknown> {
  /** Route key from `ROUTES`; selects the model and lock/warn rules. */
  route: RouteKey;
  /** System prompt. A string, or several blocks (club rules, brief, instructions) that are sent as separate text blocks. */
  system?: string | readonly string[];
  messages: readonly ChatMessage[];
  /** When set, the completion is requested as JSON matching this schema, parsed and validated (one automatic repair retry). */
  schema?: z.ZodType<T>;
  maxTokens?: number;
  /**
   * Sampling temperature. Only honoured on models that accept sampling parameters (Haiku 4.5); the Opus/Sonnet 5.5
   * generation rejects `temperature` with a 400, so the live client drops it there and logs at debug level.
   */
  temperature?: number;
  /** A refusal comes back as the answer (`stopReason: "refusal"`) instead of throwing `ModelOutputError("refusal")`. */
  allowRefusal?: boolean;
  /** Put a prompt-cache breakpoint on the system blocks (BUILD §10.4: brief + instructions are cached). */
  cacheSystem?: boolean;
  /** Per-agent model choice (BUILD §11.10 "Model selection"); subject to the route's lock/warn rules. */
  /**
   * The account is not on a paid plan: the call runs on Haiku 5.5 whatever the route (`ResolveOptions.freePlan`). Set by
   * the free-plan gate (`enforceModelFunding`), never by a caller.
   */
  freePlan?: boolean;
  modelOverride?: ModelKey;
  /**
   * The business's credits are low (credit saver): a routine route runs on its lower-cost model (`ROUTES[route].lowCredits`,
   * routing.ts); a kept route is unchanged. Set by the credits gate (`ModelCallGate`), not by callers.
   */
  lowCredits?: boolean;
  /**
   * Caller scope for rate-limit isolation (BUILD §10.3: a 429 backs off the affected session only). Usually the agent
   * session id. Defaults to "default".
   */
  scope?: string;
  attribution?: UsageAttribution;
  /** Overrides the route's effort from `ROUTES` (routing.ts) for this call. Dropped on models without effort (Haiku 4.5). */
  effort?: Effort;
  signal?: AbortSignal;
  /**
   * Output tokens booked against the local rate limiter for this call (default: `maxTokens`). Fan-out calls set an
   * estimate of what they will really write, so twelve parallel calls do not reserve twelve times the cap. Clamped to
   * `[1, maxTokens]`; the API's own `max_tokens` is unchanged.
   */
  reserveTokens?: number;
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface CompleteResult<T = unknown> {
  /** Raw text of the final completion (for schema requests this is the JSON the model returned). */
  text: string;
  /** Parsed and validated output when `schema` was given. */
  json?: T;
  /** Token usage summed over every API call made for this completion (including the repair retry). */
  usage: TokenUsage;
  model: ModelId;
  modelKey: ModelKey;
  route: RouteKey;
  stopReason: StopReason;
  /** Metered cost for this completion (labelled estimate). */
  cost: MeterResult;
  mode: ModelMode;
  /** Anthropic `request-id` of the final call (live only). */
  requestId?: string;
  durationMs: number;
  /** True when the first JSON output failed validation and the repair retry produced the returned value. */
  repaired: boolean;
  /** Routing warning (e.g. a locked route ignored an override). */
  warning?: string;
  /** Effort sent with the call (route default or the request's), when any. */
  /** The model that served the call when a server-side fallback answered (WP-09 T5). */
  servedModel?: string;
  effort?: Effort;
  /** Speed the call ran at (live only; `fast` when Opus fast mode served it). */
  speed?: Speed;
}

/** Who pays for a call: the business's own vendor key (`byok`) or the platform's key and credits (`credits`). */
export type BilledTo = "byok" | "credits";

export interface UsageEvent {
  route: RouteKey;
  model: ModelId;
  modelKey: ModelKey;
  mode: ModelMode;
  /**
   * Who pays for this call, decided by the key the client was built on (`CreateModelClientOptions.billedTo`): a client on
   * the platform key books to `credits`, one on a business's own key to `byok`. Sinks copy it to `usage_ledger.billed_to`.
   */
  billedTo: BilledTo;
  usage: TokenUsage;
  cost: MeterResult;
  scope?: string;
  attribution?: UsageAttribution;
  durationMs: number;
  occurredAt: string;
  requestId?: string;
  /** Which call within one `complete()` / `streamStructured()` this was: 0 = first, then retries and repairs. */
  attempt: number;
  /** True for a `streamStructured()` stream (an interrupted stream reports what it had used, as an estimate). */
  streamed?: boolean;
  /** The model that served the call when it is not the one asked for (a server-side refusal fallback, WP-09 T5). */
  servedModel?: string;
  /** The served model has no price here: metered at the requested model's card (Estimate). */
  unpriced?: boolean;
  /** A batch result (WP-09 T8): a sink books it with idempotency key `batch:${id}:${customId}`, so it is booked once. */
  batch?: { id: string; customId: string };
  /** `fast` when Opus fast mode served the call (metered at the fast-mode price). */
  speed?: Speed;
  /**
   * True when the call was stopped (its signal aborted) after the request went out and before the provider reported
   * any usage. The provider may still bill the prompt, so `usage` is the prompt's estimated input tokens (no output):
   * an Estimate of the tokens as well as of the price. Sinks keep the flag in the ledger row's details.
   */
  aborted?: true;
}

export type UsageSink = (event: UsageEvent) => void | Promise<void>;

/** Structural subset of pino's logger so callers can pass `createLogger()` from @foundmill/shared or a stub. */
export interface ModelLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** A completion made with a `schema`: `json` is guaranteed (the client throws instead of returning invalid output). */
export type CompleteResultWithJson<T> = CompleteResult<T> & { json: T };

export interface ModelClient {
  readonly mode: ModelMode;
  complete<T>(req: CompleteRequest<T> & { schema: z.ZodType<T> }): Promise<CompleteResultWithJson<T>>;
  complete(req: CompleteRequest<unknown> & { schema?: undefined }): Promise<CompleteResult<unknown>>;
  /**
   * Streamed structured output: delivers each element of one array (`elementPath`) as soon as it is complete and valid.
   * Both built-in clients implement it; it is optional here so hand-written test doubles stay valid. Call it through
   * the `streamStructured(client, req)` helper, which falls back to `complete()` for a client without it.
   */
  streamStructured?<T, E>(req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>>;
  /**
   * Anthropic's server web search on the `webSearch` route (WP-09 T3): one search, the result titles and addresses only,
   * metered at the tokens' price plus the per-search fee (`pricing.ts`) and reported once through `onUsage`. The live,
   * mock and gated clients implement it; optional so hand-written test doubles stay valid.
   */
  searchWeb?(req: WebSearchRequest): Promise<WebSearchResult>;
  /**
   * The Message Batches API (WP-09 T8): half price, results within a day. Call through `submitBatch`, `batchEnded` and
   * `collectBatch` (batch.ts). The live, mock and gated clients implement them; optional for test doubles.
   */
  submitBatch?(items: readonly BatchItem[]): Promise<{ batchId: string; count: number }>;
  /** `businessId`: whose key submitted it (a client that routes by business reads it there after a restart). */
  batchEnded?(batchId: string, businessId?: string): Promise<boolean>;
  collectBatch?<T>(batchId: string, items: readonly BatchItem<T>[]): Promise<BatchItemResult<T>[]>;
}

/** One request of a batch: `customId` is letters, digits, "_" and "-", at most 64 characters, unique in the batch. */
export interface BatchItem<T = unknown> {
  customId: string;
  request: CompleteRequest<T>;
}

/** One item's outcome. A batch is single-shot: a refused, cut-off or invalid answer is not repaired. */
export type BatchItemResult<T = unknown> =
  | { customId: string; ok: true; result: CompleteResult<T> }
  | { customId: string; ok: false; kind: "errored" | "canceled" | "expired" | "refusal" | "invalid_output"; message: string };

export interface WebSearchRequest {
  query: string;
  /** Set by the gates, never by a caller: the account is not on a paid plan, so the search runs on Haiku 5.5 (WP-13). */
  freePlan?: boolean;
  /** Set by the credits gate: the business's credits are low (the search's route keeps its model either way). */
  lowCredits?: boolean;
  /** Most results returned (the search may find more; the rest are dropped). */
  limit: number;
  /** Rate-limit scope, as on `CompleteRequest` (usually the session id). */
  scope?: string;
  attribution?: UsageAttribution;
  signal?: AbortSignal;
}

export interface WebSearchResult {
  results: { url: string; title: string; pageAge: string | null }[];
  usage: TokenUsage;
  /** The tokens and the search fee (an Estimate). */
  cost: MeterResult;
  mode: ModelMode;
}

// ---------------------------------------------------------------------------------------------------------------------
// Streaming structured output (audit P1)
// ---------------------------------------------------------------------------------------------------------------------

/** One element of the streamed array, validated against `elementSchema`. */
export interface StreamedElement<E> {
  /** Position in the final array. */
  index: number;
  value: E;
  /** The request's `elementPath`, e.g. "concepts". */
  path: string;
  /** True when the element came from a later call (an element repair, a resumed or repaired stream), not the first stream. */
  repaired: boolean;
  /** Milliseconds since the call started. */
  elapsedMs: number;
}

/**
 * `waiting`: connected, the model is thinking, no JSON yet. `streaming`: JSON is arriving. `retrying`: the stream broke
 * and is being restarted or resumed. `repairing`: failed elements or the whole document are being repaired. `done`.
 */
export type StreamPhase = "waiting" | "streaming" | "retrying" | "repairing" | "done";

export interface StreamProgress {
  route: RouteKey;
  phase: StreamPhase;
  /** Model call within this request (0 = the first stream). */
  call: number;
  /** Characters of JSON received in the current call. */
  chars: number;
  /** Valid elements delivered to `onElement` so far. */
  elementsEmitted: number;
  /** Elements of the current call that completed but failed `elementSchema` (repaired after the stream ends). */
  elementsFailed: number;
  /** Index of the element being written now, or null (before the array, between elements, after it). */
  writingIndex: number | null;
  elapsedMs: number;
  /**
   * Best-effort parse of the current call's document (completed members only), as of when it is called: call it inside
   * `onPartial` to see the document at that moment. Computed on demand (one `JSON.parse` of the text so far).
   */
  snapshot(): unknown;
}

export interface StreamStructuredRequest<T, E> extends Omit<CompleteRequest<T>, "schema"> {
  /** Schema of the whole document; the final result is validated against it (with repairs) exactly like `complete()`. */
  schema: z.ZodType<T>;
  /** Dotted key path of the array whose elements stream out: "concepts", "sections", "marks", "roadmap.items". */
  elementPath: string;
  /** Schema of one element of that array. Element repair needs it to be an object schema. */
  elementSchema: z.ZodType<E>;
  /**
   * Called once per final element, awaited, never concurrently. Elements arrive in index order while the stream runs;
   * elements that needed a repair arrive after it. Every element delivered is in the final `json` at its index; every
   * element of the final array is delivered exactly once. A throw aborts the model call and rejects with that error.
   */
  onElement?: (element: StreamedElement<E>) => void | Promise<void>;
  /** Progress for the UI ("Writing card 4 of 12"). Throttled while text streams; phase changes and elements always report. */
  onPartial?: (progress: StreamProgress) => void;
  /** Minimum ms between two `onPartial` calls while text streams (default 200). */
  partialThrottleMs?: number;
}

export interface StreamStructuredResult<T, E> extends CompleteResultWithJson<T> {
  elementPath: string;
  /** The final array's elements in order, each validated against `elementSchema`. */
  elements: E[];
  /** Indices whose final value came from a later call (element repair, resumed or repaired stream). */
  repairedElements: number[];
  /** Milliseconds from the start to the first JSON character and to the first delivered element. */
  firstTextMs?: number;
  firstElementMs?: number;
  /** Model calls made (streams plus element repairs). */
  calls: number;
}

/** Result of validating a bring-your-own key (BUILD §10.2 step 1). */
export interface KeyValidation {
  ok: boolean;
  /** `invalid_key`, `permission`, `rate_limited`, `billing` (the account cannot pay: no credit or a spend limit), `network`, `unknown` */
  reason?: string;
  message?: string;
  /** Rate limits learnt from the validation response headers, when the call succeeded. */
  limits?: {
    requestsPerMinute: number | null;
    inputTokensPerMinute: number | null;
    outputTokensPerMinute: number | null;
  };
  model?: ModelId;
}
