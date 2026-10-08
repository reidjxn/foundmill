/**
 * Live client tests with an injected fetch: no network, but the real SDK request/response pipeline, structured output
 * parameters, header parsing, repair retry and error mapping are exercised end to end.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LiveModelClient, createModelClient, keyFingerprint, validateApiKey } from "./client";
import { ModelOutputError, ModelRateLimitError, ModelRequestError, ModelUnavailableError } from "./errors";
import { MockModelClient } from "./mock";
import { RateLimiter } from "./rate-limit";
import { MODELS } from "./routing";
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
    expect(calls[0]!.body.output_config).toBeUndefined();
  });

  it("throws a typed refusal / truncation error for schema requests instead of retrying", async () => {
    const refused = fakeFetch([() => message("I can't help with that.", { stopReason: "refusal" })]);
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch: refused.fetch, sleep: noSleep });
    const err = await client.complete({ route: "worker", messages: [{ role: "user", content: "go" }], schema: Note }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect((err as ModelOutputError).code).toBe("refusal");
    expect(refused.calls).toHaveLength(1);

    const truncated = fakeFetch([() => message('{"subject": "cut', { stopReason: "max_tokens" })]);
    const client2 = new LiveModelClient({ apiKey: "sk-ant-test", fetch: truncated.fetch, sleep: noSleep });
    const err2 = await client2.complete({ route: "worker", messages: [{ role: "user", content: "go" }], schema: Note, maxTokens: 50 }).catch((e: unknown) => e);
    expect((err2 as ModelOutputError).code).toBe("max_tokens");
    expect(truncated.calls).toHaveLength(1);
  });

  it("drops temperature for Opus/Sonnet 5.5 and keeps it for Haiku", async () => {
    const opus = fakeFetch([() => message("ok")]);
    const c1 = new LiveModelClient({ apiKey: "k", fetch: opus.fetch, sleep: noSleep });
    await c1.complete({ route: "worker", messages: [{ role: "user", content: "go" }], temperature: 0.2 });
    expect(opus.calls[0]!.body.temperature).toBeUndefined();

    const haiku = fakeFetch([() => message("ok", { model: MODELS.haiku })]);
    const c2 = new LiveModelClient({ apiKey: "k", fetch: haiku.fetch, sleep: noSleep });
    await c2.complete({ route: "classifier", messages: [{ role: "user", content: "go" }], temperature: 0.2, effort: "low" });
    expect(haiku.calls[0]!.body.temperature).toBe(0.2);
    expect(haiku.calls[0]!.body.model).toBe(MODELS.haiku);
    expect((haiku.calls[0]!.body.output_config as { effort: string }).effort).toBe("low");
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
