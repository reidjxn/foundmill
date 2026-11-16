/**
 * Model client factory and the live Anthropic implementation (docs/ARCHITECTURE.md §6, BUILD §10).
 *
 * Live path, verified against the pinned @anthropic-ai/sdk 0.131.0 types and platform.claude.com docs on 2026-10-05:
 * - Structured output through `output_config.format` (GA JSON schema mode; `zodOutputFormat` from the SDK's zod helper
 *   builds the schema). The returned text is still parsed and validated here with the caller's Zod schema so a single
 *   automatic repair retry can quote the validation issues back to the model. A schema the grammar cannot express (an
 *   open map such as PlanOutput's `params`, an untyped value) is sent as a "## Response format" system block instead,
 *   because the SDK would close it to `{}` (`structuredOutputFor`).
 * - Prompt caching with `cache_control: { type: "ephemeral" }` on the last system block when `cacheSystem` is set (BUILD
 *   §10.4). Prefixes below the model's minimum (512 tokens on the 5.5 models, 4096 on Haiku 4.5) silently do not cache.
 * - Rate limits read from `anthropic-ratelimit-*` headers via `.withResponse()`; 429 backoff with jitter is scoped to
 *   the caller (`req.scope`) through `RateLimiter`. The SDK's own retries are disabled (`maxRetries: 0`) so this module
 *   owns the policy: 429 → scoped backoff, 5xx/529/connection → short exponential backoff, 4xx → typed error. A refusal
 *   to bill (400 "credit balance is too low" or "reached your specified API usage limits", 429
 *   `enforced_spend_limit_reached`) is a `ModelBillingError`, never retried: it lasts until someone pays or the month
 *   ends (`billingRefusal`).
 * - Sampling parameters are rejected (400) by Opus 5.5 and Sonnet 5.5; `temperature` is only sent to Haiku.
 * - `effort` goes in `output_config.effort`: the request's own, else the route's from `ROUTES` (routing.ts), else the
 *   API default. Never sent to a model without the parameter (Haiku 4.5).
 * - Fast mode (Opus, beta): a route with `speed: "fast"` runs through `client.beta.messages` with the
 *   `fast-mode-2026-02-01` beta and top-level `speed: "fast"`, only when `fastMode` (MODEL_FAST_MODE) is on. Fast mode
 *   has its own rate-limit pool, so it gets its own limiter bucket; a 429 or a refusal of the beta falls back to
 *   standard speed at once instead of backing off. Usage is metered at the fast-mode price when the response says
 *   `usage.speed: "fast"`.
 * - Streaming (`streamStructured`): `messages.stream()` (or the beta stream in fast mode); the text deltas feed the
 *   incremental scanner in ./structured-stream.ts. The connection phase gets the same retry policy as `complete()`;
 *   a stream that breaks after connecting is restarted or resumed there.
 * - `max_tokens`: the request's own, else the client's `defaultMaxTokens`, else the route's budget from `ROUTES`
 *   (routing.ts), sized for the reply plus the thinking Opus 5.5 and Sonnet 5.5 always do (it counts toward
 *   `max_tokens`). A schema request cut off at `max_tokens` before its JSON is complete is sent once more with the
 *   budget doubled (up to `MAX_TOKENS_CEILING`) instead of failing at once (audit CML-03); both calls are metered.
 * - The limiter books `reserveTokens` output tokens per call: by default the request's own `max_tokens`, or at most
 *   `ROUTE_RESERVE_TOKENS` when the call runs on its route's budget (mostly thinking headroom it rarely uses).
 * - A call stopped by its signal after the request went out is still metered: the prompt's estimated input tokens, no
 *   output, flagged `aborted` on the usage event (the provider may bill it and reports nothing). A call stopped before
 *   it was sent books nothing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { loadEnv } from "@foundmill/shared";
import { getTracer } from "@foundmill/shared/telemetry";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ModelAbortedError, ModelBillingError, ModelOutputError, ModelRateLimitError, ModelRequestError, ModelUnavailableError, type ModelBillingReason } from "./errors";
import { clearPlatformBillingRefusal, notePlatformBillingRefusal } from "./billing-state";
import { IMAGE_TOKEN_ESTIMATE, assertImagesAllowed } from "./images";
import { parseJsonLoose } from "./json";
import { MockModelClient, type MockModelClientOptions } from "./mock";
import { type MeterResult, ZERO_USAGE, addUsage, estimateTokens, meter, meterWebSearch, sumMeters } from "./pricing";
import { RateLimiter, backoffWithJitter, parseRateLimitHeaders } from "./rate-limit";
import { FAST_MODE_BETA, MODELS, MODEL_CAPABILITIES, type RouteResolution, resolveModel } from "./routing";
import { type StreamCallArgs, type StreamCallResult, StreamInterruptedError, runStructuredStream } from "./structured-stream";
import type {
  ChatMessage,
  CompleteRequest,
  CompleteResult,
  CompleteResultWithJson,
  Effort,
  KeyValidation,
  ModelClient,
  ModelLogger,
  ModelMode,
  Speed,
  StopReason,
  StreamStructuredRequest,
  StreamStructuredResult,
  TokenUsage,
  UsageEvent,
  BilledTo,
  UsageSink,
  WebSearchRequest,
  WebSearchResult,
} from "./types";

/** `max_tokens` of a web search request: the search's titles and addresses are short (as the gateway sent it before T3). */
export const WEB_SEARCH_MAX_TOKENS = 2_048;

