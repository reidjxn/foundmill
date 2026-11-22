/**
 * Live client tests with an injected fetch: no network, but the real SDK request/response pipeline, structured output
 * parameters, header parsing, repair retry and error mapping are exercised end to end.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LiveModelClient, MAX_TOKENS_CEILING, createModelClient, grammarGaps, keyFingerprint, structuredOutputFor, validateApiKey } from "./client";
import { ModelAbortedError, ModelBillingError, ModelOutputError, ModelRateLimitError, ModelRequestError, ModelUnavailableError, isModelBillingError } from "./errors";
import { clearPlatformBillingRefusal, platformBillingRefusal } from "./billing-state";
import { MockModelClient } from "./mock";
import { RateLimiter } from "./rate-limit";
import { MODELS, THINKING_MAX_TOKENS } from "./routing";
import { AgentReplyDraft, ComposerOutput, ConceptCard, FoundationsOutput, FoundationsSkeletonOutput, IdeationSlateOutput, LogoDesignOutput, PlanOutput, QuarantinedReaderOutput } from "./schemas";
import type { UsageEvent } from "./types";

interface Captured {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

type Handler = (req: Captured) => Response;

function fakeFetch(handlers: Handler[]) {
  const calls: Captured[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    const headers = Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined).entries());
    const captured = { url, body, headers };
    calls.push(captured);
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)] as Handler;
    return handler(captured);
  };
  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

const RL_HEADERS = {
  "anthropic-ratelimit-requests-limit": "1000",
  "anthropic-ratelimit-requests-remaining": "998",
  "anthropic-ratelimit-requests-reset": new Date(Date.now() + 60_000).toISOString(),
  "anthropic-ratelimit-input-tokens-limit": "2000000",
  "anthropic-ratelimit-input-tokens-remaining": "1990000",
  "anthropic-ratelimit-input-tokens-reset": new Date(Date.now() + 60_000).toISOString(),
  "anthropic-ratelimit-output-tokens-limit": "400000",
  "anthropic-ratelimit-output-tokens-remaining": "399000",
  "anthropic-ratelimit-output-tokens-reset": new Date(Date.now() + 60_000).toISOString(),
};

function message(text: string, opts: { stopReason?: string; usage?: Record<string, number>; headers?: Record<string, string>; model?: string } = {}): Response {
  const body = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: opts.model ?? MODELS.opus,
    content: [{ type: "text", text }],
    stop_reason: opts.stopReason ?? "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...opts.usage },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test_1", ...RL_HEADERS, ...opts.headers } });
}

function apiError(status: number, type: string, msg: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message: msg }, request_id: "req_err" }), { status, headers: { "content-type": "application/json", "request-id": "req_err", ...headers } });
}

const noSleep = async () => {};

/** Fake clock shared by the limiter and the client so backoff waits "pass" without real time. */
function clock() {
  let now = 1_700_000_000_000;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

const Note = z.object({ subject: z.string().min(1).max(80), body: z.string().min(10), tags: z.array(z.string()).min(1) });

describe("createModelClient", () => {
  it("returns the mock client in mock mode and requires a key in live mode", () => {
    expect(createModelClient({ mode: "mock" })).toBeInstanceOf(MockModelClient);
    expect(() => createModelClient({ mode: "live" })).toThrow(ModelRequestError);
    expect(createModelClient({ mode: "live", apiKey: "sk-ant-test" })).toBeInstanceOf(LiveModelClient);
  });

  it("defaults to the environment's MODEL_MODE (mock in tests)", () => {
    expect(createModelClient().mode).toBe("mock");
  });

  it("fingerprints keys instead of exposing them", () => {
    const fp = keyFingerprint("sk-ant-secret");
    expect(fp).toMatch(/^key:[0-9a-f]{12}$/);
    expect(fp).not.toContain("secret");
  });
});

describe("LiveModelClient.complete", () => {
  it("sends structured output config, cache_control on the system block, parses JSON and meters usage", async () => {
    const payload = { subject: "Priya shipped the landing page", body: "The page is live and the tests pass, nothing needed.", tags: ["update"] };
    const { fetch, calls } = fakeFetch([() => message(JSON.stringify(payload), { usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000 } })]);
    const events: UsageEvent[] = [];
    const limiter = new RateLimiter({ sleep: noSleep });
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep, rateLimiter: limiter, onUsage: (e) => void events.push(e) });

    const result = await client.complete({
      route: "inboxComposer",
      system: ["House rules block", "Business brief block"],
      messages: [{ role: "user", content: "Write the note." }],
      schema: Note,
      cacheSystem: true,
      maxTokens: 2000,
      scope: "session-1",
      attribution: { businessId: "b1" },
    });
    expect(events[0]!.billedTo).toBe("credits"); // the default: a client on the platform key

    expect(result.json).toEqual(payload);
    expect(result.model).toBe(MODELS.opus);
    expect(result.stopReason).toBe("end_turn");
    expect(result.repaired).toBe(false);
    expect(result.requestId).toBe("req_test_1");
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 4000 });
    // $4/MTok × 1000 + $20/MTok × 100 + $0.20/MTok × 4000 = 0.4 + 0.2 + 0.08 cents
    expect(result.cost.costMinor).toBeCloseTo(0.68, 9);
    expect(result.cost.breakdown).toEqual({ input: 0.4, output: 0.2, cacheWrite: 0, cacheRead: 0.08 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: "inboxComposer", mode: "live", scope: "session-1", attribution: { businessId: "b1" }, attempt: 0 });

    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body.model).toBe(MODELS.opus);
    expect(body.max_tokens).toBe(2000);
    expect(body.system).toEqual([
      { type: "text", text: "House rules block" },
      { type: "text", text: "Business brief block", cache_control: { type: "ephemeral" } },
    ]);
    const outputConfig = body.output_config as { format: { type: string; schema: Record<string, unknown> } };
    expect(outputConfig.format.type).toBe("json_schema");
    expect(outputConfig.format.schema.type).toBe("object");
    expect(Object.keys(outputConfig.format.schema.properties as object)).toEqual(["subject", "body", "tags"]);
    expect(body.temperature).toBeUndefined();
    expect(calls[0]!.headers["x-api-key"]).toBe("sk-ant-test");

    // rate limits learnt from the response headers
    expect(limiter.snapshot(client.rateLimitKey)?.requests.limit).toBe(1000);
    expect(limiter.snapshot(client.rateLimitKey)?.inputTokens.limit).toBe(2_000_000);
  });

  it("sends a schema with an open-ended map (PlanOutput.params) in the system prompt, not as a grammar that only allows {}", async () => {
    const plan = { summary: "Pause Meta and move €300 to Google.", actions: [{ type: "disable_channel", params: { channel: "meta_ads" }, agent_id: null }, { type: "set_budget", params: { channel: "google_ads", amount_minor: 30_000, currency: "EUR" }, agent_id: null }] };
    const { fetch, calls } = fakeFetch([() => message(JSON.stringify(plan))]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });

    const result = await client.complete({ route: "planCompiler", schema: PlanOutput, system: ["House rules block", "You are the plan compiler."], cacheSystem: true, messages: [{ role: "user", content: "Pause Meta ads and put €300 on Google." }] });

    expect(result.json.actions.map((a) => a.params)).toEqual([{ channel: "meta_ads" }, { channel: "google_ads", amount_minor: 30_000, currency: "EUR" }]);
    const body = calls[0]!.body;
    // No output_config.format: the SDK's rewrite would close `params` to an object with no properties. Only the route's
    // low effort (founder, 2026-10-15) rides in output_config.
    expect(body.output_config).toEqual({ effort: "low" });
    const system = body.system as { type: string; text: string; cache_control?: unknown }[];
    expect(system.map((b) => b.text.split("\n")[0])).toEqual(["House rules block", "You are the plan compiler.", "## Response format"]);
    // The breakpoint moves to the last block, so the whole system (format block included) stays one cached prefix.
    expect(system.map((b) => b.cache_control ?? null)).toEqual([null, null, { type: "ephemeral" }]);
    const described = JSON.parse(system[2]!.text.split("It must match this JSON Schema:\n")[1]!) as { properties: Record<string, unknown> };
    expect(Object.keys(described.properties)).toEqual(["summary", "actions"]);
    expect(JSON.stringify(described)).toContain('"params":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}');
    expect(body.model).toBe(MODELS.opus);
    // No maxTokens on the request: the route's budget, sized for the JSON plus Opus 5.5's thinking (audit CML-03).
    expect(body.max_tokens).toBe(THINKING_MAX_TOKENS);
  });

  it("a numbered cacheSystem puts the one breakpoint on that block, so the blocks after it change freely (WP-09 T9)", async () => {
    const { fetch, calls } = fakeFetch([() => message("Done.")]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });
    await client.complete({ route: "chiefOfStaff", system: ["The agent's prompt", "## Training\nThis test"], cacheSystem: 0, messages: [{ role: "user", content: "Go." }] });
    const system = calls[0]!.body.system as { cache_control?: unknown }[];
    expect(system.map((b) => b.cache_control ?? null)).toEqual([{ type: "ephemeral" }, null]);
  });

  it("keeps every closed route schema on structured outputs; only open maps and untyped values go to the prompt", () => {
    expect(structuredOutputFor(PlanOutput)).toMatchObject({ kind: "prompt", gaps: ["$defs.__schema0.params: open-ended object"] });
    expect(structuredOutputFor(QuarantinedReaderOutput)).toMatchObject({ kind: "prompt", gaps: ["$: open-ended object"] });
    for (const schema of [ComposerOutput, ConceptCard, IdeationSlateOutput, LogoDesignOutput, FoundationsSkeletonOutput, FoundationsOutput, AgentReplyDraft, Note]) {
      const out = structuredOutputFor(schema);
      expect(out.kind).toBe("format");
      if (out.kind === "format") expect(out.format.schema.additionalProperties).toBe(false);
    }
    expect(grammarGaps(z.toJSONSchema(z.object({ a: z.unknown(), b: z.looseObject({ x: z.string() }), c: z.string().nullable() })) as Record<string, unknown>)).toEqual(["$.a: untyped value", "$.b: open-ended object"]);
  });

  it("repairs invalid JSON once by quoting the validation issues back, then succeeds", async () => {
    const bad = JSON.stringify({ subject: "", body: "short", tags: [] });
    const good = JSON.stringify({ subject: "Fixed", body: "This body is long enough now.", tags: ["ok"] });
    const { fetch, calls } = fakeFetch([() => message(bad), () => message(good)]);
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep, onUsage: (e) => void events.push(e) });

    const result = await client.complete({ route: "planCompiler", system: "s", messages: [{ role: "user", content: "go" }], schema: Note });
    expect(result.repaired).toBe(true);
    expect(result.json?.subject).toBe("Fixed");
    expect(calls).toHaveLength(2);
    const repairMessages = calls[1]!.body.messages as Array<{ role: string; content: string }>;
    expect(repairMessages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(repairMessages[1]!.content).toBe(bad);
    expect(repairMessages[2]!.content).toMatch(/subject/);
    expect(repairMessages[2]!.content).toMatch(/Return ONLY the corrected JSON/);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.attempt)).toEqual([0, 1]);
    expect(result.usage.inputTokens).toBe(240); // both calls metered
  });

  it("a conversation reply with an out-of-set reaction or quick reply kind costs one call, not a repair (the draft takes any string)", async () => {
    const reply = { bubbles: ["Sure."], reaction: "excited", quick_replies: [{ id: "more", label: "Tell me more", say: "Tell me more.", kind: "suggest", option_id: null, recommended: false }], hand_off: null, refers_to: [] };
    const { fetch, calls } = fakeFetch([() => message(JSON.stringify(reply))]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });
    const result = await client.complete({ route: "conversation", messages: [{ role: "user", content: "go" }], schema: AgentReplyDraft });
    expect(calls).toHaveLength(1);
    expect(result.repaired).toBe(false);
    expect(result.json.reaction).toBe("excited");
    // The allowed values still reach the model, in the descriptions.
    const format = JSON.stringify(calls[0]!.body.output_config ?? calls[0]!.body);
    expect(format).toContain("one of none, noted, thinking, concerned, pleased");
    expect(format).toContain("One of ask, acknowledge, hand_off, choose_option, decline, write");
  });

  it("gives up after one repair with a ModelOutputError carrying the issues", async () => {
    const bad = JSON.stringify({ subject: "", body: "short", tags: [] });
    const { fetch, calls } = fakeFetch([() => message(bad)]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });
    const err = await client.complete({ route: "planCompiler", messages: [{ role: "user", content: "go" }], schema: Note }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect((err as ModelOutputError).code).toBe("invalid_output");
    expect(calls).toHaveLength(2);
  });

  it("extracts JSON from prose or fences without a repair call", async () => {
    const good = { subject: "Ok", body: "Long enough body text here.", tags: ["a"] };
    const { fetch, calls } = fakeFetch([() => message(`Here you go:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``)]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });
    const result = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }], schema: Note });
    expect(result.json).toEqual(good);
    expect(result.repaired).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("returns plain text (no json) when no schema is given and keeps the stop reason", async () => {
    const { fetch, calls } = fakeFetch([() => message("Just prose.", { stopReason: "max_tokens", model: MODELS.sonnet })]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });
    const result = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }] });
    expect(result.text).toBe("Just prose.");
    expect(result.json).toBeUndefined();
    expect(result.stopReason).toBe("max_tokens");
    // The route's effort is written down (WP-09 T6 step 1): `worker` sends Sonnet 5.5's own default, `high`.
    expect(calls[0]!.body.output_config).toEqual({ effort: "high" });
  });

  it("throws a typed refusal error for schema requests instead of retrying", async () => {
    const refused = fakeFetch([() => message("I can't help with that.", { stopReason: "refusal" })]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch: refused.fetch, sleep: noSleep });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }], schema: Note }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect((err as ModelOutputError).code).toBe("refusal");
    expect(refused.calls).toHaveLength(1);
  });

  it("retries a truncated schema answer once with twice the budget, then gives up with max_tokens", async () => {
    const truncated = fakeFetch([() => message('{"subject": "cut', { stopReason: "max_tokens" })]);
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch: truncated.fetch, sleep: noSleep, onUsage: (e) => void events.push(e) });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }], schema: Note, maxTokens: 50 }).catch((e: unknown) => e);
    expect((err as ModelOutputError).code).toBe("max_tokens");
    expect((err as ModelOutputError).message).toMatch(/max_tokens=100/);
    expect(truncated.calls.map((c) => c.body.max_tokens)).toEqual([50, 100]);
    // The retry asks the same question again (no repair turn quoting the cut-off JSON) and both calls are metered.
    expect(truncated.calls[1]!.body.messages as unknown[]).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  it("a route-sized Opus call cut off by its thinking succeeds on the retry at the larger budget", async () => {
    const good = JSON.stringify({ subject: "Plan ready", body: "Eight tasks, two of them hard, all with tests.", tags: ["plan"] });
    const { fetch, calls } = fakeFetch([() => message('{"subject": "Plan ready", "body": "Eight ta', { stopReason: "max_tokens", usage: { output_tokens: THINKING_MAX_TOKENS } }), () => message(good)]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });
    const result = await client.complete({ route: "planner", messages: [{ role: "user", content: "plan it" }], schema: Note });
    expect(result.json?.subject).toBe("Plan ready");
    expect(result.repaired).toBe(false);
    expect(calls.map((c) => c.body.max_tokens)).toEqual([THINKING_MAX_TOKENS, MAX_TOKENS_CEILING]);
    expect(result.usage.outputTokens).toBe(THINKING_MAX_TOKENS + 30);
  });

  it("does not raise a budget that is already at the ceiling", async () => {
    const truncated = fakeFetch([() => message('{"subject": "cut', { stopReason: "max_tokens" })]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch: truncated.fetch, sleep: noSleep });
    const err = await client.complete({ route: "planner", messages: [{ role: "user", content: "go" }], schema: Note, maxTokens: MAX_TOKENS_CEILING }).catch((e: unknown) => e);
    expect((err as ModelOutputError).code).toBe("max_tokens");
    expect(truncated.calls).toHaveLength(1);
  });

  it("sends each route's budget when the request has none: every route leaves room for thinking, Haiku 5.5's included", async () => {
    const sent: Record<string, unknown> = {};
    for (const route of ["planner", "chiefOfStaff", "departmentLead", "inboxComposer", "conversation", "classifier"] as const) {
      const { fetch, calls } = fakeFetch([() => message("ok", { model: route === "classifier" ? MODELS.haiku : MODELS.opus })]);
      const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep });
      await client.complete({ route, messages: [{ role: "user", content: "go" }] });
      sent[route] = calls[0]!.body.max_tokens;
    }
    expect(sent).toEqual({ planner: 16_000, chiefOfStaff: 16_000, departmentLead: 16_000, inboxComposer: 16_000, conversation: 8_000, classifier: 16_000 });
  });

  it("drops temperature on every Anthropic 5.5 model and sends Haiku 5.5 its effort", async () => {
    const opus = fakeFetch([() => message("ok")]);
    const c1 = new LiveModelClient({ apiKey: "k", fetch: opus.fetch, sleep: noSleep });
    await c1.complete({ route: "worker", messages: [{ role: "user", content: "go" }], temperature: 0.2 });
    expect(opus.calls[0]!.body.temperature).toBeUndefined();

    const haiku = fakeFetch([() => message("ok", { model: MODELS.haiku })]);
    const c2 = new LiveModelClient({ apiKey: "k", fetch: haiku.fetch, sleep: noSleep });
    await c2.complete({ route: "classifier", messages: [{ role: "user", content: "go" }], temperature: 0.2, effort: "low" });
    // Haiku 5.5 refuses non-default sampling parameters (400) and takes effort (WP-13, taking WP-09 T4).
    expect(haiku.calls[0]!.body.temperature).toBeUndefined();
    expect(haiku.calls[0]!.body.model).toBe(MODELS.haiku);
    expect(haiku.calls[0]!.body.output_config).toEqual({ effort: "low" });
  });

  it("honours locked routes and surfaces the warning", async () => {
    const { fetch, calls } = fakeFetch([() => message("ok")]);
    const warnings: unknown[] = [];
    const logger = { debug() {}, info() {}, warn(obj: unknown, msg?: string) { warnings.push(msg); }, error() {} };
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, logger });
    const r = await client.complete({ route: "inboxComposer", modelOverride: "haiku", messages: [{ role: "user", content: "go" }] });
    expect(calls[0]!.body.model).toBe(MODELS.opus);
    expect(r.warning).toMatch(/locked/);
    expect(warnings).toHaveLength(1);
  });

  it("backs off on 429 for the caller's scope only, then succeeds", async () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    const { fetch, calls } = fakeFetch([
      () => apiError(429, "rate_limit_error", "slow down", { "retry-after": "2", "anthropic-ratelimit-requests-limit": "50", "anthropic-ratelimit-requests-remaining": "49", "anthropic-ratelimit-requests-reset": retryAt }),
      () => message("ok"),
    ]);
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep, random: () => 0 });
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: c.sleep, rateLimiter: limiter, random: () => 0 });

    const before = Date.now();
    const result = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }], scope: "session-a" });
    expect(result.text).toBe("ok");
    expect(calls).toHaveLength(2);
    // The client slept exactly once, for the retry-after (2 s). The limiter learnt limits from the 429 headers first and
    // then from the success response; the most recent observation wins.
    expect(c.sleeps).toEqual([2000]);
    expect(limiter.snapshot(client.rateLimitKey)?.requests.limit).toBe(1000);
    expect(limiter.snapshot(client.rateLimitKey)?.requests.remaining).toBeLessThanOrEqual(998);
    // Another scope was never penalised; the successful call cleared this scope's penalty.
    expect(limiter.penaltyFor("session-b")).toBe(0);
    expect(limiter.penaltyFor("session-a")).toBe(0);
    expect(Date.now() - before).toBeLessThan(1500);
  });

  it("gives up with ModelRateLimitError after maxAttempts 429s", async () => {
    const { fetch, calls } = fakeFetch([() => apiError(429, "rate_limit_error", "slow down")]);
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep, random: () => 0.5 });
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: c.sleep, rateLimiter: limiter, maxAttempts: 3, random: () => 0.5 });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }], scope: "s" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelRateLimitError);
    expect((err as ModelRateLimitError).scope).toBe("s");
    expect(calls).toHaveLength(3);
    expect(c.sleeps).toEqual([500, 1000]); // exponential: 0.5 × 1000, 0.5 × 2000; the third 429 gives up
    expect(limiter.penalty("s")?.attempts).toBe(3);
  });

  it("retries 5xx/529 with short backoff and then fails with ModelUnavailableError", async () => {
    const ok = fakeFetch([() => apiError(529, "overloaded_error", "busy"), () => apiError(500, "api_error", "oops"), () => message("ok")]);
    const c1 = new LiveModelClient({ apiKey: "k", fetch: ok.fetch, sleep: noSleep, random: () => 0 });
    expect((await c1.complete({ route: "worker", messages: [{ role: "user", content: "go" }] })).text).toBe("ok");
    expect(ok.calls).toHaveLength(3);

    const down = fakeFetch([() => apiError(500, "api_error", "oops")]);
    const c2 = new LiveModelClient({ apiKey: "k", fetch: down.fetch, sleep: noSleep, maxAttempts: 2, random: () => 0 });
    await expect(c2.complete({ route: "worker", messages: [{ role: "user", content: "go" }] })).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(down.calls).toHaveLength(2);
  });

  it("maps 4xx to ModelRequestError without retrying", async () => {
    const { fetch, calls } = fakeFetch([() => apiError(401, "authentication_error", "bad key")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelRequestError);
    expect((err as ModelRequestError).status).toBe(401);
    expect((err as ModelRequestError).code).toBe("auth");
    expect(calls).toHaveLength(1);
  });
});

describe("billing refusals (audit BILL-06, CML-07)", () => {
  const billingError = (status: number, type: string, msg: string, details?: Record<string, unknown>) =>
    new Response(JSON.stringify({ type: "error", error: { type, message: msg, ...(details ? { details } : {}) }, request_id: "req_bill" }), { status, headers: { "content-type": "application/json", "request-id": "req_bill" } });

  it("an empty credit balance (400) is a ModelBillingError, sent once", async () => {
    const { fetch, calls } = fakeFetch([() => billingError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.")]);
    const c = clock();
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: c.sleep });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelBillingError);
    expect(err).toBeInstanceOf(ModelRequestError);
    expect(err).toMatchObject({ code: "billing", reason: "credit_balance", status: 400, retryable: false });
    expect(isModelBillingError(err)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(c.sleeps).toEqual([]);
  });

  it("the tier's spend cap (429 enforced_spend_limit_reached) is never retried as a rate limit", async () => {
    const { fetch, calls } = fakeFetch([() => billingError(429, "rate_limit_error", "You have reached your monthly spend limit.", { error_code: "enforced_spend_limit_reached" })]);
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep, random: () => 0.5 });
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: c.sleep, rateLimiter: limiter, random: () => 0.5 });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }], scope: "s" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelBillingError);
    expect(err).toMatchObject({ reason: "spend_limit", status: 429 });
    expect(calls).toHaveLength(1);
    expect(c.sleeps).toEqual([]);
    expect(limiter.penalty("s")).toBeUndefined();
  });

  it("the Console's own usage limit (400) is a spend limit; any other 400 stays a plain request error", async () => {
    const limit = fakeFetch([() => billingError(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.")]);
    const e1 = await new LiveModelClient({ apiKey: "k", fetch: limit.fetch, sleep: noSleep }).complete({ route: "worker", messages: [{ role: "user", content: "go" }] }).catch((e: unknown) => e);
    expect(e1).toMatchObject({ name: "ModelBillingError", reason: "spend_limit" });
    const other = fakeFetch([() => billingError(400, "invalid_request_error", "messages: at least one message is required")]);
    const e2 = await new LiveModelClient({ apiKey: "k", fetch: other.fetch, sleep: noSleep }).complete({ route: "worker", messages: [{ role: "user", content: "go" }] }).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(ModelRequestError);
    expect(e2).not.toBeInstanceOf(ModelBillingError);
    expect((e2 as ModelRequestError).code).toBe("request");
  });

  it("fast mode does not retry a billing refusal at standard speed", async () => {
    const { fetch, calls } = fakeFetch([() => billingError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, fastMode: true });
    const err = await client.complete({ route: "ideation", messages: [{ role: "user", content: "go" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelBillingError);
    expect(calls).toHaveLength(1);
  });

  it("a streamed call refused for billing fails with the same error", async () => {
    const { fetch } = fakeFetch([() => billingError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep });
    const err = await client.streamStructured({ route: "ideationSlate", messages: [{ role: "user", content: "go" }], schema: z.object({ items: z.array(z.string()) }), elementPath: "items", elementSchema: z.string() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelBillingError);
  });

  it("a platform-key refusal alerts the operator and shows on the process's billing state until a call is billed again", async () => {
    clearPlatformBillingRefusal();
    const errors: { obj: Record<string, unknown>; msg: string }[] = [];
    const logger = { debug() {}, info() {}, warn() {}, error: (obj: Record<string, unknown>, msg: string) => errors.push({ obj, msg }) };
    const { fetch } = fakeFetch([() => billingError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."), () => message("ok")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, logger });
    const err = await client.complete({ route: "chiefOfStaff", messages: [{ role: "user", content: "go" }] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ billedTo: "credits" });
    expect(errors[0]?.obj).toMatchObject({ alert: "model_billing", reason: "credit_balance", billedTo: "credits", route: "chiefOfStaff" });
    expect(platformBillingRefusal()).toMatchObject({ reason: "credit_balance", route: "chiefOfStaff", count: 1 });
    await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }] });
    expect(platformBillingRefusal()).toBeNull();
  });

  it("a business's own key that cannot pay is the founder's to fund: no operator alert, no platform state", async () => {
    clearPlatformBillingRefusal();
    const errors: unknown[] = [];
    const logger = { debug() {}, info() {}, warn() {}, error: (obj: unknown) => errors.push(obj) };
    const { fetch } = fakeFetch([() => billingError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, logger, billedTo: "byok" });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "ModelBillingError", billedTo: "byok" });
    expect(errors).toEqual([]);
    expect(platformBillingRefusal()).toBeNull();
  });

  it("validateApiKey reports a key whose account cannot pay", async () => {
    const { fetch } = fakeFetch([() => billingError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")]);
    const result = await validateApiKey("sk-ant-unfunded", { mode: "live", fetch });
    expect(result).toMatchObject({ ok: false, reason: "billing", message: expect.stringMatching(/no credit left/) });
  });
});

describe("validateApiKey (BUILD §10.2)", () => {
  it("validates with a minimal Haiku call and reports the learnt limits", async () => {
    const { fetch, calls } = fakeFetch([() => message("", { model: MODELS.haiku })]);
    const result = await validateApiKey("sk-ant-live", { mode: "live", fetch });
    expect(result.ok).toBe(true);
    expect(result.limits).toEqual({ requestsPerMinute: 1000, inputTokensPerMinute: 2_000_000, outputTokensPerMinute: 400_000 });
    expect(calls[0]!.body.model).toBe(MODELS.haiku);
    expect(calls[0]!.body.max_tokens).toBe(1);
  });

  it("reports an invalid key without throwing", async () => {
    const { fetch } = fakeFetch([() => apiError(401, "authentication_error", "nope")]);
    const result = await validateApiKey("sk-ant-bad", { mode: "live", fetch });
    expect(result).toMatchObject({ ok: false, reason: "invalid_key" });
  });

  it("needs no network in mock mode", async () => {
    expect((await validateApiKey("anything", { mode: "mock" })).ok).toBe(true);
    expect((await validateApiKey("   ", { mode: "mock" })).ok).toBe(false);
  });
});

describe("effectiveModelMode", () => {
  it("runs live only with a key, and logs once when live has none", async () => {
    const { effectiveModelMode } = await import("./client");
    const errors: unknown[] = [];
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: (o: unknown, m?: string) => errors.push(m) };
    expect(effectiveModelMode("live", "sk-ant-x", logger)).toBe("live");
    expect(effectiveModelMode("mock", undefined, logger)).toBe("mock");
    expect(effectiveModelMode("live", undefined, logger)).toBe("mock");
    expect(effectiveModelMode("live", "", logger)).toBe("mock");
    expect(errors).toHaveLength(2);
  });
});

describe("LiveModelClient: a stopped call is still metered (review item 8)", () => {
  /** A transport that accepts the request and never answers until the call's signal aborts it. */
  function hangingFetch() {
    const sent: string[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      sent.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const fail = () => reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      });
    };
    return { fetch: fetchImpl as unknown as typeof globalThis.fetch, sent };
  }

  const PROMPT = "Draft the vision for a bookkeeping business. ".repeat(100);

  it("books the prompt's estimated input tokens, no output, as an Estimate flagged aborted, with the call's attribution", async () => {
    const { fetch, sent } = hangingFetch();
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep, onUsage: (e) => void events.push(e) });
    const stop = new AbortController();
    const call = client.complete({ route: "conversation", system: "House rules", messages: [{ role: "user", content: PROMPT }], signal: stop.signal, scope: "s1", attribution: { businessId: "b-1", agentId: "a-1", kind: "conversation" } });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    stop.abort();
    await expect(call).rejects.toBeInstanceOf(ModelAbortedError);

    expect(sent).toHaveLength(1);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e).toMatchObject({ route: "conversation", model: MODELS.sonnet, mode: "live", aborted: true, attempt: 0, scope: "s1", attribution: { businessId: "b-1", agentId: "a-1", kind: "conversation" } });
    // About four characters per token over the messages and the system prompt; nothing was written back.
    expect(e.usage.inputTokens).toBeGreaterThanOrEqual(Math.floor(PROMPT.length / 4));
    expect(e.usage).toMatchObject({ outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect(e.cost).toMatchObject({ label: "Estimate", currency: "USD" });
    expect(e.cost.costMicroMinor).toBeGreaterThan(0);
  });

  it("a call stopped before it was sent books nothing", async () => {
    const { fetch, sent } = hangingFetch();
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep, onUsage: (e) => void events.push(e) });
    const stop = new AbortController();
    stop.abort();
    await expect(client.complete({ route: "conversation", messages: [{ role: "user", content: PROMPT }], signal: stop.signal })).rejects.toBeInstanceOf(ModelAbortedError);
    expect(sent).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("a call that answers is booked once, from the provider's usage, without the aborted flag", async () => {
    const { fetch } = fakeFetch([() => message("plain answer", { usage: { input_tokens: 900, output_tokens: 40 } })]);
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: noSleep, onUsage: (e) => void events.push(e) });
    await client.complete({ route: "conversation", messages: [{ role: "user", content: PROMPT }], signal: new AbortController().signal });
    expect(events).toHaveLength(1);
    expect(events[0]!.usage).toMatchObject({ inputTokens: 900, outputTokens: 40 });
    expect(events[0]!.aborted).toBeUndefined();
  });
});
