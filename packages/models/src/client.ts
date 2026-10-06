/**
 * Model client factory and the live Anthropic implementation (docs/ARCHITECTURE.md §6, BUILD §10).
 *
 * Live path, verified against the pinned @anthropic-ai/sdk 0.131.0 types and platform.claude.com docs on 2026-10-05:
 * - Structured output through `output_config.format` (GA JSON schema mode; `zodOutputFormat` from the SDK's zod helper
 *   builds the schema). The returned text is still parsed and validated here with the caller's Zod schema so a single
 *   automatic repair retry can quote the validation issues back to the model.
 * - Prompt caching with `cache_control: { type: "ephemeral" }` on the last system block when `cacheSystem` is set (BUILD
 *   §10.4). Prefixes below the model's minimum (512 tokens on the 5.5 models, 4096 on Haiku 4.5) silently do not cache.
 * - Rate limits read from `anthropic-ratelimit-*` headers via `.withResponse()`; 429 backoff with jitter is scoped to
 *   the caller (`req.scope`) through `RateLimiter`. The SDK's own retries are disabled (`maxRetries: 0`) so this module
 *   owns the policy: 429 → scoped backoff, 5xx/529/connection → short exponential backoff, 4xx → typed error.
 * - Sampling parameters are rejected (400) by Opus 5.5 and Sonnet 5.5; `temperature` is only sent to Haiku.
 * - `effort` is passed through `output_config.effort` when given; otherwise the API default applies.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { loadEnv } from "@founder-manager/shared";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { ModelAbortedError, ModelOutputError, ModelRateLimitError, ModelRequestError, ModelUnavailableError } from "./errors";
import { parseJsonLoose } from "./json";
import { MockModelClient, type MockModelClientOptions } from "./mock";
import { type MeterResult, ZERO_USAGE, addUsage, estimateTokens, meter, sumMeters } from "./pricing";
import { RateLimiter, backoffWithJitter, parseRateLimitHeaders } from "./rate-limit";
import { MODELS, resolveModel } from "./routing";
import type { ChatMessage, CompleteRequest, CompleteResult, CompleteResultWithJson, KeyValidation, ModelClient, ModelLogger, ModelMode, StopReason, TokenUsage, UsageEvent, UsageSink } from "./types";

export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_MAX_ATTEMPTS = 4;
export const REQUEST_TIMEOUT_MS = 600_000;

export interface LiveModelClientOptions {
  apiKey: string;
  onUsage?: UsageSink;
  logger?: ModelLogger;
  /** Shared limiter (one per process is fine; buckets are keyed per API key). */
  rateLimiter?: RateLimiter;
  /** Bucket key; defaults to a sha256 fingerprint of the API key (never the key itself). */
  rateLimitKey?: string;
  /** Injectable fetch (tests, proxies). */
  fetch?: typeof globalThis.fetch;
  baseURL?: string;
  /** Attempts per API call including the first (429 and transient failures). Default 4. */
  maxAttempts?: number;
  timeoutMs?: number;
  defaultMaxTokens?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface CreateModelClientOptions extends Partial<Omit<LiveModelClientOptions, "apiKey">> {
  /** Defaults to `MODEL_MODE` from the environment (mock unless set). */
  mode?: ModelMode;
  apiKey?: string;
  mock?: Omit<MockModelClientOptions, "onUsage" | "logger">;
}

/** sha256 fingerprint of an API key for bucket keys and logs. */
export function keyFingerprint(apiKey: string): string {
  return `key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}`;
}

export function createModelClient(opts: CreateModelClientOptions = {}): ModelClient {
  const mode: ModelMode = opts.mode ?? loadEnv().MODEL_MODE;
  if (mode === "mock") return new MockModelClient({ ...opts.mock, onUsage: opts.onUsage, logger: opts.logger });
  if (!opts.apiKey) throw new ModelRequestError("createModelClient: apiKey is required in live mode", undefined, "missing_api_key");
  return new LiveModelClient({ ...opts, apiKey: opts.apiKey });
}

