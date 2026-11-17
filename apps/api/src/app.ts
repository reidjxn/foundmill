/**
 * The Hono app (docs/ARCHITECTURE.md §13): `/health` (db + redis + temporal + composer reachability flags, never
 * throws), `GET /personas/:style/:key` and `GET /personas/:key` (the public AI-generated face of one persona catalog key in one character style, humans for the short form, cached for a day), `/trpc/*` via tRPC's fetch adapter (gzip-compressed, streamed answers left alone), CORS for the web origin(s)
 * and localhost:3000, request logging with pino.
 * `createApp(deps)` is pure so tests can boot it on an ephemeral port.
 */
import { APP_NAME, LIMITS } from "@foundmill/config";
import { platformBillingRefusal } from "@foundmill/models";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { AppError, DEFAULT_AGENT_STYLE, isAgentStyle, liveConnectorKeys, platformMailLive } from "@foundmill/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import type { ApiDeps } from "./context";
import { createContextFactory } from "./context";
import { registerIdeaBoxRoutes } from "./idea-box-routes";
import { requestIdFrom } from "./request-id";
import { appRouter } from "./router";
import { etagMatches, storedPortrait } from "./services/personas";
import { speechTickets } from "./services/speech-tickets";
import { servePostMedia } from "./services/post-media";
import { assertPlatformCredits } from "@foundmill/db";
import { checkWorker } from "./services/worker-health";
import { getTracer } from "@foundmill/shared/telemetry";

export type AppVariables = { requestId: string };

/**
 * The www twin of an https web origin (https://www.foundmill.com for https://foundmill.com, and back). The web app
 * redirects www to the apex (apps/web next.config.ts), so the twin is a safety net: a page someone still has open on
 * www, or a Vercel domain setting that serves it again, keeps reaching the API. Never for http, localhost or an IP.
 */
export function wwwTwinOrigin(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (url.protocol !== "https:" || !host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) return null;
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  if (!twin.includes(".")) return null;
  url.hostname = twin;
  return url.origin;
}

export function allowedOrigins(env: { APP_URL: string; APP_ENV: string }): string[] {
  // The local web origins only on a local stack (WP-11 T18, A8-27): staging and production answer their own site alone.
  const local = env.APP_ENV === "development" || env.APP_ENV === "test";
  const origins = new Set<string>(local ? ["http://localhost:3000", "http://127.0.0.1:3000"] : []);
  for (const raw of [env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!raw) continue;
    try {
      const origin = new URL(raw).origin;
      origins.add(origin);
      const twin = wwwTwinOrigin(origin);
      if (twin) origins.add(twin);
    } catch {
      /* ignore malformed origins */
    }
  }
  return [...origins];
}

/**
 * True for a request whose answer streams: tRPC's `httpBatchStreamLink` (`trpc-accept: application/jsonl`, or the same in
 * `accept`) and subscriptions over Server-Sent Events. Those answers are never compressed: a compressor holds each chunk
 * back until it has a full block or the stream ends, so the first results would wait for the slowest.
 */
export function isStreamingRequest(headers: Headers): boolean {
  if (headers.get("trpc-accept")?.trim() === "application/jsonl") return true;
  const accept = headers.get("accept") ?? "";
  return accept.split(",").some((t) => {
    const type = t.split(";")[0]?.trim();
    return type === "application/jsonl" || type === "text/event-stream";
  });
}

/** Procedures whose input carries a logo file (a `data:` URL up to a 2 MB SVG): their requests get the larger body limit. */
export const LOGO_UPLOAD_PROCEDURES: ReadonlySet<string> = new Set(["business.logo.prepare", "business.logo.upload", "idea.logo.prepare", "idea.commit"]);

/** The procedure paths a `/trpc/<a>,<b>` request names (a batch lists several). */
export function trpcPaths(pathname: string): string[] {
  const rest = pathname.replace(/^.*?\/trpc\/?/, "");
  let decoded = rest;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    /* keep the raw path */
  }
  return decoded.split(",").filter(Boolean);
}

