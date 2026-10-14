/**
 * Traces and error reports for every Node service (BUILD §15 "Observability"), without a vendor SDK: spans are sent as
 * OTLP/HTTP JSON to OTEL_EXPORTER_OTLP_ENDPOINT (Grafana Cloud, an OpenTelemetry Collector...) and errors as Sentry
 * envelopes to SENTRY_DSN. Both are off when their variable is unset, and neither can fail or slow the service: exports
 * are batched, bounded and their failures only counted.
 *
 * - `installTelemetry(service, env)` once in a service's main(): sets the process tracer and error reporter, reports
 *   every `log.error` (the loggers call `reportLoggedError`) and uncaught exceptions.
 * - `getTracer()` anywhere: `withSpan(name, attributes, fn)` runs `fn` in a child of the current span (AsyncLocalStorage),
 *   `recordSpan` adds a finished one (an LLM call with its tokens and cost), `currentTraceparent()` is the W3C header
 *   that links another service's spans (the agent session's tool calls through the gateway) to the current one.
 *
 * Only an allow-list of identifiers goes with an error report (business, session, agent, task, request ids, route,
 * connector, tool, code, status), never the logged object itself, which can hold tool arguments or message bodies.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export type AttributeValue = string | number | boolean | null | undefined;
export type SpanAttributes = Record<string, AttributeValue>;

/** `key=value,key2=value2` (OTEL_EXPORTER_OTLP_HEADERS; values may be percent-encoded) → headers. */
export function parseOtlpHeaders(value: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (value ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------------------------------------------------

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface Span extends SpanContext {
  readonly name: string;
  setAttributes(attributes: SpanAttributes): void;
  /** Ends the span once; an `error` marks it failed. */
  end(options?: { error?: unknown; attributes?: SpanAttributes; endMs?: number }): void;
  /** The W3C `traceparent` header of this span. */
  traceparent(): string;
}

export interface SpanOptions {
  attributes?: SpanAttributes;
  /** A W3C traceparent (another service's span) or a span of this process; default the current span, if any. */
  parent?: string | SpanContext | null;
  startMs?: number;
  /** OTLP span kind: 1 internal (default), 2 server, 3 client. */
  kind?: 1 | 2 | 3;
}

export interface Tracer {
  readonly enabled: boolean;
  startSpan(name: string, options?: SpanOptions): Span;
  /** Runs `fn` inside a new span (the current span for anything it starts), ending it with `fn`'s outcome. */
  withSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>, options?: Omit<SpanOptions, "attributes">): Promise<T>;
  /** Adds a span that already finished (an LLM call reported with its duration). */
  recordSpan(name: string, span: { startMs: number; endMs: number; attributes?: SpanAttributes; error?: unknown; parent?: string | SpanContext | null }): void;
  /** Sends what is buffered now. */
  flush(): Promise<void>;
  /** Flushes and stops the export timer. */
  shutdown(): Promise<void>;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function parseTraceparent(header: string | null | undefined): SpanContext | null {
  const m = TRACEPARENT.exec((header ?? "").trim().toLowerCase());
  if (!m || /^0+$/.test(m[1]!) || /^0+$/.test(m[2]!)) return null;
  return { traceId: m[1]!, spanId: m[2]! };
}

export const formatTraceparent = (ctx: SpanContext): string => `00-${ctx.traceId}-${ctx.spanId}-01`;

const spanStore = new AsyncLocalStorage<SpanContext>();

/** The current span's context (inside `withSpan`), or null. */
export const currentSpanContext = (): SpanContext | null => spanStore.getStore() ?? null;

/** The current span as a W3C traceparent header, or null outside any span. */
export function currentTraceparent(): string | null {
  const ctx = currentSpanContext();
  return ctx ? formatTraceparent(ctx) : null;
}

/** Runs `fn` with `ctx` as the current span context (a session's span inside a long activity). */
export const runInSpanContext = <T>(ctx: SpanContext | null, fn: () => T): T => (ctx ? spanStore.run(ctx, fn) : fn());

interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: Record<string, unknown> }[];
  status: { code: number; message?: string };
}

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");
const nanos = (ms: number): string => `${BigInt(Math.round(ms * 1000)) * 1000n}`;

function otlpValue(v: Exclude<AttributeValue, null | undefined>): Record<string, unknown> {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: v.slice(0, 1000) };
}

function otlpAttributes(attributes: SpanAttributes): FinishedSpan["attributes"] {
  return Object.entries(attributes)
    .filter((e): e is [string, Exclude<AttributeValue, null | undefined>] => e[1] !== null && e[1] !== undefined)
    .map(([key, value]) => ({ key, value: otlpValue(value) }));
}

const errorText = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);