/**
 * Highest budget the truncation retry doubles up to. A non-streaming call this long still finishes well inside
 * `REQUEST_TIMEOUT_MS`; longer outputs belong on `streamStructured`.
 */
export const MAX_TOKENS_CEILING = 32_000;
/**
 * Output tokens the limiter books for a call that runs on its route's budget (it sent neither `maxTokens` nor
 * `reserveTokens`). That budget is mostly room for thinking the call rarely uses, so booking all of it would let one
 * planner call take a whole small key's output bucket; this is what such a call booked before budgets were sized.
 */
export const ROUTE_RESERVE_TOKENS = 4_096;
export const DEFAULT_MAX_ATTEMPTS = 4;
export const REQUEST_TIMEOUT_MS = 600_000;

export interface LiveModelClientOptions {
  apiKey: string;
  /** Who pays for calls made through this client (default `credits`: the platform key). A client on a business's own key says `byok`. */
  billedTo?: BilledTo;
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
  /** `max_tokens` for every request without its own, instead of the route's budget (routing.ts). Unset in services. */
  defaultMaxTokens?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /**
   * Honour `speed: "fast"` on the routes that declare it (Opus fast mode: beta, Claude API only, 2× price). Off by
   * default; `createModelClient` reads MODEL_FAST_MODE.
   */
  fastMode?: boolean;
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

/**
 * One trace span per model call (BUILD §15 "LLM spans with tokens and cost per business/agent"), a child of whatever
 * span the caller runs in (a tRPC request, an activity, an agent session). A no-op until the service installed
 * telemetry with an OTLP endpoint. Cost is an Estimate, in minor units of `llm.cost.currency`.
 */
export function recordModelSpan(event: UsageEvent): void {
  const tracer = getTracer();
  if (!tracer.enabled) return;
  const endMs = Date.parse(event.occurredAt) || Date.now();
  const a = event.attribution;
  tracer.recordSpan(`llm ${event.route}`, {
    startMs: endMs - Math.max(0, event.durationMs),
    endMs,
    attributes: {
      "llm.route": event.route,
      "llm.model": event.model,
      "llm.mode": event.mode,
      "llm.billed_to": event.billedTo,
      "llm.tokens.in": event.usage.inputTokens,
      "llm.tokens.out": event.usage.outputTokens,
      "llm.cost.minor": event.cost.costMinorInt,
      "llm.cost.currency": event.cost.currency,
      "llm.cost.label": "Estimate",
      "llm.attempt": event.attempt,
      "foundmill.business_id": a?.businessId ?? null,
      "foundmill.agent_id": a?.agentId ?? null,
      "foundmill.session_id": a?.sessionId ?? null,
    },
  });
}

/**
 * The mode a service should actually run in: `live` only when a platform key is present. A service started with
 * MODEL_MODE=live and no ANTHROPIC_API_KEY logs one error and runs on the mock client instead of failing to boot,
 * so the key can be added to a running deployment without a crash in between.
 */
export function effectiveModelMode(mode: ModelMode, apiKey: string | undefined, logger?: ModelLogger): ModelMode {
  if (mode === "live" && !apiKey) {
    logger?.error({}, "MODEL_MODE=live but ANTHROPIC_API_KEY is missing; running on the mock model client until it is set");
    return "mock";
  }
  return mode;
}

export function createModelClient(opts: CreateModelClientOptions = {}): ModelClient {
  const mode: ModelMode = opts.mode ?? loadEnv().MODEL_MODE;
  // The tuning knobs below are optional: an environment that does not parse leaves them at their defaults.
  const env = (() => {
    try {
      return loadEnv();
    } catch {
      return undefined;
    }
  })();
  if (mode === "mock") {
    // Simulated latency is a dev knob (MOCK_MODEL_LATENCY_MS / MOCK_MODEL_STREAM_MS); both default to 0.
    const latencyMs = opts.mock?.latencyMs ?? env?.MOCK_MODEL_LATENCY_MS ?? 0;
    const streamElementMs = opts.mock?.streamElementMs ?? env?.MOCK_MODEL_STREAM_MS ?? 0;
    return new MockModelClient({ ...opts.mock, latencyMs, streamElementMs, billedTo: opts.billedTo, onUsage: opts.onUsage, logger: opts.logger });
  }
  if (!opts.apiKey) throw new ModelRequestError("createModelClient: apiKey is required in live mode", undefined, "missing_api_key");
  return new LiveModelClient({ ...opts, apiKey: opts.apiKey, fastMode: opts.fastMode ?? env?.MODEL_FAST_MODE ?? false });
}

/** The request fields that shape the API call (shared by `complete` and `streamStructured`). */
type PlanInput = Pick<CompleteRequest<unknown>, "route" | "modelOverride" | "lowCredits" | "maxTokens" | "reserveTokens" | "system" | "cacheSystem" | "effort" | "temperature"> & { schema?: z.ZodType };
/** The request fields the retry policy and metering read. */
type CallContext = Pick<CompleteRequest<unknown>, "route" | "signal" | "scope" | "attribution">;

/** Everything one request resolves to before the first API call. */
interface CallPlan {
  resolution: RouteResolution;
  maxTokens: number;
  /** Output tokens booked against the limiter per API call. */
  reserve: number;
  effort?: Effort;
  /** Fast mode requested for this call (route asks, model has it, client allows it). */
  fast: boolean;
  base: Omit<Anthropic.MessageCreateParamsNonStreaming, "messages">;
}

/** Mutable per-call state shared by the retry loop: fast mode can be switched off after a 429 or a refused beta. */
interface AttemptState {
  fast: boolean;
  transient: number;
}

/** The streaming surface used here; `MessageStream` and `BetaMessageStream` both have it. */
interface StreamHandle extends AsyncIterable<{ type: string; delta?: { type: string; text?: string } }> {
  withResponse(): Promise<{ response: Response; request_id: string | null | undefined }>;
  finalMessage(): Promise<{ content: readonly { type: string; text?: string }[]; stop_reason: string | null; usage: Anthropic.Usage & { speed?: string | null }; stop_details?: unknown }>;
  readonly currentMessage: { usage: Anthropic.Usage } | undefined;
  abort(): void;
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
    assertImagesAllowed(req.route, req.messages);
    let plan = this.plan(req);
    const { resolution } = plan;
    const scope = req.scope ?? "default";
    const firstMessages: Anthropic.MessageParam[] = req.messages.map(toParam);
    let messages = firstMessages;