/** The body limit of one tRPC request: the logo limit when any procedure it names uploads a logo, else the default. */
export function trpcBodyLimitFor(pathname: string): number {
  return trpcPaths(pathname).some((p) => LOGO_UPLOAD_PROCEDURES.has(p)) ? LIMITS.trpcMaxLogoBodyBytes : LIMITS.trpcMaxBodyBytes;
}

/**
 * The `x-foundmill-client` header as the request log records it: a short, printable token such as `mobile/1.0.0 ios`,
 * or null when the request carries none (the web) or something that is not one (never log an arbitrary header).
 */
export function clientOf(header: string | undefined): string | null {
  if (!header) return null;
  const value = header.trim();
  return /^[A-Za-z0-9._/+-]+(?: [A-Za-z0-9._/+-]+){0,2}$/.test(value) && value.length <= 64 ? value : null;
}

/** A path as it may be logged or traced: a Team call audio ticket and a post media link (each the key to one file) masked. */
export function loggedPath(path: string): string {
  if (path.startsWith("/post-media/")) return "/post-media/:token";
  return path.startsWith("/team-call-audio/") ? "/team-call-audio/:ticket" : path;
}

/** No byte for this long, and a streamed turn is cut (a stalled vendor never holds the api's and the gateway's connections). */
export const AUDIO_IDLE_MS = 15_000;

/** The gateway's audio, ended after `AUDIO_IDLE_MS` with no bytes (the upstream is cancelled with it). */
export function withIdleTimeout(body: ReadableStream<Uint8Array>, idleMs = AUDIO_IDLE_MS): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = reader.read();
      const stalled = new Promise<"stalled">((resolve) => (timer = setTimeout(() => resolve("stalled"), idleMs)));
      const got = await Promise.race([next, stalled]);
      if (timer) clearTimeout(timer);
      if (got === "stalled") {
        void reader.cancel().catch(() => undefined);
        controller.close();
        return;
      }
      if (got.done) controller.close();
      else controller.enqueue(got.value);
    },
    cancel(reason) {
      if (timer) clearTimeout(timer);
      return reader.cancel(reason);
    },
  });
}

/**
 * The gateway's modes for the api's /health (WP-00 S3): the gateway has no public address, so the api relays what it
 * runs live. Null when the gateway does not answer within 2 s; never throws.
 */
async function gatewayModes(url: string): Promise<{ integrations: string; liveConnectors: string[] } | null> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(2_000) });
    const body = (await res.json()) as { mode?: unknown; liveConnectors?: unknown };
    if (typeof body.mode !== "string") return null;
    return { integrations: body.mode, liveConnectors: Array.isArray(body.liveConnectors) ? body.liveConnectors.filter((k): k is string => typeof k === "string") : [] };
  } catch {
    return null;
  }
}

