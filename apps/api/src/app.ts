/**
 * The Hono app (docs/ARCHITECTURE.md §13): `/health` (db + redis + temporal + composer reachability flags, never
 * throws), `GET /personas/:key` (the public AI-generated face of one persona catalog key, cached for a day), `/trpc/*` via tRPC's fetch adapter (gzip-compressed, streamed answers left alone), CORS for the web origin(s)
 * and localhost:3000, request logging with pino.
 * `createApp(deps)` is pure so tests can boot it on an ephemeral port.
 */
import { APP_NAME, LIMITS } from "@foundmill/config";
import { platformBillingRefusal } from "@foundmill/models";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import type { ApiDeps } from "./context";
import { createContextFactory } from "./context";
import { requestIdFrom } from "./request-id";
import { appRouter } from "./router";
import { etagMatches, storedPortrait } from "./services/personas";
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

export function allowedOrigins(env: { APP_URL: string }): string[] {
  const origins = new Set<string>(["http://localhost:3000", "http://127.0.0.1:3000"]);
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

export function createApp(deps: ApiDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const origins = allowedOrigins(deps.env);
  const contextFactory = createContextFactory(deps);

  app.use("*", async (c, next) => {
    const requestId = requestIdFrom(c.req.header("x-request-id"));
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    const path = c.req.path;
    // One trace span per request (a tRPC batch names its procedures), the parent of every model call it makes (BUILD §15).
    const tracer = getTracer();
    if (!tracer.enabled || path === "/health") await next();
    else {
      await tracer.withSpan(path.startsWith("/trpc/") ? `trpc ${path.slice(6)}` : `${c.req.method} ${path}`, { "http.method": c.req.method, "http.route": path, "foundmill.request_id": requestId }, async (span) => {
        await next();
        span.setAttributes({ "http.status_code": c.res.status });
      }, { kind: 2, parent: c.req.header("traceparent") ?? undefined });
    }
    if (path !== "/health") deps.log.info({ requestId, method: c.req.method, path, status: c.res.status, ms: Date.now() - started }, "request");
  });

  app.use(
    "*",
    cors({
      origin: (origin) => (origin && origins.includes(origin) ? origin : null),
      allowHeaders: ["authorization", "content-type", "x-request-id", "trpc-accept", "x-trpc-source"],
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

  app.get("/health", async (c) => {
    const probe = async (fn: () => Promise<boolean>) => {
      try {
        return await Promise.race([fn(), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000))]);
      } catch {
        return false;
      }
    };
    const [db, redis, temporal, composer, worker] = await Promise.all([
      probe(deps.health.db),
      probe(deps.health.redis),
      probe(deps.health.temporal),
      probe(() => deps.composer.reachable()),
      Promise.race([checkWorker(deps.temporal, deps.env.TEMPORAL_TASK_QUEUE).catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000))]),
    ]);
    // Readiness: Railway's healthcheck (railway/api.toml) moves traffic to a new deployment only on a 2xx, so an api
    // without its database answers 503 and the previous deployment keeps serving. Redis, Temporal, the composer, the
    // relay and the orchestrator's worker are reported but never fail the check (the api degrades without them).
    // `modelBilling` says whether Anthropic is refusing to bill the platform key (no credit, a spend limit): every model
    // call fails until the operator pays, but the api still serves everything else, so it is reported, not failed on.
    const billingRefusal = platformBillingRefusal();
    return c.json(
      {
        ok: db,
        service: "api",
        env: deps.env.APP_ENV,
        // The mode the api actually runs in: MODEL_MODE=live without ANTHROPIC_API_KEY serves the mock client.
        modes: { integrations: deps.env.INTEGRATIONS_MODE, models: deps.models.mode },
        modelKeyMissing: deps.env.MODEL_MODE === "live" && deps.models.mode !== "live",
        db,
        redis,
        temporal,
        composer,
        relay: deps.relay?.status() ?? null,
        // `wedged`: the pool stopped answering while the database answers outside it (the process is about to exit and
        // be restarted); `down`: the database answers nowhere (packages/db pool-watchdog.ts).
        pool: deps.poolWatchdog?.status() ?? null,
        worker,
        vault: deps.vault !== null,
        modelBilling: billingRefusal ? { ok: false, ...billingRefusal } : { ok: true },
        time: new Date().toISOString(),
      },
      db ? 200 : 503,
    );
  });

  // The face of one persona catalog key (Anthropomorphic agents): a platform asset, not business data, so it needs no sign-in
  // and any <img> on the web origin may load it. Only catalog keys are looked up; anything else, and a face not generated
  // yet, is a plain 404 that must not be cached (the web polls team.personas.ensure and loads the image once it is ready).
  // A stored face is cached for a day, not for good: a deployment that moves from the mock placeholder to real faces (or
  // regenerates one) shows the new face within a day without any change to the URL, and the strong ETag (sha256 of the
  // bytes) lets a browser revalidate for a 304 instead of a download. The bytes come from an in-memory LRU
  // (services/personas.ts `storedPortrait`), so a screen of faces does not read the table per <img>. The mime comes from
  // the row (webp, or png for the mock placeholder); `nosniff` and a sandboxing CSP keep the bytes an image whatever a
  // browser is shown, and `same-site` keeps other sites from embedding them (the web and the api share a site).
  app.get("/personas/:key", async (c) => {
    const portrait = await storedPortrait(deps.db, c.req.param("key"));
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

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));
  app.onError((err, c) => {
    deps.log.error({ err, path: c.req.path }, "unhandled error");
    return c.json({ error: "internal", requestId: c.get("requestId") }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
