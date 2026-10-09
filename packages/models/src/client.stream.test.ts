/**
 * Live client: per-route effort and fast mode, the limiter reservation, and `streamStructured` over real SSE responses
 * from an injected fetch (the SDK's own stream parser runs; no network).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LiveModelClient } from "./client";
import { ModelRateLimitError } from "./errors";
import { FAST_MODE_PRICING, MODEL_PRICING } from "./pricing";
import { RateLimiter } from "./rate-limit";
import { FAST_MODE_BETA, MODELS } from "./routing";
import type { UsageEvent } from "./types";

interface Captured {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function fakeFetch(handlers: ((req: Captured) => Response)[]) {
  const calls: Captured[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    const headers = Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined).entries());
    const captured = { url, body, headers };
    calls.push(captured);
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)] as (req: Captured) => Response;
    return handler(captured);
  };
  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

const noSleep = async () => {};

function message(text: string, opts: { usage?: Record<string, unknown>; headers?: Record<string, string> } = {}): Response {
  const body = { id: "msg_1", type: "message", role: "assistant", model: MODELS.opus, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...opts.usage } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1", ...opts.headers } });
}

function apiError(status: number, type: string, msg: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message: msg } }), { status, headers: { "content-type": "application/json", "request-id": "req_err", ...headers } });
}

const sseEvent = (e: { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

interface StreamPlan {
  /** Text deltas, in order. */
  deltas: string[];
  stopReason?: string;
  outputTokens?: number;
  speed?: "fast" | "standard";
  /** Send an `overloaded_error` SSE event after this many deltas instead of finishing. */
  errorAfter?: number;
}

function sseParts(plan: StreamPlan): string[] {
  const start = sseEvent({ type: "message_start", message: { id: "msg_s", type: "message", role: "assistant", model: MODELS.opus, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...(plan.speed ? { speed: plan.speed } : {}) } } } as { type: string });
  const blockStart = sseEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } as { type: string });
  const deltas = plan.deltas.slice(0, plan.errorAfter ?? plan.deltas.length).map((text) => sseEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } as { type: string }));
  if (plan.errorAfter !== undefined) return [start + blockStart, ...deltas, sseEvent({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } } as { type: string })];
  const end = sseEvent({ type: "content_block_stop", index: 0 } as { type: string }) + sseEvent({ type: "message_delta", delta: { stop_reason: plan.stopReason ?? "end_turn", stop_sequence: null }, usage: { output_tokens: plan.outputTokens ?? 500 } } as { type: string }) + sseEvent({ type: "message_stop" });
  return [start + blockStart, ...deltas, end];
}

/** An SSE response; `gates[i]` (when given) is awaited before part i is sent, so a test can hold the stream open. */
function sseResponse(plan: StreamPlan, gates: (Promise<unknown> | undefined)[] = []): Response {
  const parts = sseParts(plan);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [i, part] of parts.entries()) {
        await gates[i];
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_stream" } });
}

/** Split text into pieces of `size` characters. */
const pieces = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));

