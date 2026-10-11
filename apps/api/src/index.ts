/**
 * @foundmill/api — Hono + tRPC (docs/ARCHITECTURE.md §13).
 *
 * Boot: load env → build deps → shutdown handlers → run migrations in one transaction under
 * pg_advisory_xact_lock(7461, 1) (idempotent; exit 1 when the lock is not granted within MIGRATION_LOCK_TIMEOUT_MS;
 * keep serving if the db is down) → listen on PORT (fallback API_PORT) on host "::" (Railway private network is
 * IPv6-only, §17) → with SEED_ON_BOOT, build the demo businesses in the background (services/seed-on-boot.ts) → start
 * the outbox relay once Redis answers PING. SIGTERM/SIGINT: stop accepting connections, let in-flight requests and
 * streamed answers finish, stop the relay, close Temporal, Redis and the database pool, exit 0, all within
 * SHUTDOWN_TIMEOUT_MS (docs/DEPLOY.md §3 "Redeploys and shutdown").
 */
import { serve } from "@hono/node-server";
import { closeDb, isMigrationLockTimeout, migrateDb } from "@foundmill/db";
import { runOutboxRelay, type OutboxRelay } from "@foundmill/events";
import { loadEnv, servicePort } from "@foundmill/shared";
import { drainHttpServer, flushLog, onShutdown } from "@foundmill/shared/shutdown";
import { createApp } from "./app";
import { createApiDeps, type ApiDeps } from "./context";
import { redisReachable, type ApiRedis } from "./services/redis";
import { seedOnBoot } from "./services/seed-on-boot";

export { createApp } from "./app";
export { createApiDeps, createContextFactory, createTestContext, type ApiDeps, type Context } from "./context";
export { appRouter, createCaller, type AppRouter, type RouterInputs, type RouterOutputs } from "./router";

/** `pglite:` / `pglite://` URLs select the embedded driver (packages/db `createDb`); everything else is postgres.js. */
export const isPgliteUrl = (url: string): boolean => /^pglite:/i.test(url);

export interface MigrateOnBootOptions {
  /** Called with 1 when the migration lock is not granted in time (default `process.exit`). */
  exit?: (code: number) => void;
}

/**
 * Apply pending migrations with packages/db `migrateDb`.
 * - Postgres: one transaction under `pg_advisory_xact_lock(7461, 1)`, so the lock cannot outlive the migration on
 *   Supabase's transaction pooler (or when this process dies); the wait is bounded by MIGRATION_LOCK_TIMEOUT_MS. When
 *   the lock is not granted in time this logs who holds it and exits 1: Railway restarts the boot instead of the deploy
 *   hanging before "api listening".
 * - PGlite: no lock (one process per data directory).
 * Any other failure (database unreachable, a migration error) is logged and the api keeps serving; /health reports the
 * database.
 */
export async function migrateOnBoot(deps: ApiDeps, options: MigrateOnBootOptions = {}): Promise<boolean> {
  if (!deps.env.DATABASE_URL) return false;
  const driver = isPgliteUrl(deps.env.DATABASE_URL) ? "pglite" : "postgres";
  const lockTimeoutMs = deps.env.MIGRATION_LOCK_TIMEOUT_MS;
  try {
    const result = await migrateDb(deps.db, { lockTimeoutMs });
    deps.log.info({ driver, applied: result.applied.length, total: result.total, latest: result.applied.at(-1) ?? null }, "migrations applied");
    return true;
  } catch (err) {
    if (isMigrationLockTimeout(err)) {
      deps.log.error(
        { driver, lockTimeoutMs, phase: err.phase, holders: err.holders, err: err.message },
        `${err.phase === "deadlock" ? "migration aborted by a deadlock with another connection" : `migration lock not granted within ${Math.round(lockTimeoutMs / 1000)} s`}; exiting with code 1 so the platform restarts this boot (docs/DEPLOY.md §3 "Migrations at boot")`,
      );
      await flushLog(deps.log as Parameters<typeof flushLog>[0]);
      (options.exit ?? ((code: number) => process.exit(code)))(1);
      return false;
    }
    deps.log.error({ err: (err as Error).message, driver }, "migrations failed; serving anyway (health reports db status)");
    return false;
  }
}