export function createApp(deps: ApiDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const origins = allowedOrigins(deps.env);
  const contextFactory = createContextFactory(deps);

  app.use("*", async (c, next) => {
    const requestId = requestIdFrom(c.req.header("x-request-id"));
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    // A Team call audio ticket is the key to its turn's speech: never in a log line or a trace (the route's shape stays).
    const path = loggedPath(c.req.path);
    // One trace span per request (a tRPC batch names its procedures), the parent of every model call it makes (BUILD §15).
    const tracer = getTracer();
    if (!tracer.enabled || path === "/health") await next();
    else {
      await tracer.withSpan(path.startsWith("/trpc/") ? `trpc ${path.slice(6)}` : `${c.req.method} ${path}`, { "http.method": c.req.method, "http.route": path, "foundmill.request_id": requestId }, async (span) => {
        await next();
        span.setAttributes({ "http.status_code": c.res.status });
      }, { kind: 2, parent: c.req.header("traceparent") ?? undefined });
    }
    // `client`: which client sent it when it says so (the mobile app sends `x-foundmill-client: mobile/<version> <platform>`,
    // docs/mobile); the web sends nothing. Lets mobile traffic be told apart in the logs and the rate-limit reports.
    if (path !== "/health") deps.log.info({ requestId, method: c.req.method, path, status: c.res.status, ms: Date.now() - started, client: clientOf(c.req.header("x-foundmill-client")) }, "request");
  });

  app.use(
    "*",
    cors({
      origin: (origin) => (origin && origins.includes(origin) ? origin : null),
      allowHeaders: ["authorization", "content-type", "x-request-id", "trpc-accept", "x-trpc-source", "x-foundmill-client"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      exposeHeaders: ["x-request-id"],
      credentials: true,
      // Two hours, Chrome's cap (Firefox allows a day): a browser asks again before a change or a stream only after that.
      // The browser's reads come through the web app's own origin and need no preflight at all (apps/web
      // lib/same-origin-api.ts).
      maxAge: 7200,
    }),
  );

  app.get("/", (c) => c.json({ name: APP_NAME, service: "api", ok: true }));

  // The landing page's idea box (docs/IDEA_BOX.md): a signed-out visitor's card, streamed; its cookie keeps it.
  registerIdeaBoxRoutes(app, deps, origins);

  app.get("/health", async (c) => {
    const probe = async (fn: () => Promise<boolean>) => {
      try {
        return await Promise.race([fn(), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000))]);
      } catch {
        return false;
      }
    };
    const [db, redis, temporal, composer, worker, schema, gateway] = await Promise.all([
      probe(deps.health.db),
      probe(deps.health.redis),
      probe(deps.health.temporal),
      probe(() => deps.composer.reachable()),
      Promise.race([checkWorker(deps.temporal, deps.env.TEMPORAL_TASK_QUEUE).catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000))]),
      deps.health.schema ? deps.health.schema().catch(() => ({ ready: false, applied: null, expected: null })) : Promise.resolve({ ready: true, applied: null, expected: null }),
      // The gateway's own modes (it has no public address): what it runs live, relayed so one public read shows both.
      gatewayModes(deps.env.GATEWAY_URL),
    ]);
    // A migration that failed at boot leaves the api serving the old schema; it is not ready, so the previous deployment
    // keeps the traffic (WP-11 T2).
    const ready = db && schema.ready;
    // Readiness: Railway's healthcheck (railway/api.toml) moves traffic to a new deployment only on a 2xx, so an api
    // without its database answers 503 and the previous deployment keeps serving. Redis, Temporal, the composer, the
    // relay and the orchestrator's worker are reported but never fail the check (the api degrades without them).
    // `modelBilling` says whether Anthropic is refusing to bill the platform key (no credit, a spend limit): every model
    // call fails until the operator pays, but the api still serves everything else, so it is reported, not failed on.
    const billingRefusal = platformBillingRefusal();
    return c.json(
      {
        ok: ready,
        service: "api",
        env: deps.env.APP_ENV,
        // The mode the api actually runs in: MODEL_MODE=live without ANTHROPIC_API_KEY serves the mock client.
        modes: { integrations: deps.env.INTEGRATIONS_MODE, models: deps.models.mode, liveConnectors: liveConnectorKeys(deps.env) },
        // Whether a project's Foundmill address really sends (WP-02 T7, checked by T12's production script).
        platformMail: platformMailLive(deps.env) ? ("live" as const) : ("off" as const),
        gateway,
        modelKeyMissing: deps.env.MODEL_MODE === "live" && deps.models.mode !== "live",
        db,
        schema: { applied: schema.applied, expected: schema.expected },
        redis,
        temporal,
        composer,
        relay: deps.relay?.status() ?? null,
        // `wedged`: the pool stopped answering while the database answers outside it (the process is about to exit and
        // be restarted); `down`: the database answers nowhere (packages/db pool-watchdog.ts).
        pool: deps.poolWatchdog?.status() ?? null,
        transactions: deps.txGate?.stats() ?? null,
        worker,
        vault: deps.vault !== null,
        // Supabase's Data API: "off" is the only safe answer (services/data-api-probe.ts); reported, never failed on.
        dataApi: deps.dataApi?.state() ?? "unknown",
        modelBilling: billingRefusal ? { ok: false, ...billingRefusal } : { ok: true },
        time: new Date().toISOString(),
      },
      ready ? 200 : 503,
    );
  });

  // The face of one persona catalog key in one character style (Anthropomorphic agents): a platform asset, not business
  // data, so it needs no sign-in and any <img> on the web origin may load it. `GET /personas/:style/:key` names the style
  // (one of AGENT_STYLES; anything else is a 404 before the table is read) and `GET /personas/:key` still means humans,
  // so a URL from before 0069 keeps working. Only catalog keys are looked up; anything else, and a face not generated
  // yet, is a plain 404 that must not be cached (the web polls team.personas.ensure and loads the image once it is ready).
  // A stored face is cached for a day, not for good: a deployment that moves from the mock placeholder to real faces (or
  // regenerates one) shows the new face within a day without any change to the URL, and the strong ETag (sha256 of the
  // bytes) lets a browser revalidate for a 304 instead of a download. The bytes come from an in-memory LRU
  // (services/personas.ts `storedPortrait`), so a screen of faces does not read the table per <img>. The mime comes from
  // the row (webp, or png for the mock placeholder); `nosniff` and a sandboxing CSP keep the bytes an image whatever a
  // browser is shown, and `same-site` keeps other sites from embedding them (the web and the api share a site).
  const servePortrait = async (c: Context<{ Variables: AppVariables }>, key: string, style: string): Promise<Response> => {
    const portrait = isAgentStyle(style) ? await storedPortrait(deps.db, key, { style }) : null;
    if (!portrait) {
      c.header("cache-control", "no-store");
      return c.json({ error: "not_found" }, 404);
    }
    const headers = {
      etag: portrait.etag,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-site",
      "content-security-policy": "default-src 'none'; sandbox",
    };
    if (etagMatches(c.req.header("if-none-match"), portrait.etag)) return c.body(null, 304, headers);
    return c.body(portrait.bytes.buffer, 200, { ...headers, "content-type": portrait.mime });
  };
  app.get("/personas/:key", (c) => servePortrait(c, c.req.param("key"), DEFAULT_AGENT_STYLE));
  app.get("/personas/:style/:key", (c) => servePortrait(c, c.req.param("key"), c.req.param("style")));

  // Team call's streamed speech (services/speech-tickets.ts): the ticket `teamCall.speech({ stream: true })` issued after
  // checking the person, the call and the credits; the gateway's audio piped as it arrives. No sign-in here (an <audio>
  // element sends no bearer), so the ticket is the only key: random, short-lived and good for a few requests. Never cached.
  app.get("/team-call-audio/:ticket", async (c) => {
    const plain = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    const ticket = await speechTickets(deps.redis).take(c.req.param("ticket")).catch(() => null);
    if (!ticket || !deps.gateway.streamSpeech) return c.body(null, 404, plain);
    try {
      // Every request is a new vendor call: the credits gate holds for each, not only when the ticket was issued.
      await assertPlatformCredits(deps.db, ticket.businessId, { live: true });
      const res = await deps.gateway.streamSpeech({ businessId: ticket.businessId, callId: ticket.callId, turnId: ticket.turnId, speechAccent: ticket.speechAccent, text: ticket.text }, c.req.raw.signal);
      return new Response(withIdleTimeout(res.body!), { status: 200, headers: { ...plain, "content-type": "audio/mpeg", "cross-origin-resource-policy": "same-site", "content-security-policy": "default-src 'none'; sandbox" } });
    } catch (err) {
      const status = err instanceof AppError && err.status >= 400 && err.status < 600 ? err.status : 502;
      deps.log.warn({ code: err instanceof AppError ? err.code : "unknown", status }, "team call audio stream refused");
      return c.body(null, status as 404, plain);
    }
  });

  // A post draft's media (services/post-media.ts): the file of a ready, real item at the signed address the Creative tab
  // and the share panel were given (the web serves it from its own origin, `/api/post-media/<token>`). No sign-in here
  // (a <video> element and a "Save" link send no bearer), so the token is the key: it names one item of one business
  // and expires within the hour. Private to the browser, never kept by a shared cache, and never run as a page.
  app.get("/post-media/:token", async (c) => {
    const plain = { "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" };
    const gone = { ...plain, "cache-control": "no-store" };
    try {
      const file = await servePostMedia(deps.db, deps.env, c.req.param("token"));
      if (!file) return c.body(null, 404, gone);
      return new Response(file.content as unknown as BodyInit, {
        status: 200,
        headers: { ...plain, "content-type": file.mime, "content-length": String(file.content.byteLength), "cross-origin-resource-policy": "same-site", "content-security-policy": "default-src 'none'; sandbox" },
      });
    } catch (err) {
      deps.log.warn({ code: err instanceof AppError ? err.code : "unknown" }, "post media not served");
      return c.body(null, 404, gone);
    }
  });

  // tRPC answers are JSON and shrink 5–10× with gzip (or deflate, whichever the client accepts). Hono's compress also
  // skips any answer that already sets Transfer-Encoding (tRPC's streamed batches) or is text/event-stream; streamed
  // requests are skipped up front as well, so a stream is never buffered.
  const compressJson = compress({ threshold: 1024 });
  app.use("/trpc/*", (c, next) => (isStreamingRequest(c.req.raw.headers) ? next() : compressJson(c, next)));

  // Request bodies are bounded before tRPC reads or parses them (audit RA-12): 2 MB, 6 MB for a request that carries a
  // logo file. A larger body is a 413 whatever its Content-Length says (a chunked body is counted as it arrives).
  const tooLarge = (maxSize: number) => bodyLimit({ maxSize, onError: (c) => c.json({ error: "payload_too_large", message: `Request body is larger than ${Math.round(maxSize / (1024 * 1024))} MB` }, 413) });
  const defaultLimit = tooLarge(LIMITS.trpcMaxBodyBytes);
  const logoLimit = tooLarge(LIMITS.trpcMaxLogoBodyBytes);
  app.use("/trpc/*", (c, next) => (trpcBodyLimitFor(c.req.path) === LIMITS.trpcMaxLogoBodyBytes ? logoLimit(c, next) : defaultLimit(c, next)));

  // tRPC's fetch adapter, not @hono/trpc-server: that adapter overwrites the context's `env` with Hono's bindings
  // (`c.env`, the Node request and response), so every `ctx.env` read over HTTP came back undefined. A batch carries at
  // most `LIMITS.trpcMaxBatchSize` calls (400 past it; the web's batch link splits at the same size).
  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      router: appRouter,
      endpoint: "/trpc",
      maxBatchSize: LIMITS.trpcMaxBatchSize,
      req: c.req.raw,
      createContext: (opts) => contextFactory(opts, c),
      onError({ error, path }) {
        if (error.code === "INTERNAL_SERVER_ERROR") deps.log.error({ path, err: error.cause ?? error }, "trpc error");
      },
    }),
  );

  app.notFound((c) => c.json({ error: "not_found", path: loggedPath(c.req.path) }, 404));
  app.onError((err, c) => {
    deps.log.error({ err, path: loggedPath(c.req.path) }, "unhandled error");
    return c.json({ error: "internal", requestId: c.get("requestId") }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