    let totalUsage: TokenUsage = ZERO_USAGE;
    const meters: MeterResult[] = [];
    let repaired = false;
    let raised = false;
    let speedUsed: Speed | undefined;

    // One repair call and one call at a raised budget at most: a schema answer is never sent more than three times.
    for (let call = 0; ; call++) {
      const { message, requestId, speed } = await this.send({ ...plan.base, messages }, req, scope, call, plan);
      if (speed === "fast") speedUsed = "fast";
      const usage = toUsage(message.usage);
      totalUsage = addUsage(totalUsage, usage);
      const cost = meter(usage, resolution.modelId, { speed });
      meters.push(cost);
      const durationMs = Date.now() - started;
      await this.emit({ route: req.route, model: resolution.modelId, modelKey: resolution.modelKey, mode: "live", usage, cost, scope: req.scope, attribution: req.attribution, durationMs, occurredAt: new Date().toISOString(), requestId, attempt: call, ...(speed === "fast" ? { speed } : {}) });

      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const stopReason = (message.stop_reason ?? "end_turn") as StopReason;
      const common = { text, usage: totalUsage, model: resolution.modelId, modelKey: resolution.modelKey, route: req.route, stopReason, cost: sumMeters(meters, resolution.modelId), mode: "live" as const, requestId, durationMs: Date.now() - started, repaired, warning: resolution.warning, ...(plan.effort ? { effort: plan.effort } : {}), ...(speedUsed ? { speed: speedUsed } : {}) };

      if (!req.schema) return { ...common };

      if (stopReason === "refusal") {
        throw new ModelOutputError(`Model refused the request for route "${req.route}"`, { stopDetails: (message as { stop_details?: unknown }).stop_details, requestId }, "refusal");
      }
      const parsed = parseJsonLoose(text);
      const validated = parsed.ok ? req.schema.safeParse(parsed.value) : undefined;
      if (validated?.success) return { ...common, json: validated.data };

      const issues = validated ? validated.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) : [`output is not JSON: ${parsed.ok ? "" : parsed.error}`];
      if (stopReason === "max_tokens") {
        // The thinking and the JSON did not fit: ask the same question again with twice the room, once.
        const bigger = Math.min(MAX_TOKENS_CEILING, plan.maxTokens * 2);
        if (raised || bigger <= plan.maxTokens) {
          throw new ModelOutputError(`Output truncated at max_tokens=${plan.maxTokens} before valid JSON was produced for route "${req.route}"`, { issues, requestId }, "max_tokens");
        }
        this.opts.logger?.warn({ route: req.route, maxTokens: plan.maxTokens, retryMaxTokens: bigger, requestId }, "output truncated at max_tokens; retrying once with a larger budget");
        raised = true;
        plan = withMaxTokens(plan, bigger);
        messages = firstMessages;
        continue;
      }
      if (repaired) {
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
  }