async function startRelay(deps: ApiDeps): Promise<OutboxRelay | null> {
  const redis = deps.redis as ApiRedis | null;
  if (!(await redisReachable(redis))) {
    deps.log.warn({ url: deps.env.REDIS_URL.replace(/\/\/.*@/, "//***@") }, "redis unreachable; outbox relay not started (events stay in the outbox until it is)");
    return null;
  }
  const relay = runOutboxRelay(deps.db as unknown as Parameters<typeof runOutboxRelay>[0], redis!, {
    onError: (err) => deps.log.warn({ err: (err as Error).message }, "outbox relay tick failed"),
  });
  deps.log.info({}, "outbox relay started");
  return relay;
}

/**
 * Listen on `::` (Railway's private network is IPv6-only, ARCHITECTURE §17) and fall back to `0.0.0.0` on hosts
 * without IPv6 (EAFNOSUPPORT / EADDRNOTAVAIL), so local containers and CI boot the same binary.
 */
export function listen(app: ReturnType<typeof createApp>, port: number, deps: ApiDeps, hosts: readonly string[] = ["::", "0.0.0.0"]): Promise<ReturnType<typeof serve>> {
  const [hostname, ...rest] = hosts;
  if (!hostname) return Promise.reject(new Error("no address family available to listen on"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      settled = true;
      deps.log.info({ port: info.port, hostname, env: deps.env.APP_ENV, integrations: deps.env.INTEGRATIONS_MODE, models: deps.env.MODEL_MODE }, "api listening");
      resolve(server);
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      if ((err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") && rest.length > 0) {
        deps.log.warn({ hostname, code: err.code }, "address family unavailable; falling back");
        server.close();
        listen(app, port, deps, rest).then(resolve, reject);
      } else reject(err);
    });
  });
}

export async function main(): Promise<void> {
  const env = loadEnv();
  const deps = createApiDeps({ env });
  let server: ReturnType<typeof serve> | null = null;
  let relay: OutboxRelay | null = null;
  // Installed before the migration: a SIGTERM during boot still closes the pool (the migration transaction rolls back).
  const lifecycle = onShutdown({
    service: "api",
    log: deps.log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    steps: () => [
      {
        name: "drain http",
        run: async ({ remainingMs }) => {
          if (!server) return;
          // Leave five seconds of the budget for the closers below.
          const { forced } = await drainHttpServer(server, { timeoutMs: Math.max(0, remainingMs - 5_000) });
          if (forced > 0) deps.log.warn({ forced }, "api: connections still open at the drain deadline were cut");
        },
      },
      { name: "stop outbox relay", run: () => relay?.stop() },
      { name: "close temporal", run: () => deps.temporal.close() },
      {
        name: "close redis",
        run: async () => {
          const redis = deps.redis as ApiRedis | null;
          if (redis && redis.status !== "end") await redis.quit().catch(() => redis.disconnect());
        },
      },
      { name: "close database", run: () => closeDb(deps.db) },
    ],
  });

  const migrated = await migrateOnBoot(deps);
  if (lifecycle.stopping) return;
  const app = createApp(deps);
  const port = servicePort(env, "API_PORT");

  server = await listen(app, port, deps);
  if (migrated) void seedOnBoot(deps);
  if (env.APP_ENV === "development") void deps.temporal.reachable().then((ok) => !ok && deps.log.warn({ address: env.TEMPORAL_ADDRESS }, "Temporal is unreachable: start it with `temporal server start-dev` (workflows will report queued: false until then)"));

  void startRelay(deps).then((r) => {
    relay = r;
    if (lifecycle.stopping) void r?.stop();
  });
}

const invokedDirectly = process.argv[1]?.endsWith("src/index.ts") || process.argv[1]?.endsWith("api/src/index.ts");
if (invokedDirectly && process.env.VITEST === undefined) {
  void main();
}
