/**
 * The Hono app (docs/ARCHITECTURE.md §13): `/health` (db + redis + temporal + composer reachability flags, never
 * throws), `/trpc/*` via tRPC's fetch adapter, CORS for the web origin(s) and localhost:3000, request logging with pino.
 * `createApp(deps)` is pure so tests can boot it on an ephemeral port.
 */
import { APP_NAME } from "@foundmill/config";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApiDeps } from "./context";
import { createContextFactory } from "./context";
import { appRouter } from "./router";

export type AppVariables = { requestId: string };

export function allowedOrigins(env: { APP_URL: string }): string[] {
  const origins = new Set<string>(["http://localhost:3000", "http://127.0.0.1:3000"]);
  for (const raw of [env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      /* ignore malformed origins */
    }
  }
  return [...origins];
}

export function createApp(deps: ApiDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const origins = allowedOrigins(deps.env);
  const contextFactory = createContextFactory(deps);

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
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
    return c.json({
      ok: db,
      service: "api",
      env: deps.env.APP_ENV,
      modes: { integrations: deps.env.INTEGRATIONS_MODE, models: deps.env.MODEL_MODE },
      db,
      redis,
      temporal,
      composer,
      vault: deps.vault !== null,
      time: new Date().toISOString(),
    });
  });

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