const Card = z.object({ name: z.string().min(1), score: z.number().int().min(1).max(5) });
const Cards = z.object({ concepts: z.array(Card).min(2).max(6) });
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Card ${i}`, score: (i % 5) + 1 }));

describe("per-route effort and fast mode", () => {
  it("applies the route's effort, lets the request override it, and leaves effortless routes alone", async () => {
    const { fetch, calls } = fakeFetch([() => message("ok")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep });
    const ask = (route: "ideation" | "planner" | "foundations" | "logoDesigner" | "inboxComposer", effort?: "high") => client.complete({ route, messages: [{ role: "user", content: "go" }], ...(effort ? { effort } : {}) });
    const r = await ask("ideation");
    await ask("planner");
    await ask("ideation", "high");
    await ask("foundations");
    await ask("logoDesigner");
    await ask("inboxComposer");
    expect(calls.map((c) => (c.body.output_config as { effort?: string } | undefined)?.effort)).toEqual(["low", undefined, "high", "low", "low", undefined]);
    expect(r.effort).toBe("low");
    // Fast mode is off unless the client opts in: standard endpoint, no speed, no beta header.
    for (const c of calls) {
      expect(c.url).not.toContain("beta=true");
      expect(c.body.speed).toBeUndefined();
      expect(c.headers["anthropic-beta"]).toBeUndefined();
    }
  });

  it("sends speed: fast with the beta header on fast routes only when fastMode is on, and meters at the fast price", async () => {
    const { fetch, calls } = fakeFetch([() => message("ok", { usage: { speed: "fast", input_tokens: 1000, output_tokens: 1000 } }), () => message("ok", { usage: { input_tokens: 1000, output_tokens: 1000 } })]);
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, fastMode: true, onUsage: (e) => void events.push(e) });
    const fast = await client.complete({ route: "ideation", messages: [{ role: "user", content: "go" }] });
    const standard = await client.complete({ route: "planner", messages: [{ role: "user", content: "go" }] });
    expect(calls[0]!.url).toContain("/v1/messages?beta=true");
    expect(calls[0]!.body.speed).toBe("fast");
    expect(calls[0]!.headers["anthropic-beta"]).toContain(FAST_MODE_BETA);
    expect(calls[0]!.body.betas).toBeUndefined();
    expect((calls[0]!.body.output_config as { effort: string }).effort).toBe("low");
    expect(calls[1]!.url).not.toContain("beta=true");
    expect(calls[1]!.body.speed).toBeUndefined();
    expect(fast.speed).toBe("fast");
    expect(standard.speed).toBeUndefined();
    const fastPrice = FAST_MODE_PRICING[MODELS.opus]!;
    const stdPrice = MODEL_PRICING[MODELS.opus];
    expect(fast.cost.costMinor).toBeCloseTo((fastPrice.inputPerMTok + fastPrice.outputPerMTok) * 100 * 1000 / 1_000_000, 9);
    expect(standard.cost.costMinor).toBeCloseTo((stdPrice.inputPerMTok + stdPrice.outputPerMTok) * 100 * 1000 / 1_000_000, 9);
    expect(fast.cost.fast).toBe(true);
    expect(events.map((e) => e.speed)).toEqual(["fast", undefined]);
  });

  it("falls back to standard speed at once when fast mode is rate limited", async () => {
    const sleeps: number[] = [];
    const { fetch, calls } = fakeFetch([() => apiError(429, "rate_limit_error", "fast pool exhausted", { "retry-after": "30" }), () => message("ok")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, fastMode: true, sleep: async (ms) => void sleeps.push(ms) });
    const r = await client.complete({ route: "foundations", messages: [{ role: "user", content: "go" }] });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.speed).toBe("fast");
    expect(calls[1]!.body.speed).toBeUndefined();
    expect(calls[1]!.url).not.toContain("beta=true");
    expect(sleeps).toEqual([]);
    expect(r.speed).toBeUndefined();
    expect(client.rateLimiter.penaltyFor("default")).toBe(0);
  });
});

describe("rate-limit reservation (reserveTokens)", () => {
  function primedLimiter() {
    const now = 1_700_000_000_000;
    const limiter = new RateLimiter({ now: () => now, sleep: noSleep });
    return { limiter, now };
  }

  it("books reserveTokens instead of max_tokens, so a fan-out does not exhaust the output bucket on reservations", async () => {
    const { limiter, now } = primedLimiter();
    const { fetch } = fakeFetch([() => message("ok")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, rateLimiter: limiter });
    limiter.observe(client.rateLimitKey, { outputTokens: { limit: 10_000, remaining: 10_000, resetAt: now + 60_000 } });

    // A 20k cap can never fit a 10k bucket when the whole cap is reserved...
    await expect(client.complete({ route: "ideation", maxTokens: 20_000, messages: [{ role: "user", content: "go" }] })).rejects.toBeInstanceOf(ModelRateLimitError);
    // ...but books only the estimate when the caller gives one.
    await client.complete({ route: "ideation", maxTokens: 20_000, reserveTokens: 1_500, messages: [{ role: "user", content: "go" }] });
    expect(limiter.available(client.rateLimitKey).outputTokens).toBe(8_500);
    // Twelve parallel calls of 600 fit where twelve of 20k would not.
    await Promise.all(Array.from({ length: 12 }, () => client.complete({ route: "ideation", maxTokens: 20_000, reserveTokens: 600, messages: [{ role: "user", content: "go" }] })));
    expect(limiter.available(client.rateLimitKey).outputTokens).toBe(1_300);
  });

  it("clamps the reservation to max_tokens and leaves the request's max_tokens unchanged", async () => {
    const { limiter, now } = primedLimiter();
    const { fetch, calls } = fakeFetch([() => message("ok")]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, rateLimiter: limiter });
    limiter.observe(client.rateLimitKey, { outputTokens: { limit: 50_000, remaining: 50_000, resetAt: now + 60_000 } });
    await client.complete({ route: "worker", maxTokens: 1_000, reserveTokens: 99_999, messages: [{ role: "user", content: "go" }] });
    expect(limiter.available(client.rateLimitKey).outputTokens).toBe(49_000);
    expect(calls[0]!.body.max_tokens).toBe(1_000);
  });

  it("keeps fast mode in its own bucket", async () => {
    const { limiter } = primedLimiter();
    const { fetch } = fakeFetch([() => message("ok", { usage: { speed: "fast" }, headers: { "anthropic-ratelimit-output-tokens-limit": "8000", "anthropic-ratelimit-output-tokens-remaining": "7000", "anthropic-ratelimit-output-tokens-reset": new Date(1_700_000_060_000).toISOString() } })]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, rateLimiter: limiter, fastMode: true });
    await client.complete({ route: "ideation", messages: [{ role: "user", content: "go" }] });
    expect(limiter.snapshot(`${client.rateLimitKey}:fast`)?.outputTokens.limit).toBe(8000);
    expect(limiter.snapshot(client.rateLimitKey)?.outputTokens.limit ?? null).toBeNull();
  });
});

describe("LiveModelClient.streamStructured", () => {
  it("streams with the route's settings and delivers an element while the response is still open", async () => {
    const text = JSON.stringify({ concepts: cards(3) });
    const firstEnd = text.indexOf("}") + 1;
    let releaseRest!: () => void;
    const elementZeroSeen = new Promise<void>((resolve) => (releaseRest = resolve));
    let timedOut = false;
    const gate = Promise.race([elementZeroSeen, new Promise<void>((r) => setTimeout(() => ((timedOut = true), r()), 5000))]);
    // Part 0: message start; parts 1..: one delta each. Element 0 completes in the first delta; the second waits for it.
    const deltas = [text.slice(0, firstEnd + 1), ...pieces(text.slice(firstEnd + 1), 9)];
    const { fetch, calls } = fakeFetch([() => sseResponse({ deltas }, [undefined, undefined, gate])]);
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, onUsage: (e) => void events.push(e) });
    const seen: { index: number; name: string }[] = [];
    const r = await client.streamStructured({
      route: "ideation",
      system: "Draft cards.",
      messages: [{ role: "user", content: "go" }],
      schema: Cards,
      elementPath: "concepts",
      elementSchema: Card,
      maxTokens: 6000,
      reserveTokens: 1200,
      attribution: { kind: "ideation" },
      onElement: (e) => {
        seen.push({ index: e.index, name: e.value.name });
        if (e.index === 0) releaseRest();
      },
    });
    expect(timedOut).toBe(false);
    expect(seen).toEqual(cards(3).map((c, index) => ({ index, name: c.name })));
    expect(r.json).toEqual({ concepts: cards(3) });
    expect(r.elements).toEqual(cards(3));
    expect(r.mode).toBe("live");
    expect(r.effort).toBe("low");
    expect(r.requestId).toBe("req_stream");

    const body = calls[0]!.body;
    expect(body.stream).toBe(true);
    expect(body.model).toBe(MODELS.opus);
    expect(body.max_tokens).toBe(6000);
    expect((body.output_config as { effort: string; format: { type: string } }).effort).toBe("low");
    expect((body.output_config as { format: { type: string } }).format.type).toBe("json_schema");

    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect(r.cost.costMinor).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: "ideation", mode: "live", streamed: true, attempt: 0, attribution: { kind: "ideation" }, requestId: "req_stream" });
  });

  it("uses the beta stream with speed: fast when fast mode is on", async () => {
    const text = JSON.stringify({ concepts: cards(2) });
    const { fetch, calls } = fakeFetch([() => sseResponse({ deltas: pieces(text, 11), speed: "fast" })]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, fastMode: true });
    const r = await client.streamStructured({ route: "logoDesigner", messages: [{ role: "user", content: "go" }], schema: Cards, elementPath: "concepts", elementSchema: Card });
    expect(calls[0]!.url).toContain("beta=true");
    expect(calls[0]!.body.speed).toBe("fast");
    expect(calls[0]!.body.stream).toBe(true);
    expect(calls[0]!.headers["anthropic-beta"]).toContain(FAST_MODE_BETA);
    expect(r.speed).toBe("fast");
    expect(r.cost.fast).toBe(true);
  });

  it("retries the connection phase like complete() (529, then a stream)", async () => {
    const text = JSON.stringify({ concepts: cards(2) });
    const sleeps: number[] = [];
    const { fetch, calls } = fakeFetch([() => apiError(529, "overloaded_error", "Overloaded"), () => sseResponse({ deltas: pieces(text, 5) })]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 });
    const r = await client.streamStructured({ route: "ideation", messages: [{ role: "user", content: "go" }], schema: Cards, elementPath: "concepts", elementSchema: Card });
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(r.elements).toHaveLength(2);
  });

  it("resumes after a mid-stream overloaded_error without delivering an element twice, and books both streams", async () => {
    const text = JSON.stringify({ concepts: cards(3) });
    const firstEnd = text.indexOf("}") + 1;
    const first = [text.slice(0, firstEnd), text.slice(firstEnd, firstEnd + 6)];
    const rewritten = JSON.stringify({ concepts: [{ name: "Rewritten", score: 1 }, ...cards(3).slice(1)] });
    const { fetch, calls } = fakeFetch([() => sseResponse({ deltas: first, errorAfter: 2 }), () => sseResponse({ deltas: pieces(rewritten, 13) })]);
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, onUsage: (e) => void events.push(e) });
    const seen: number[] = [];
    const r = await client.streamStructured({ route: "ideation", messages: [{ role: "user", content: "go" }], schema: Cards, elementPath: "concepts", elementSchema: Card, onElement: (e) => void seen.push(e.index) });
    expect(seen).toEqual([0, 1, 2]);
    expect(r.json.concepts[0]).toEqual(cards(1)[0]); // the delivered element stays, not the rewrite
    expect(calls).toHaveLength(2);
    const resumeMessages = calls[1]!.body.messages as { role: string; content: string }[];
    expect(resumeMessages.at(-2)).toEqual({ role: "assistant", content: first.join("") });
    expect(resumeMessages.at(-1)!.content).toMatch(/cut off/);
    expect(events.map((e) => e.attempt)).toEqual([0, 1]);
    expect(events.every((e) => e.streamed)).toBe(true);
    expect(r.calls).toBe(2);
  });
});

describe("LiveModelClient.streamStructured: invalid output goes to repair, never to a stream retry", () => {
  // The SDK's MessageStream parses `output_config.format` itself at message_stop when the format carries a `parse`
  // function (zodOutputFormat does) and errors the stream when validation fails. The client must send a format without
  // `parse`, so a document that fails the schema reaches the element repair instead of looking like a network error.
  it("repairs only the element that failed its schema (one stream plus one element call)", async () => {
    const bad = { concepts: [...cards(2), { name: "Too high", score: 9 }] };
    const text = JSON.stringify(bad);
    const { fetch, calls } = fakeFetch([() => sseResponse({ deltas: pieces(text, 7) }), () => message(JSON.stringify({ name: "Too high", score: 5 }))]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep });
    const seen: number[] = [];
    const r = await client.streamStructured({ route: "ideation", messages: [{ role: "user", content: "go" }], schema: Cards, elementPath: "concepts", elementSchema: Card, onElement: (e) => void seen.push(e.index) });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.stream).toBeUndefined();
    expect(seen).toEqual([0, 1, 2]);
    expect(r.json.concepts[2]).toEqual({ name: "Too high", score: 5 });
    expect(r.repairedElements).toEqual([2]);
  });

  it("reports max_tokens with the delivered elements instead of retrying a truncated stream", async () => {
    const text = JSON.stringify({ concepts: cards(3) });
    const cut = text.slice(0, text.lastIndexOf("{"));
    const { fetch, calls } = fakeFetch([() => sseResponse({ deltas: pieces(cut, 9), stopReason: "max_tokens" })]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep });
    const err = await client.streamStructured({ route: "ideation", messages: [{ role: "user", content: "go" }], schema: Cards, elementPath: "concepts", elementSchema: Card }).catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(err).toMatchObject({ name: "ModelOutputError", code: "max_tokens" });
    expect((err as { details: { elements: unknown[] } }).details.elements).toHaveLength(2);
  });
});