export class LiveModelClient implements ModelClient {
  readonly mode = "live" as const;
  readonly rateLimiter: RateLimiter;
  readonly rateLimitKey: string;
  private readonly anthropic: Anthropic;
  private readonly opts: LiveModelClientOptions;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: LiveModelClientOptions) {
    this.opts = opts;
    this.rateLimiter = opts.rateLimiter ?? new RateLimiter({ sleep: opts.sleep, random: opts.random });
    this.rateLimitKey = opts.rateLimitKey ?? keyFingerprint(opts.apiKey);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.anthropic = new Anthropic({
      apiKey: opts.apiKey,
      maxRetries: 0,
      timeout: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  complete<T>(req: CompleteRequest<T> & { schema: z.ZodType<T> }): Promise<CompleteResultWithJson<T>>;
  complete(req: CompleteRequest<unknown> & { schema?: undefined }): Promise<CompleteResult<unknown>>;
  async complete<T = unknown>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    const started = Date.now();
    const resolution = resolveModel(req.route, req.modelOverride);
    if (resolution.warning) this.opts.logger?.warn({ route: req.route, override: req.modelOverride }, resolution.warning);
    const scope = req.scope ?? "default";
    const maxTokens = req.maxTokens ?? this.opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

    const system = buildSystem(req.system, req.cacheSystem === true);
    let messages: Anthropic.MessageParam[] = req.messages.map(toParam);
    const base: Omit<Anthropic.MessageCreateParamsNonStreaming, "messages"> = {
      model: resolution.modelId,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
    };
    const outputConfig: Anthropic.OutputConfig = {};
    if (req.schema) outputConfig.format = zodOutputFormat(req.schema);
    if (req.effort) outputConfig.effort = req.effort;
    if (outputConfig.format || outputConfig.effort) base.output_config = outputConfig;
    if (req.temperature !== undefined) {
      if (resolution.modelKey === "haiku") base.temperature = req.temperature;
      else this.opts.logger?.debug({ route: req.route, model: resolution.modelId }, "temperature dropped: this model rejects sampling parameters");
    }

    let totalUsage: TokenUsage = ZERO_USAGE;
    const meters: MeterResult[] = [];
    let repaired = false;

    for (let call = 0; call < 2; call++) {
      const { message, requestId } = await this.send({ ...base, messages }, req, scope, call);
      const usage = toUsage(message.usage);
      totalUsage = addUsage(totalUsage, usage);
      const cost = meter(usage, resolution.modelId);
      meters.push(cost);
      const durationMs = Date.now() - started;
      await this.emit({ route: req.route, model: resolution.modelId, modelKey: resolution.modelKey, mode: "live", usage, cost, scope: req.scope, attribution: req.attribution, durationMs, occurredAt: new Date().toISOString(), requestId, attempt: call });

      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const stopReason = (message.stop_reason ?? "end_turn") as StopReason;
      const common = { text, usage: totalUsage, model: resolution.modelId, modelKey: resolution.modelKey, route: req.route, stopReason, cost: sumMeters(meters, resolution.modelId), mode: "live" as const, requestId, durationMs: Date.now() - started, repaired, warning: resolution.warning };

      if (!req.schema) return { ...common };

      if (stopReason === "refusal") {
        throw new ModelOutputError(`Model refused the request for route "${req.route}"`, { stopDetails: (message as { stop_details?: unknown }).stop_details, requestId }, "refusal");
      }
      const parsed = parseJsonLoose(text);
      const validated = parsed.ok ? req.schema.safeParse(parsed.value) : undefined;
      if (validated?.success) return { ...common, json: validated.data };

      const issues = validated ? validated.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) : [`output is not JSON: ${parsed.ok ? "" : parsed.error}`];
      if (stopReason === "max_tokens") {
        throw new ModelOutputError(`Output truncated at max_tokens=${maxTokens} before valid JSON was produced for route "${req.route}"`, { issues, requestId }, "max_tokens");
      }
      if (call === 1) {
        throw new ModelOutputError(`Model output did not match the schema for route "${req.route}" after one repair retry`, { issues, text: text.slice(0, 2000), requestId });
      }
      this.opts.logger?.info({ route: req.route, issues: issues.slice(0, 10), requestId }, "schema validation failed; asking the model to repair its JSON");
      repaired = true;
      messages = [
        ...messages,
        { role: "assistant", content: text.trim() ? text : "(empty response)" },
        { role: "user", content: repairPrompt(issues) },
      ];
    }
    throw new ModelOutputError(`Unreachable: repair loop exhausted for route "${req.route}"`);
  }

  /** One API call with rate-limit reservation and the retry policy. */
  private async send(params: Anthropic.MessageCreateParamsNonStreaming, req: CompleteRequest, scope: string, call: number): Promise<{ message: Anthropic.Message; requestId?: string }> {
    const maxAttempts = this.opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const estimatedInput = estimateTokens(JSON.stringify(params.messages) + JSON.stringify(params.system ?? ""));
    let transientAttempt = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (req.signal?.aborted) throw new ModelAbortedError();
      await this.rateLimiter.acquire(this.rateLimitKey, { requests: 1, inputTokens: estimatedInput, outputTokens: params.max_tokens }, scope);
      try {
        const { data, response, request_id } = await this.anthropic.messages.create(params, { signal: req.signal }).withResponse();
        this.rateLimiter.observe(this.rateLimitKey, response.headers);
        this.rateLimiter.clearPenalty(scope);
        return { message: data, requestId: request_id ?? undefined };
      } catch (error) {
        if (req.signal?.aborted || error instanceof Anthropic.APIUserAbortError) throw new ModelAbortedError();
        if (error instanceof Anthropic.RateLimitError) {
          const parsed = parseRateLimitHeaders(error.headers);
          this.rateLimiter.observe(this.rateLimitKey, parsed);
          const wait = this.rateLimiter.reportRateLimited(scope, { retryAfterMs: parsed.retryAfterMs });
          this.opts.logger?.warn({ route: req.route, scope, attempt, wait, requestId: error.requestID }, "429 from Anthropic; backing off this scope only");
          if (attempt + 1 >= maxAttempts) throw new ModelRateLimitError(`Rate limited after ${maxAttempts} attempts for route "${req.route}"`, scope, wait, { requestId: error.requestID, call });
          await this.sleep(wait);
          continue;
        }
        if (error instanceof Anthropic.APIConnectionError || (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500)) {
          transientAttempt++;
          if (attempt + 1 >= maxAttempts) {
            throw new ModelUnavailableError(`Anthropic unavailable after ${maxAttempts} attempts for route "${req.route}": ${error.message}`, { status: error instanceof Anthropic.APIError ? error.status : undefined });
          }
          const wait = backoffWithJitter(transientAttempt - 1, { baseMs: 500, maxMs: 8000, random: this.opts.random });
          this.opts.logger?.warn({ route: req.route, attempt, wait, status: error instanceof Anthropic.APIError ? error.status : "connection" }, "transient Anthropic failure; retrying");
          await this.sleep(wait);
          continue;
        }
        if (error instanceof Anthropic.APIError) {
          throw new ModelRequestError(`Anthropic request failed (${error.status ?? "?"}): ${error.message}`, error.status, error.type ?? null, { requestId: error.requestID });
        }
        throw error;
      }
    }
    throw new ModelUnavailableError(`No attempts left for route "${req.route}"`);
  }

  /** BUILD §10.2 step 1: minimal call that proves the key works and reads the rate-limit headers. */
  async validateKey(): Promise<KeyValidation> {
    try {
      const { response } = await this.anthropic.messages.create({ model: MODELS.haiku, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }).withResponse();
      const limits = this.rateLimiter.observe(this.rateLimitKey, response.headers);
      return {
        ok: true,
        model: MODELS.haiku,
        limits: { requestsPerMinute: limits.requests.limit, inputTokensPerMinute: limits.inputTokens.limit, outputTokensPerMinute: limits.outputTokens.limit },
      };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return { ok: false, reason: "invalid_key", message: "Anthropic rejected the key (401)." };
      if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: "permission", message: error.message };
      if (error instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limited", message: "The key is valid but currently rate limited; try again shortly." };
      if (error instanceof Anthropic.APIConnectionError) return { ok: false, reason: "network", message: error.message };
      return { ok: false, reason: "unknown", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async emit(event: UsageEvent): Promise<void> {
    if (!this.opts.onUsage) return;
    try {
      await this.opts.onUsage(event);
    } catch (error) {
      this.opts.logger?.error({ err: error instanceof Error ? error.message : String(error) }, "onUsage sink threw; usage event dropped");
    }
  }
}

/** Validate a bring-your-own key. In mock mode no network call is made and representative limits are returned. */
export async function validateApiKey(apiKey: string, opts: { mode?: ModelMode; fetch?: typeof globalThis.fetch; baseURL?: string } = {}): Promise<KeyValidation> {
  const mode = opts.mode ?? loadEnv().MODEL_MODE;
  if (mode === "mock") {
    if (!apiKey.trim()) return { ok: false, reason: "invalid_key", message: "Empty key." };
    return { ok: true, model: MODELS.haiku, limits: { requestsPerMinute: 1000, inputTokensPerMinute: 2_000_000, outputTokensPerMinute: 400_000 } };
  }
  const client = new LiveModelClient({ apiKey, fetch: opts.fetch, baseURL: opts.baseURL, maxAttempts: 1 });
  return client.validateKey();
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

function buildSystem(system: CompleteRequest["system"], cache: boolean): Anthropic.TextBlockParam[] | undefined {
  const blocks = (Array.isArray(system) ? system : typeof system === "string" ? [system] : []).filter((s) => s.trim().length > 0);
  if (blocks.length === 0) return undefined;
  return blocks.map((text, i) => ({ type: "text", text, ...(cache && i === blocks.length - 1 ? { cache_control: { type: "ephemeral" } } : {}) }));
}

const toParam = (m: ChatMessage): Anthropic.MessageParam => ({ role: m.role, content: m.content });

function toUsage(u: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

function repairPrompt(issues: string[]): string {
  return [
    "Your previous reply was not valid for the required JSON schema.",
    "Validation issues:",
    ...issues.slice(0, 20).map((i) => `- ${i}`),
    "Return ONLY the corrected JSON object that satisfies the schema. No prose, no code fences, no explanation.",
  ].join("\n");
}

export type { z };