export interface TracerOptions {
  /** OTLP/HTTP base URL (OTEL_EXPORTER_OTLP_ENDPOINT); spans go to `<endpoint>/v1/traces`. Unset: a no-op tracer. */
  endpoint?: string | null;
  headers?: Record<string, string>;
  service: string;
  environment?: string;
  fetch?: typeof fetch;
  /** Spans buffered before an export (default 200) and the export interval (default 5 s). */
  batchSize?: number;
  intervalMs?: number;
  /** Most spans kept while exports fail; older ones are dropped (default 5,000). */
  maxBuffered?: number;
  now?: () => number;
}

export function createTracer(options: TracerOptions): Tracer {
  const endpoint = options.endpoint?.trim().replace(/\/+$/, "") || null;
  const now = options.now ?? Date.now;
  const buffer: FinishedSpan[] = [];
  const batchSize = options.batchSize ?? 200;
  const maxBuffered = options.maxBuffered ?? 5_000;
  let dropped = 0;
  let exporting: Promise<void> | null = null;
  const resource = otlpAttributes({ "service.name": `foundmill-${options.service}`, "service.namespace": "foundmill", "deployment.environment": options.environment ?? "development" });

  const push = (span: FinishedSpan) => {
    if (!endpoint) return;
    buffer.push(span);
    if (buffer.length > maxBuffered) dropped += buffer.splice(0, buffer.length - maxBuffered).length;
    if (buffer.length >= batchSize) void flush();
  };

  const flush = async (): Promise<void> => {
    if (!endpoint || buffer.length === 0) return exporting ?? undefined;
    if (exporting) return exporting;
    const spans = buffer.splice(0, buffer.length);
    exporting = (async () => {
      try {
        const res = await (options.fetch ?? fetch)(`${endpoint}/v1/traces`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(options.headers ?? {}) },
          body: JSON.stringify({ resourceSpans: [{ resource: { attributes: resource }, scopeSpans: [{ scope: { name: "foundmill" }, spans }] }] }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) dropped += spans.length;
      } catch {
        dropped += spans.length;
      } finally {
        exporting = null;
      }
    })();
    return exporting;
  };

  const timer = endpoint ? setInterval(() => void flush(), options.intervalMs ?? 5_000) : null;
  timer?.unref?.();

  const parentOf = (parent: SpanOptions["parent"]): SpanContext | null => (parent === undefined ? currentSpanContext() : typeof parent === "string" ? parseTraceparent(parent) : parent);

  const startSpan = (name: string, opts: SpanOptions = {}): Span => {
    const parent = parentOf(opts.parent);
    const traceId = parent?.traceId ?? hex(16);
    const spanId = hex(8);
    const startMs = opts.startMs ?? now();
    const attributes: SpanAttributes = { ...(opts.attributes ?? {}) };
    let ended = false;
    return {
      name,
      traceId,
      spanId,
      setAttributes: (a) => Object.assign(attributes, a),
      traceparent: () => formatTraceparent({ traceId, spanId }),
      end(endOptions = {}) {
        if (ended) return;
        ended = true;
        if (endOptions.attributes) Object.assign(attributes, endOptions.attributes);
        push({
          traceId,
          spanId,
          ...(parent ? { parentSpanId: parent.spanId } : {}),
          name,
          kind: opts.kind ?? 1,
          startTimeUnixNano: nanos(startMs),
          endTimeUnixNano: nanos(endOptions.endMs ?? now()),
          attributes: otlpAttributes(attributes),
          status: endOptions.error === undefined ? { code: 1 } : { code: 2, message: errorText(endOptions.error) },
        });
      },
    };
  };

  return {
    enabled: endpoint !== null,
    startSpan,
    async withSpan(name, attributes, fn, opts = {}) {
      const span = startSpan(name, { ...opts, attributes });
      try {
        const result = await spanStore.run({ traceId: span.traceId, spanId: span.spanId }, () => fn(span));
        span.end();
        return result;
      } catch (err) {
        span.end({ error: err });
        throw err;
      }
    },
    recordSpan(name, s) {
      startSpan(name, { attributes: s.attributes, parent: s.parent, startMs: s.startMs }).end({ endMs: s.endMs, ...(s.error !== undefined ? { error: s.error } : {}) });
    },
    flush,
    async shutdown() {
      if (timer) clearInterval(timer);
      await flush();
      void dropped;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Error reports (Sentry envelopes)
// ---------------------------------------------------------------------------------------------------------------------

export interface ErrorReporter {
  readonly enabled: boolean;
  /** Reports one error (an Error or a message) with allow-listed context; never throws, never waits. */
  capture(error: unknown, context?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

/** The only context keys that leave the process with an error report. */
export const REPORTED_CONTEXT_KEYS = ["service", "businessId", "sessionId", "agentId", "taskId", "requestId", "workflowId", "path", "route", "connector", "tool", "code", "status", "phase"] as const;

export interface ParsedDsn {
  url: string;
  publicKey: string;
}

/** `https://<key>@<host>[/<path>]/<project>` → the envelope endpoint and the public key; null when malformed. */
export function parseSentryDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split("/").filter(Boolean);
    const project = parts.pop();
    if (!u.username || !project) return null;
    const prefix = parts.length ? `/${parts.join("/")}` : "";
    return { url: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, publicKey: decodeURIComponent(u.username) };
  } catch {
    return null;
  }
}

function frames(stack: string | undefined): { function: string; filename: string; lineno?: number; colno?: number; in_app: boolean }[] {
  const out = [];
  for (const line of (stack ?? "").split("\n").slice(1, 40)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2]!;
    out.push({ function: m[1] ?? "?", filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes("node_modules") && !filename.startsWith("node:") });
  }
  return out.reverse();
}

export interface ErrorReporterOptions {
  dsn?: string | null;
  service: string;
  environment?: string;
  release?: string;
  fetch?: typeof fetch;
  /** Most reports per minute (default 30); the same message is sent at most once a minute. */
  perMinute?: number;
  now?: () => number;
}

export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const dsn = parseSentryDsn(options.dsn);
  const now = options.now ?? Date.now;
  const perMinute = options.perMinute ?? 30;
  const sent: number[] = [];
  const recent = new Map<string, number>();
  const pending = new Set<Promise<void>>();

  return {
    enabled: dsn !== null,
    capture(error, context = {}) {
      if (!dsn) return;
      const t = now();
      const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
      const key = `${err.name}:${err.message}`.slice(0, 300);
      if ((recent.get(key) ?? 0) > t - 60_000) return;
      while (sent.length && sent[0]! <= t - 60_000) sent.shift();
      if (sent.length >= perMinute) return;
      sent.push(t);
      recent.set(key, t);
      if (recent.size > 500) recent.delete(recent.keys().next().value!);
      const tags: Record<string, string> = { service: options.service };
      const extra: Record<string, string | number | boolean> = {};
      for (const k of REPORTED_CONTEXT_KEYS) {
        const v = context[k];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") extra[k] = typeof v === "string" ? v.slice(0, 200) : v;
      }
      const eventId = hex(16);
      const event = {
        event_id: eventId,
        timestamp: t / 1000,
        platform: "node",
        level: "error",
        logger: options.service,
        environment: options.environment ?? "development",
        ...(options.release ? { release: options.release } : {}),
        tags,
        extra,
        exception: { values: [{ type: err.name, value: err.message.slice(0, 1000), stacktrace: { frames: frames(err.stack) } }] },
      };
      const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date(t).toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
      const p = (options.fetch ?? fetch)(dsn.url, {
        method: "POST",
        headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=foundmill/1.0` },
        body,
        signal: AbortSignal.timeout(10_000),
      })
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => pending.delete(p));
      pending.add(p);
    },
    async flush() {
      await Promise.all([...pending]);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Process-wide installation
// ---------------------------------------------------------------------------------------------------------------------

const noopTracer = createTracer({ service: "none" });
let tracer: Tracer = noopTracer;
let reporter: ErrorReporter | null = null;

/** The process tracer (a no-op until `installTelemetry` ran with an endpoint). */
export const getTracer = (): Tracer => tracer;

/** Called by the loggers for every error-level line: reports `err` (or the message) with allow-listed context. */
export function reportLoggedError(fields: unknown, message: unknown): void {
  if (!reporter?.enabled) return;
  const f = fields && typeof fields === "object" ? (fields as Record<string, unknown>) : {};
  const err = f.err instanceof Error ? f.err : f.error instanceof Error ? f.error : null;
  const text = typeof message === "string" ? message : typeof fields === "string" ? fields : "error";
  const detail = typeof f.err === "string" ? f.err : typeof f.reason === "string" ? f.reason : null;
  reporter.capture(err ?? new Error(detail ? `${text}: ${detail}` : text), f);
}

export interface TelemetryEnv {
  APP_ENV: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined;
  OTEL_EXPORTER_OTLP_HEADERS?: string | undefined;
  SENTRY_DSN?: string | undefined;
}

/**
 * Turns on traces and error reports for this process from the environment; each stays off when its variable is unset.
 * Returns what was installed, and a `shutdown` that flushes both (call it from the service's shutdown steps).
 */
export function installTelemetry(service: string, env: TelemetryEnv, options: { fetch?: typeof fetch } = {}): { tracer: Tracer; errors: ErrorReporter; shutdown(): Promise<void> } {
  tracer = createTracer({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null, headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS), service, environment: env.APP_ENV, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const errors = createErrorReporter({ dsn: env.SENTRY_DSN ?? null, service, environment: env.APP_ENV, ...(options.fetch ? { fetch: options.fetch } : {}) });
  reporter = errors;
  if (errors.enabled) process.on("uncaughtExceptionMonitor", (err) => errors.capture(err, { service }));
  return {
    tracer,
    errors,
    async shutdown() {
      await Promise.all([tracer.shutdown(), errors.flush()]);
    },
  };
}

/** Back to no telemetry (tests). */
export function resetTelemetry(): void {
  tracer = noopTracer;
  reporter = null;
}