  /**
   * Streamed structured output (see `StreamStructuredRequest` in ./types.ts): each element of `elementPath` is validated
   * and delivered as soon as it is complete; the whole document is validated at the end with the same repair policy as
   * `complete()`, repairing only the failed elements where it can.
   */
  async streamStructured<T, E>(req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>> {
    assertImagesAllowed(req.route, req.messages);
    const plan = this.plan(req);
    const scope = req.scope ?? "default";
    return runStructuredStream(req, {
      mode: "live",
      modelId: plan.resolution.modelId,
      modelKey: plan.resolution.modelKey,
      warning: plan.resolution.warning,
      effort: plan.effort,
      maxTokens: plan.maxTokens,
      logger: this.opts.logger,
      streamCall: (args) => this.streamCall(args, req, scope, plan),
      complete: (r) => this.complete(r),
    });
  }

  /**
   * One server web search (WP-09 T3; moved unchanged in content from the gateway's `web.search_web`): the `webSearch`
   * route's model at its effort, `web_search_20260209` used at most once, `max_tokens` 2,048. Sent through `send()`, so
   * the limiter, the retry policy and billing refusals apply as to any call; metered once at the tokens' price plus the
   * fee for each search the response counts (none for a search that came back as an error, which then throws).
   */
  async searchWeb(req: WebSearchRequest): Promise<WebSearchResult> {
    const started = Date.now();
    const route = "webSearch" as const;
    const plan = this.plan({ route, maxTokens: WEB_SEARCH_MAX_TOKENS });
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      ...plan.base,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
      messages: [{ role: "user", content: `Search the web for: ${req.query}\nList what the search returns; do not add anything.` }],
    };
    const call = { route, signal: req.signal, scope: req.scope, attribution: req.attribution };
    const { message, requestId } = await this.send(params, call, req.scope ?? "default", 0, plan);
    const results: WebSearchResult["results"] = [];
    let failed: string | null = null;
    for (const block of message.content) {
      if (block.type !== "web_search_tool_result") continue;
      // An error comes back as an object, results as a list (HTTP 200 either way).
      if (!Array.isArray(block.content)) {
        failed = block.content.error_code;
        continue;
      }
      for (const r of block.content) results.push({ url: r.url, title: r.title, pageAge: r.page_age ?? null });
    }
    const usage = toUsage(message.usage);
    const searches = failed ? 0 : (message.usage.server_tool_use?.web_search_requests ?? 0);
    const cost = meterWebSearch(usage, plan.resolution.modelId, searches);
    await this.emit({ route, model: plan.resolution.modelId, modelKey: plan.resolution.modelKey, mode: "live", usage, cost, scope: req.scope, attribution: req.attribution, durationMs: Date.now() - started, occurredAt: new Date().toISOString(), requestId, attempt: 0 });
    if (failed) throw new ModelUnavailableError(`web search failed: ${failed}`, { errorCode: failed, requestId });
    return { results: results.slice(0, req.limit), usage, cost, mode: "live" };
  }

  /** Model, max_tokens, reservation, effort, speed and the request body shared by every call of one request. */
  private plan(req: PlanInput): CallPlan {
    const resolution = resolveModel(req.route, req.modelOverride, { lowCredits: req.lowCredits });
    if (resolution.warning) this.opts.logger?.warn({ route: req.route, override: req.modelOverride }, resolution.warning);
    const sized = req.maxTokens ?? this.opts.defaultMaxTokens;
    const maxTokens = sized ?? resolution.maxTokens;
    const reserve = Math.max(1, Math.min(maxTokens, Math.round(req.reserveTokens ?? sized ?? ROUTE_RESERVE_TOKENS)));
    const output = req.schema ? structuredOutputFor(req.schema) : undefined;
    if (output?.kind === "prompt") this.opts.logger?.debug({ route: req.route, gaps: output.gaps.slice(0, 5) }, "schema not expressible as structured output; sending it in the system prompt instead");
    const systemBlocks = output?.kind === "prompt" ? [...systemTexts(req.system), output.instruction] : req.system;
    const system = buildSystem(systemBlocks, req.cacheSystem === true);
    const base: Omit<Anthropic.MessageCreateParamsNonStreaming, "messages"> = {
      model: resolution.modelId,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
    };
    const caps = MODEL_CAPABILITIES[resolution.modelKey];
    const wanted = req.effort ?? resolution.effort;
    const effort = wanted && caps.effort ? wanted : undefined;
    if (wanted && !effort) this.opts.logger?.debug({ route: req.route, model: resolution.modelId }, "effort dropped: this model has no effort parameter");
    const outputConfig: Anthropic.OutputConfig = {};
    if (output?.kind === "format") outputConfig.format = output.format;
    if (effort) outputConfig.effort = effort;
    if (outputConfig.format || outputConfig.effort) base.output_config = outputConfig;
    if (req.temperature !== undefined) {
      if (resolution.modelKey === "haiku") base.temperature = req.temperature;
      else this.opts.logger?.debug({ route: req.route, model: resolution.modelId }, "temperature dropped: this model rejects sampling parameters");
    }
    const fast = resolution.speed === "fast" && this.opts.fastMode === true;
    return { resolution, maxTokens, reserve, effort, fast, base };
  }

  /** Limiter bucket: fast mode draws on its own rate-limit pool. */
  private bucket(fast: boolean): string {
    return fast ? `${this.rateLimitKey}:fast` : this.rateLimitKey;
  }

