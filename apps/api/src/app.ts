/**
 * The Hono app (docs/ARCHITECTURE.md §13): `/health` (db + redis + temporal + composer reachability flags, never
 * throws), `/trpc/*` via tRPC's fetch adapter (gzip-compressed, streamed answers left alone), CORS for the web origin(s)
 * and localhost:3000, request logging with pino.
 * `createApp(deps)` is pure so tests can boot it on an ephemeral port.
 */
import { APP_NAME } from "@foundmill/config";
import { platformBillingRefusal } from "@foundmill/models";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import type { ApiDeps } from "./context";
import { createContextFactory } from "./context";
import { requestIdFrom } from "./request-id";
import { appRouter } from "./router";

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

export function createApp(deps: ApiDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const origins = allowedOrigins(deps.env);
  const contextFactory = createContextFactory(deps);

  app.use("*", async (c, next) => {
    const requestId = requestIdFrom(c.req.header("x-request-id"));
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const started = Date.now();
    await next();
    const path = c.req.path;
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
      maxAge: 600,
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
    const [db, redis, temporal, composer] = await Promise.all([probe(deps.health.db), probe(deps.health.redis), probe(deps.health.temporal), probe(() => deps.composer.reachable())]);
    // Readiness: Railway's healthcheck (railway/api.toml) moves traffic to a new deployment only on a 2xx, so an api
    // without its database answers 503 and the previous deployment keeps serving. Redis, Temporal and the composer
    // are optional (the api degrades without them) and never fail the check. `modelBilling` says whether Anthropic is
    // refusing to bill the platform key (no credit, a spend limit): every model call fails until the operator pays,
    // but the api still serves everything else, so it is reported, not failed on.
    const billingRefusal = platformBillingRefusal();
    return c.json(
      {
        ok: db,
        service: "api",
        env: deps.env.APP_ENV,
        modes: { integrations: deps.env.INTEGRATIONS_MODE, models: deps.env.MODEL_MODE },
        db,
        redis,
        temporal,
        composer,
        vault: deps.vault !== null,
        modelBilling: billingRefusal ? { ok: false, ...billingRefusal } : { ok: true },
        time: new Date().toISOString(),
      },
      db ? 200 : 503,
    );
  });

  // tRPC answers are JSON and shrink 5–10× with gzip (or deflate, whichever the client accepts). Hono's compress also
  // skips any answer that already sets Transfer-Encoding (tRPC's streamed batches) or is text/event-stream; streamed
  // requests are skipped up front as well, so a stream is never buffered.
  const compressJson = compress({ threshold: 1024 });
  app.use("/trpc/*", (c, next) => (isStreamingRequest(c.req.raw.headers) ? next() : compressJson(c, next)));

  // tRPC's fetch adapter, not @hono/trpc-server: that adapter overwrites the context's `env` with Hono's bindings
  // (`c.env`, the Node request and response), so every `ctx.env` read over HTTP came back undefined.
  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      router: appRouter,
      endpoint: "/trpc",
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
