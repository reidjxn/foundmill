/**
 * @foundmill/api — Hono + tRPC (docs/ARCHITECTURE.md §13).
 *
 * Boot: load env → build deps → run migrations under pg_advisory_lock(7461) (idempotent; keep serving if the db is
 * down) → listen on PORT (fallback API_PORT) on host "::" (Railway private network is IPv6-only, §17) → start the
 * outbox relay once Redis answers PING → graceful shutdown on SIGTERM/SIGINT.
 */
import { serve } from "@hono/node-server";
import { runOutboxRelay, type OutboxRelay } from "@foundmill/events";
import { loadEnv, servicePort } from "@foundmill/shared";
import { createApp } from "./app";
import { createApiDeps, type ApiDeps } from "./context";
import { redisReachable, type ApiRedis } from "./services/redis";

export { createApp } from "./app";
export { createApiDeps, createContextFactory, createTestContext, type ApiDeps, type Context } from "./context";
export { appRouter, createCaller, type AppRouter, type RouterInputs, type RouterOutputs } from "./router";

const MIGRATION_LOCK_KEY = 7461;

/** `pglite:` / `pglite://` URLs select the embedded driver (packages/db `createDb`); everything else is postgres.js. */
export const isPgliteUrl = (url: string): boolean => /^pglite:/i.test(url);

type MigrateDbFn = (db: unknown) => Promise<{ applied?: string[]; total?: number } | void>;

/**
 * Apply pending migrations; never throws (health reports an unreachable db).
 * - When packages/db exposes `migrateDb` (driver-aware: PGlite or postgres.js; PGlite holds its own directory lock),
 *   use it under `pg_advisory_lock(7461)` on postgres so several replicas never migrate at once.
 * - Otherwise run drizzle's migrator for the driver the URL selects (postgres.js under the advisory lock; PGlite
 *   without it: one process per directory).
 */
export async function migrateOnBoot(deps: ApiDeps): Promise<boolean> {
  if (!deps.env.DATABASE_URL) return false;
  const url = deps.env.DATABASE_URL;
  const pglite = isPgliteUrl(url);
  try {
    const { sql } = await import("drizzle-orm");
    const dbModule = (await import("@foundmill/db")) as Record<string, unknown> & { MIGRATIONS_DIR: string; MIGRATIONS_SCHEMA: string; MIGRATIONS_TABLE: string };
    const { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } = dbModule;
    const migrateDb = typeof dbModule.migrateDb === "function" ? (dbModule.migrateDb as MigrateDbFn) : null;
    const db = deps.db as unknown as { execute(q: unknown): Promise<unknown> };
    if (migrateDb) {
      if (pglite) {
        const result = await migrateDb(deps.db);
        deps.log.info({ driver: "pglite", applied: result?.applied?.length ?? null }, "migrations applied (migrateDb)");
        return true;
      }
      // eslint-disable-next-line fm/no-raw-db -- advisory lock around the migrator (ARCHITECTURE §13)
      await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
      try {
        const result = await migrateDb(deps.db);
        deps.log.info({ driver: "postgres", applied: result?.applied?.length ?? null }, "migrations applied (migrateDb)");
      } finally {
        // eslint-disable-next-line fm/no-raw-db -- release the advisory lock
        await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
      }
      return true;
    }
    const options = { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE };
    if (pglite) {
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(deps.db as unknown as Parameters<typeof migrate>[0], options);
      deps.log.info({ driver: "pglite" }, "migrations applied");
      return true;
    }
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // Infrastructure statements (lock + migrator), not data queries.
    // eslint-disable-next-line fm/no-raw-db -- advisory lock around the migrator (ARCHITECTURE §13)
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      await migrate(deps.db as unknown as Parameters<typeof migrate>[0], options);
    } finally {
      // eslint-disable-next-line fm/no-raw-db -- release the advisory lock
      await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    }
    deps.log.info({ driver: "postgres" }, "migrations applied");
    return true;
  } catch (err) {
    deps.log.error({ err: (err as Error).message, driver: pglite ? "pglite" : "postgres" }, "migrations failed; serving anyway (health reports db status)");
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
  await migrateOnBoot(deps);
  const app = createApp(deps);
  const port = servicePort(env, "API_PORT");

  const server = await listen(app, port, deps);
  if (env.APP_ENV === "development") void deps.temporal.reachable().then((ok) => !ok && deps.log.warn({ address: env.TEMPORAL_ADDRESS }, "Temporal is unreachable: start it with `temporal server start-dev` (workflows will report queued: false until then)"));

  let relay: OutboxRelay | null = null;
  void startRelay(deps).then((r) => (relay = r));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    deps.log.info({ signal }, "shutting down");
    const forced = setTimeout(() => process.exit(1), 10_000);
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await relay?.stop();
      await deps.temporal.close();
      const redis = deps.redis as ApiRedis | null;
      if (redis && redis.status !== "end") await redis.quit().catch(() => undefined);
    } finally {
      clearTimeout(forced);
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

const invokedDirectly = process.argv[1]?.endsWith("src/index.ts") || process.argv[1]?.endsWith("api/src/index.ts");
if (invokedDirectly && process.env.VITEST === undefined) {
  void main();
}