  /** One API call with rate-limit reservation and the retry policy. */
  private async send(params: Anthropic.MessageCreateParamsNonStreaming, req: CallContext, scope: string, call: number, plan: CallPlan): Promise<{ message: Anthropic.Message & { usage: { speed?: string | null } }; requestId?: string; speed?: Speed }> {
    const maxAttempts = this.opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const estimatedInput = estimateInputTokens(params);
    const state: AttemptState = { fast: plan.fast, transient: 0 };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (req.signal?.aborted) throw new ModelAbortedError();
      const fast = state.fast;
      await this.rateLimiter.acquire(this.bucket(fast), { requests: 1, inputTokens: estimatedInput, outputTokens: plan.reserve }, scope);
      // Stopped while the limiter waited: nothing was sent, so nothing is booked.
      if (req.signal?.aborted) throw new ModelAbortedError();
      const sentAt = Date.now();
      try {
        const { data, response, request_id } = fast
          ? await this.anthropic.beta.messages.create({ ...params, speed: "fast", betas: [FAST_MODE_BETA] } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, { signal: req.signal }).withResponse()
          : await this.anthropic.messages.create(params, { signal: req.signal }).withResponse();
        this.rateLimiter.observe(this.bucket(fast), response.headers);
        this.rateLimiter.clearPenalty(scope);
        this.billed();
        const message = data as Anthropic.Message & { usage: { speed?: string | null } };
        return { message, requestId: request_id ?? undefined, speed: speedOf(message.usage, fast) };
      } catch (error) {
        if (isAbort(error, req)) {
          await this.meterAborted(req, plan, call, estimatedInput, fast, sentAt);
          throw new ModelAbortedError();
        }
        await this.handleAttemptError(error, req, scope, attempt, maxAttempts, call, state);
      }
    }
    throw new ModelUnavailableError(`No attempts left for route "${req.route}"`);
  }

