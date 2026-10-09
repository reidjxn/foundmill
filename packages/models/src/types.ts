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

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Effort hint for the live client (`output_config.effort`). Ignored in mock mode. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Inference speed of a live call. `fast` is Opus fast mode (beta, 2× price), only when MODEL_FAST_MODE is on. */
export type Speed = "standard" | "fast";

/** Where a call's cost should be booked. All fields optional; forwarded verbatim to `onUsage`. */
export interface UsageAttribution {
  businessId?: string;
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
  /** Put a prompt-cache breakpoint on the system blocks (BUILD §10.4: brief + instructions are cached). */
  cacheSystem?: boolean;
  /** Per-agent model choice (BUILD §11.10 "Model selection"); subject to the route's lock/warn rules. */
  modelOverride?: ModelKey;
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
  effort?: Effort;
  /** Speed the call ran at (live only; `fast` when Opus fast mode served it). */
  speed?: Speed;
}

export interface UsageEvent {
  route: RouteKey;
  model: ModelId;
  modelKey: ModelKey;
  mode: ModelMode;
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
  /** `fast` when Opus fast mode served the call (metered at the fast-mode price). */
  speed?: Speed;
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
  /** `invalid_key`, `permission`, `rate_limited`, `network`, `unknown` */
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
