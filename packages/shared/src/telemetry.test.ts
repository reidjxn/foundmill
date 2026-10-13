import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { createErrorReporter, createTracer, currentTraceparent, installTelemetry, parseOtlpHeaders, parseSentryDsn, parseTraceparent, resetTelemetry } from "./telemetry";

type Call = { url: string; init: RequestInit };
function recorder() {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  return { calls, fetchFn };
}

afterEach(() => resetTelemetry());

describe("OTLP traces", () => {
  it("export spans as OTLP/HTTP JSON with parents, attributes and errors", async () => {
    const { calls, fetchFn } = recorder();
    const tracer = createTracer({ endpoint: "https://otlp.example/otlp/", headers: { Authorization: "Basic abc" }, service: "api", environment: "staging", fetch: fetchFn, intervalMs: 3_600_000 });
    let inner = "";
    await tracer.withSpan("trpc business.continue", { businessId: "b-1" }, async () => {
      inner = currentTraceparent()!;
      await tracer.withSpan("child", {}, async () => undefined);
    });
    await expect(tracer.withSpan("failing", {}, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    tracer.recordSpan("llm ideation", { startMs: 1_000, endMs: 3_500, attributes: { "llm.tokens.in": 1200, "llm.cost.minor": 3.5, "llm.model": "claude-sonnet-5-5" }, parent: inner });
    await tracer.shutdown();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://otlp.example/otlp/v1/traces");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Basic abc");
    const body = JSON.parse(String(calls[0]!.init.body)) as { resourceSpans: { resource: { attributes: { key: string; value: { stringValue?: string } }[] }; scopeSpans: { spans: { name: string; traceId: string; spanId: string; parentSpanId?: string; status: { code: number; message?: string }; attributes: { key: string; value: Record<string, unknown> }[]; startTimeUnixNano: string }[] }[] }[] };
    const spans = body.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(body.resourceSpans[0]!.resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "foundmill-api" } });
    const root = spans.find((s) => s.name === "trpc business.continue")!;
    const child = spans.find((s) => s.name === "child")!;
    const llm = spans.find((s) => s.name === "llm ideation")!;
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(llm.parentSpanId).toBe(root.spanId);
    expect(llm.startTimeUnixNano).toBe("1000000000");
    expect(llm.attributes).toContainEqual({ key: "llm.tokens.in", value: { intValue: "1200" } });
    expect(llm.attributes).toContainEqual({ key: "llm.cost.minor", value: { doubleValue: 3.5 } });
    expect(spans.find((s) => s.name === "failing")!.status).toEqual({ code: 2, message: "Error: boom" });
  });

  it("is a no-op without an endpoint", async () => {
    const { calls, fetchFn } = recorder();
    const tracer = createTracer({ service: "api", fetch: fetchFn });
    expect(tracer.enabled).toBe(false);
    await tracer.withSpan("x", {}, async () => undefined);
    await tracer.shutdown();
    expect(calls).toHaveLength(0);
  });

  it("parses W3C traceparent and OTLP headers", () => {
    expect(parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")).toEqual({ traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" });
    expect(parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeNull();
    expect(parseTraceparent("garbage")).toBeNull();
    expect(parseOtlpHeaders("Authorization=Basic%20abc%3D,x-scope=tenant-1, bad")).toEqual({ Authorization: "Basic abc=", "x-scope": "tenant-1" });
  });
});

describe("Sentry error reports", () => {
  it("send an envelope with the error and only allow-listed context, once a minute per message", async () => {
    const { calls, fetchFn } = recorder();
    let t = 1_000_000;
    const reporter = createErrorReporter({ dsn: "https://pubkey@o123.ingest.sentry.io/456", service: "gateway", environment: "staging", fetch: fetchFn, now: () => t });
    reporter.capture(new Error("credit balance is too low"), { businessId: "b-1", sessionId: "s-1", args: { to: "someone@example.com" }, apiKey: "sk-secret" });
    reporter.capture(new Error("credit balance is too low"), {});
    t += 61_000;
    reporter.capture(new Error("credit balance is too low"), {});
    await reporter.flush();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://o123.ingest.sentry.io/api/456/envelope/");
    expect((calls[0]!.init.headers as Record<string, string>)["x-sentry-auth"]).toContain("sentry_key=pubkey");
    const [, item, eventLine] = String(calls[0]!.init.body).trim().split("\n");
    expect(JSON.parse(item!)).toEqual({ type: "event" });
    const event = JSON.parse(eventLine!) as { exception: { values: { type: string; value: string; stacktrace: { frames: unknown[] } }[] }; extra: Record<string, unknown>; tags: Record<string, string>; environment: string };
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "credit balance is too low" });
    expect(event.exception.values[0]!.stacktrace.frames.length).toBeGreaterThan(0);
    expect(event.extra).toEqual({ businessId: "b-1", sessionId: "s-1" });
    expect(event).toMatchObject({ tags: { service: "gateway" }, environment: "staging" });
    expect(String(calls[0]!.init.body)).not.toContain("sk-secret");
    expect(String(calls[0]!.init.body)).not.toContain("someone@example.com");
  });

  it("parses DSNs, with or without a path prefix", () => {
    expect(parseSentryDsn("https://k@sentry.example.com/prefix/9")).toEqual({ url: "https://sentry.example.com/prefix/api/9/envelope/", publicKey: "k" });
    expect(parseSentryDsn("not a dsn")).toBeNull();
    expect(parseSentryDsn(undefined)).toBeNull();
  });

  it("every logged error is reported once telemetry is installed", async () => {
    const { calls, fetchFn } = recorder();
    const telemetry = installTelemetry("ingest", { APP_ENV: "staging", SENTRY_DSN: "https://pubkey@sentry.example.com/1" }, { fetch: fetchFn });
    const lines: string[] = [];
    const log = createLogger("ingest", "info", { write: (s: string) => void lines.push(s) });
    log.warn({}, "only a warning");
    log.error({ err: new Error("webhook write failed"), businessId: "b-9" }, "webhook failed");
    await telemetry.shutdown();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.init.body)).toContain("webhook write failed");
    expect(String(calls[0]!.init.body)).toContain("b-9");
    expect(lines).toHaveLength(2);
  });
});