  /** Open a stream with the same reservation and connection-phase retry policy as `send`. */
  private async openStream(params: Anthropic.MessageCreateParamsNonStreaming, req: CallContext, scope: string, call: number, plan: CallPlan): Promise<{ stream: StreamHandle; requestId?: string; fast: boolean }> {
    const maxAttempts = this.opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const estimatedInput = estimateInputTokens(params);
    const state: AttemptState = { fast: plan.fast, transient: 0 };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (req.signal?.aborted) throw new ModelAbortedError();
      const fast = state.fast;
      await this.rateLimiter.acquire(this.bucket(fast), { requests: 1, inputTokens: estimatedInput, outputTokens: plan.reserve }, scope);
      if (req.signal?.aborted) throw new ModelAbortedError();
      const sentAt = Date.now();
      const stream = (
        fast
          ? this.anthropic.beta.messages.stream({ ...params, speed: "fast", betas: [FAST_MODE_BETA] } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, { signal: req.signal })
          : this.anthropic.messages.stream(params, { signal: req.signal })
      ) as unknown as StreamHandle;
      try {
        const { response, request_id } = await stream.withResponse();
        this.rateLimiter.observe(this.bucket(fast), response.headers);
        this.rateLimiter.clearPenalty(scope);
        this.billed();
        return { stream, requestId: request_id ?? undefined, fast };
      } catch (error) {
        if (isAbort(error, req)) {
          await this.meterAborted(req, plan, call, estimatedInput, fast, sentAt, true);
          throw new ModelAbortedError();
        }
        await this.handleAttemptError(error, req, scope, attempt, maxAttempts, call, state);
      }
    }
    throw new ModelUnavailableError(`No attempts left for route "${req.route}"`);
  }

  /** One stream for `runStructuredStream`: text deltas go to `args.onText`; usage is metered per stream. */
  private async streamCall(args: StreamCallArgs, req: CallContext, scope: string, plan: CallPlan): Promise<StreamCallResult> {
    const started = Date.now();
    const params: Anthropic.MessageCreateParamsNonStreaming = { ...plan.base, messages: args.messages.map(toParam) };
    const { stream, requestId, fast } = await this.openStream(params, req, scope, args.call, plan);
    const { resolution } = plan;
    const emitUsage = async (usage: TokenUsage, speed: Speed | undefined) => {
      const cost = meter(usage, resolution.modelId, { speed });
      await this.emit({ route: req.route, model: resolution.modelId, modelKey: resolution.modelKey, mode: "live", usage, cost, scope: req.scope, attribution: req.attribution, durationMs: Date.now() - started, occurredAt: new Date().toISOString(), requestId, attempt: args.call, streamed: true, ...(speed === "fast" ? { speed } : {}) });
      return cost;
    };
    let text = "";
    let callbackFailed = false;
    try {
      for await (const event of stream) {
        if (event.type !== "content_block_delta" || event.delta?.type !== "text_delta" || typeof event.delta.text !== "string") continue;
        text += event.delta.text;
        try {
          await args.onText(event.delta.text);
        } catch (error) {
          callbackFailed = true;
          throw error;
        }
      }
      const message = await stream.finalMessage();
      const usage = toUsage(message.usage);
      const speed = speedOf(message.usage, fast);
      const cost = await emitUsage(usage, speed);
      const finalText = message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      return { text: finalText || text, stopReason: (message.stop_reason ?? "end_turn") as StopReason, usage, cost, requestId, stopDetails: message.stop_details, ...(speed === "fast" ? { speed } : {}) };
    } catch (error) {
      stream.abort();
      // An interrupted stream is still billed for what it used: book the input and the output so far (Estimate).
      const snapshot = stream.currentMessage?.usage;
      let partial: { usage: TokenUsage; cost: MeterResult } | undefined;
      if (snapshot) {
        const usage = { ...toUsage(snapshot), outputTokens: Math.max(snapshot.output_tokens ?? 0, estimateTokens(text)) };
        partial = { usage, cost: await emitUsage(usage, fast ? "fast" : undefined) };
      } else if (!callbackFailed && isAbort(error, req)) {
        // Stopped before the stream said what it used: book the prompt (an Estimate), as a stopped `complete()` does.
        await this.meterAborted(req, plan, args.call, estimateInputTokens(params), fast, started, true);
      }
      if (callbackFailed) throw error;
      if (isAbort(error, req)) throw new ModelAbortedError();
      const billing = billingErrorFor(error, req.route, this.opts.billedTo ?? "credits");
      if (billing) {
        this.noteBilling(billing, req.route);
        throw billing;
      }
      if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        throw new ModelRequestError(`Anthropic request failed (${error.status}): ${error.message}`, error.status, error.type ?? null, { requestId: error.requestID });
      }
      throw new StreamInterruptedError(`stream interrupted after ${text.length} characters: ${error instanceof Error ? error.message : String(error)}`, text, partial?.usage, partial?.cost, error);
    }
  }

  /** The retry policy for one failed attempt: sleeps and returns to retry, or throws the typed error. */
  private async handleAttemptError(error: unknown, req: CallContext, scope: string, attempt: number, maxAttempts: number, call: number, state: AttemptState): Promise<void> {
    if (isAbort(error, req)) throw new ModelAbortedError();
    // The account cannot pay: neither standard speed nor waiting changes that, so it is final at once.
    const billing = billingErrorFor(error, req.route, this.opts.billedTo ?? "credits");
    if (billing) {
      this.noteBilling(billing, req.route);
      throw billing;
    }
    const last = attempt + 1 >= maxAttempts;
    if (state.fast && !last && error instanceof Anthropic.APIError && (error instanceof Anthropic.RateLimitError || error.status === 400 || error.status === 403 || error.status === 404)) {
      // Fast mode's own pool is exhausted, or the beta is not enabled for this key: standard speed now beats waiting.
      state.fast = false;
      this.opts.logger?.warn({ route: req.route, status: error.status, requestId: error.requestID }, "fast mode unavailable; retrying at standard speed");
      return;
    }
    if (error instanceof Anthropic.RateLimitError) {
      const parsed = parseRateLimitHeaders(error.headers);
      this.rateLimiter.observe(this.bucket(state.fast), parsed);
      const wait = this.rateLimiter.reportRateLimited(scope, { retryAfterMs: parsed.retryAfterMs });
      this.opts.logger?.warn({ route: req.route, scope, attempt, wait, requestId: error.requestID }, "429 from Anthropic; backing off this scope only");
      if (last) throw new ModelRateLimitError(`Rate limited after ${maxAttempts} attempts for route "${req.route}"`, scope, wait, { requestId: error.requestID, call });
      await this.sleep(wait);
      return;
    }
    if (error instanceof Anthropic.APIConnectionError || (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500)) {
      state.transient++;
      if (last) {
        throw new ModelUnavailableError(`Anthropic unavailable after ${maxAttempts} attempts for route "${req.route}": ${error.message}`, { status: error instanceof Anthropic.APIError ? error.status : undefined });
      }
      const wait = backoffWithJitter(state.transient - 1, { baseMs: 500, maxMs: 8000, random: this.opts.random });
      this.opts.logger?.warn({ route: req.route, attempt, wait, status: error instanceof Anthropic.APIError ? error.status : "connection" }, "transient Anthropic failure; retrying");
      await this.sleep(wait);
      return;
    }
    if (error instanceof Anthropic.APIError) {
      throw new ModelRequestError(`Anthropic request failed (${error.status ?? "?"}): ${error.message}`, error.status, error.type ?? null, { requestId: error.requestID });
    }
    throw error;
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
      // A key whose account cannot pay is valid but useless: storing it would stop the team at its first call.
      const billing = billingRefusal(error);
      if (billing) return { ok: false, reason: "billing", message: billing === "credit_balance" ? "The key works, but its Anthropic account has no credit left. Add credit in the Anthropic Console, then try again." : "The key works, but its Anthropic account has reached its spend limit. Raise the limit in the Anthropic Console, then try again." };
      if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: "permission", message: error.message };
      if (error instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limited", message: "The key is valid but currently rate limited; try again shortly." };
      if (error instanceof Anthropic.APIConnectionError) return { ok: false, reason: "network", message: error.message };
      return { ok: false, reason: "unknown", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * A call stopped (its signal aborted) after its request went out (review item 8): the provider reported no usage but
   * may still bill the prompt, so book the prompt's estimated input tokens and no output, flagged `aborted`. Like every
   * cost here it is an Estimate; here the token count is estimated too.
   */
  private async meterAborted(req: CallContext, plan: CallPlan, call: number, estimatedInput: number, fast: boolean, sentAt: number, streamed = false): Promise<void> {
    const usage: TokenUsage = { ...ZERO_USAGE, inputTokens: estimatedInput };
    const speed: Speed | undefined = fast ? "fast" : undefined;
    const { resolution } = plan;
    await this.emit({
      route: req.route,
      model: resolution.modelId,
      modelKey: resolution.modelKey,
      mode: "live",
      usage,
      cost: meter(usage, resolution.modelId, { speed }),
      scope: req.scope,
      attribution: req.attribution,
      durationMs: Date.now() - sentAt,
      occurredAt: new Date().toISOString(),
      attempt: call,
      aborted: true,
      ...(streamed ? { streamed: true } : {}),
      ...(speed ? { speed } : {}),
    });
  }

  /**
   * A billing refusal: an error log the operator's alerting can match (`alert: "model_billing"`, for the platform key),
   * and the process's platform billing state for /health (`platformBillingRefusal`). A business's own key is the
   * founder's to fund, so it only logs a warning.
   */
  private noteBilling(error: ModelBillingError, route: string): void {
    const fields = { route, reason: error.reason, status: error.status, billedTo: error.billedTo, rateLimitKey: this.rateLimitKey, requestId: (error.details as { requestId?: string } | undefined)?.requestId };
    if (error.billedTo === "byok") {
      this.opts.logger?.warn(fields, "Anthropic refused to bill a call on a business's own key; not retrying");
      return;
    }
    notePlatformBillingRefusal(error.reason, route);
    this.opts.logger?.error({ ...fields, alert: "model_billing" }, "Anthropic refused to bill a call on the platform key: add credit or raise the spend limit in the Anthropic Console");
  }

  /** A call on the platform key went through: whatever refused to bill before has been fixed. */
  private billed(): void {
    if ((this.opts.billedTo ?? "credits") === "credits") clearPlatformBillingRefusal();
  }

  private async emit(partial: Omit<UsageEvent, "billedTo">): Promise<void> {
    const event: UsageEvent = { ...partial, billedTo: this.opts.billedTo ?? "credits" };
    recordModelSpan(event);
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

const systemTexts = (system: CompleteRequest["system"]): string[] => (Array.isArray(system) ? [...system] : typeof system === "string" ? [system] : []);

/**
 * How a schema reaches the model. Structured outputs (`output_config.format`) need every object closed
 * (`additionalProperties: false`) and every value typed, and the SDK's `zodOutputFormat` silently rewrites what does
 * not fit: an open map (`z.record`, a loose object) becomes an object with no properties, so the grammar only lets the
 * model write `{}` there (PlanOutput's `params` would always arrive empty), and an untyped value (`z.unknown()`) makes
 * it throw. Such a schema is sent in the system prompt instead (`kind: "prompt"`): the model is asked for JSON only and
 * the reply goes through the same parse, validation and repair as any other.
 */
export type StructuredOutput =
  | { kind: "format"; format: Anthropic.JSONOutputFormat }
  | { kind: "prompt"; instruction: string; gaps: string[] };

const structuredOutputs = new WeakMap<z.ZodType, StructuredOutput>();

export function structuredOutputFor(schema: z.ZodType): StructuredOutput {
  let out = structuredOutputs.get(schema);
  if (!out) {
    out = describeStructuredOutput(schema);
    structuredOutputs.set(schema, out);
  }
  return out;
}

function describeStructuredOutput(schema: z.ZodType): StructuredOutput {
  let gaps: string[];
  try {
    gaps = grammarGaps(z.toJSONSchema(schema, { reused: "ref" }) as Record<string, unknown>);
  } catch (error) {
    gaps = [`(schema) ${error instanceof Error ? error.message : String(error)}`];
  }
  if (gaps.length === 0) {
    try {
      // Send the JSON schema only. `zodOutputFormat` also carries a `parse` function, and the SDK's MessageStream runs
      // it at message_stop and errors the stream when the output fails the schema: a streamed document with one bad
      // element (or truncated at max_tokens) would then look like a broken connection and be regenerated, instead of
      // reaching the element repair here. Validation and repair are this module's job (see the header).
      const { type, schema: jsonSchema } = zodOutputFormat(schema);
      return { kind: "format", format: { type, schema: jsonSchema } };
    } catch (error) {
      gaps = [`(format) ${error instanceof Error ? error.message : String(error)}`];
    }
  }
  const described = (() => {
    try {
      const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
      return JSON.stringify(rest);
    } catch {
      return "";
    }
  })();
  const instruction = [
    "## Response format",
    "Reply with one JSON object and nothing else: no prose before or after it, no code fences.",
    described ? `It must match this JSON Schema:\n${described}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { kind: "prompt", instruction, gaps };
}

/** Paths in a (zod-generated) JSON schema that structured outputs cannot express: open maps and untyped values. */
export function grammarGaps(root: Record<string, unknown>): string[] {
  const gaps: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const s = node as Record<string, unknown>;
    const composite = ["anyOf", "oneOf", "allOf"].some((k) => Array.isArray(s[k]));
    if (s.type === undefined && !composite && s.$ref === undefined && s.enum === undefined && s.const === undefined) gaps.push(`${path}: untyped value`);
    if (s.additionalProperties !== undefined && s.additionalProperties !== false) gaps.push(`${path}: open-ended object`);
    if (s.patternProperties !== undefined) gaps.push(`${path}: patternProperties`);
    for (const [k, v] of Object.entries((s.properties as Record<string, unknown> | undefined) ?? {})) walk(v, `${path}.${k}`);
    if (s.items !== undefined) walk(s.items, `${path}[]`);
    for (const k of ["anyOf", "oneOf", "allOf"]) for (const [i, v] of ((s[k] as unknown[] | undefined) ?? []).entries()) walk(v, `${path}|${i}`);
    for (const [k, v] of Object.entries((s.$defs as Record<string, unknown> | undefined) ?? {})) walk(v, `$defs.${k}`);
  };
  walk(root, "$");
  return gaps;
}

function buildSystem(system: CompleteRequest["system"], cache: boolean): Anthropic.TextBlockParam[] | undefined {
  const blocks = systemTexts(system).filter((s) => s.trim().length > 0);
  if (blocks.length === 0) return undefined;
  return blocks.map((text, i) => ({ type: "text", text, ...(cache && i === blocks.length - 1 ? { cache_control: { type: "ephemeral" } } : {}) }));
}

/** A message as the API takes it: images (vision routes only, checked by `assertImagesAllowed`) before the text. */
const toParam = (m: ChatMessage): Anthropic.MessageParam =>
  m.images?.length
    ? { role: m.role, content: [...m.images.map((img): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })), { type: "text", text: m.content }] }
    : { role: m.role, content: m.content };

/** The same plan with a larger `max_tokens` (the truncation retry); the limiter books the new budget too. */
function withMaxTokens(plan: CallPlan, maxTokens: number): CallPlan {
  return { ...plan, maxTokens, reserve: Math.max(plan.reserve, Math.min(maxTokens, plan.reserve * 2)), base: { ...plan.base, max_tokens: maxTokens } };
}

/** The prompt's input tokens, estimated locally (limiter reservations, and the booking of a call stopped in flight). */
const estimateInputTokens = (params: Pick<Anthropic.MessageCreateParamsNonStreaming, "messages" | "system">): number => {
  // An image counts as a screenshot's worth of tokens, not as the length of its base64.
  let images = 0;
  const messages = JSON.stringify(params.messages, (key, value: unknown) => {
    if (key === "source" && value && typeof value === "object" && (value as { type?: unknown }).type === "base64") {
      images += 1;
      return "<image>";
    }
    return value;
  });
  return estimateTokens(messages + JSON.stringify(params.system ?? "")) + images * IMAGE_TOKEN_ESTIMATE;
};

/** The caller stopped the call (its signal), whatever the SDK made of it. */
const isAbort = (error: unknown, req: Pick<CallContext, "signal">): boolean => req.signal?.aborted === true || error instanceof Anthropic.APIUserAbortError;

/**
 * Whether an API error is Anthropic refusing to bill the call, and why (`ModelBillingReason`): a 400 or 402 whose message
 * says the credit balance is too low or the account's usage limit is reached, or a 429 whose `error_code` (in the body's
 * `details`, or anywhere in the error) is `enforced_spend_limit_reached`. Anything else is not a billing refusal.
 */
export function billingRefusal(error: unknown): ModelBillingReason | null {
  if (!(error instanceof Anthropic.APIError) || typeof error.status !== "number") return null;
  const text = `${error.message} ${JSON.stringify(error.error ?? {})}`;
  if (error.status === 429) return /enforced_spend_limit_reached/i.test(text) ? "spend_limit" : null;
  if (error.status !== 400 && error.status !== 402) return null;
  if (/credit balance is too low/i.test(text)) return "credit_balance";
  if (/reached your specified (API )?usage limits?/i.test(text)) return "spend_limit";
  return error.status === 402 ? "credit_balance" : null;
}

function billingErrorFor(error: unknown, route: string, billedTo: BilledTo): ModelBillingError | null {
  const reason = billingRefusal(error);
  if (!reason || !(error instanceof Anthropic.APIError)) return null;
  const what = reason === "credit_balance" ? "the account's credit balance is too low" : "the account's spend limit is reached";
  const whose = billedTo === "byok" ? "the business's own key" : "the platform key";
  return new ModelBillingError(`Anthropic refused to bill route "${route}" on ${whose}: ${what} (${error.status})`, reason, billedTo, error.status, error.type ?? null, { requestId: error.requestID });
}

/** The speed that served a call: the response's `usage.speed` when present, else what was requested. */
function speedOf(usage: { speed?: string | null } | undefined, requestedFast: boolean): Speed | undefined {
  const reported = usage?.speed;
  if (reported === "fast") return "fast";
  if (reported === "standard") return undefined;
  return requestedFast ? "fast" : undefined;
}

function toUsage(u: Pick<Anthropic.Usage, "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens">): TokenUsage {
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
