/**
 * Public types for @founder-manager/models (docs/ARCHITECTURE.md §6).
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
  effort?: Effort;
  signal?: AbortSignal;
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
  /** Which call within one `complete()` this was: 0 = first, 1 = repair retry. */
  attempt: number;
}

export type UsageSink = (event: UsageEvent) => void | Promise<void>;

/** Structural subset of pino's logger so callers can pass `createLogger()` from @founder-manager/shared or a stub. */
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
