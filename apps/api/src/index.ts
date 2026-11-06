/**
 * @foundmill/api — Hono + tRPC (docs/ARCHITECTURE.md §13).
 *
 * Boot: load env → build deps → shutdown handlers → fetch Supabase's signing keys (and every 5 minutes after, auth.ts
 * `keepKeysFresh`) → log every private service address still on localhost in staging or production → run migrations in
 * one transaction under pg_advisory_xact_lock(7461, 1) (idempotent; exit 1 when the lock is not granted within
 * MIGRATION_LOCK_TIMEOUT_MS; keep serving if the db is down) → open the database pool's connections and keep them open
 * (a `select 1` per connection every minute, packages/db `keepPoolWarm`) → supervise the outbox relay
 * (started once Redis answers PING, retried with a capped backoff until it does: services/relay.ts) → listen on PORT
 * (fallback API_PORT) on host "::" (Railway private network is IPv6-only, §17) → give agents without a persona key one,
 * in the background (services/persona-backfill.ts; logged, never blocks) → with SEED_ON_BOOT, build the demo
 * businesses in the background (services/seed-on-boot.ts). SIGTERM/SIGINT: stop accepting connections, let in-flight
 * requests and streamed answers finish, stop the relay, close Temporal, Redis and the database pool, exit 0, all within
 * SHUTDOWN_TIMEOUT_MS (docs/DEPLOY.md §3 "Redeploys and shutdown").
 */
import { serve } from "@hono/node-server";
import { closeDb, isMigrationLockTimeout, keepPoolWarm, migrateDb, watchPoolOrExit, type PoolWarmer, type PoolWatchdog } from "@foundmill/db";
import { bootSummary, loadEnv, servicePort } from "@foundmill/shared";
import { drainHttpServer, flushLog, onShutdown } from "@foundmill/shared/shutdown";
import { installTelemetry } from "@foundmill/shared/telemetry";
import { createApp } from "./app";
import type { KeyRefresher } from "./auth";
import { createApiDeps, type ApiDeps } from "./context";
import type { ApiRedis } from "./services/redis";
import { superviseOutboxRelay, type RelaySupervisor } from "./services/relay";
import { monitorWorker, type WorkerMonitor } from "./services/worker-health";
import { seedOnBoot } from "./services/seed-on-boot";
import { backfillPersonasOnBoot } from "./services/persona-backfill";
import { startWorkflowReconciler } from "./services/workflow-reconcile";

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

/**
 * Connections the api keeps open (of its pool of 10): Home's first batches alone ask for more than ten at once, and each
 * new connection to the pooler costs a TCP, TLS and SCRAM handshake, about 250 ms in production (audit api-db F1).
 */
export const WARM_CONNECTIONS = 8;

/** Service addresses the api calls over the private network; each defaults to localhost, which is wrong once deployed. */
const PRIVATE_URLS = ["INGEST_URL", "GATEWAY_URL", "COMPOSER_URL"] as const;

/**
 * Staging and production: log an error for every service address still on its localhost default. Railway serves each
 * service on its own private domain (`http://<service>.railway.internal:<port>`, docs/DEPLOY.md §3), so a missing
 * INGEST_URL turned Settings › Integrations › Simulate into "ingest unreachable" with nothing in the logs to say why.
 */
export function warnLocalhostUrls(deps: Pick<ApiDeps, "env" | "log">): string[] {
  if (deps.env.APP_ENV !== "staging" && deps.env.APP_ENV !== "production") return [];
  const local = PRIVATE_URLS.filter((name) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(deps.env[name]));
  for (const name of local) deps.log.error({ variable: name, value: deps.env[name] }, `${name} is not set for ${deps.env.APP_ENV}: it still points at ${deps.env[name]}, which nothing serves in a deployed api (docs/DEPLOY.md §3)`);
  return local;
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
      deps.log.info(bootSummary(deps.env), "api environment");
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
  // Traces to OTEL_EXPORTER_OTLP_ENDPOINT and error reports to SENTRY_DSN, when set (packages/shared telemetry.ts).
  const telemetry = installTelemetry("api", env);
  const deps = createApiDeps({ env });
  let server: ReturnType<typeof serve> | null = null;
  let relay: RelaySupervisor | null = null;
  let reconciler: { stop(): void } | null = null;
  let workerMonitor: WorkerMonitor | null = null;
  let warmer: PoolWarmer | null = null;
  let watchdog: PoolWatchdog | null = null;
  // Fetched now and refreshed in the background: no request waits for Supabase's signing keys.
  const keys: KeyRefresher | null = deps.auth.keepKeysFresh?.({ onError: (err) => deps.log.warn({ err: (err as Error)?.message }, "fetching Supabase's signing keys failed; retrying in 5 minutes (a token with an unknown key fetches them at once)") }) ?? null;
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
      { name: "stop workflow reconciler", run: () => reconciler?.stop() },
      { name: "stop key refresh", run: () => keys?.stop() },
      { name: "stop pool warmer", run: () => warmer?.stop() },
      { name: "stop pool watchdog", run: () => watchdog?.stop() },
      { name: "stop outbox relay", run: () => relay?.stop() },
      { name: "stop worker monitor", run: () => workerMonitor?.stop() },
      { name: "close temporal", run: () => deps.temporal.close() },
      {
        name: "close redis",
        run: async () => {
          const redis = deps.redis as ApiRedis | null;
          if (redis && redis.status !== "end") await redis.quit().catch(() => redis.disconnect());
        },
      },
      { name: "close database", run: () => closeDb(deps.db) },
      { name: "flush telemetry", run: () => telemetry.shutdown() },
    ],
  });

  warnLocalhostUrls(deps);
  const migrated = await migrateOnBoot(deps);
  if (lifecycle.stopping) return;
  warmer = keepPoolWarm(deps.db, { connections: WARM_CONNECTIONS, onError: (err) => deps.log.warn({ err: (err as Error)?.message }, "warming the database pool failed; the next request opens its own connection") });
  // A pool that stops answering while the database answers outside it exits the process, and Railway restarts it with a
  // fresh pool (DECISIONS 2026-10-19 "The api's pool wedged for four hours"); its state is reported on /health.
  watchdog = watchPoolOrExit({ db: deps.db, url: env.DATABASE_URL ?? null, log: deps.log, service: "api", exit: (code) => void flushLog(deps.log as Parameters<typeof flushLog>[0]).finally(() => process.exit(code)) });
  // The relay's state is reported on /health, so the supervisor exists before the app does.
  relay = superviseOutboxRelay(deps);
  const app = createApp({ ...deps, relay, poolWatchdog: watchdog });
  const port = servicePort(env, "API_PORT");

  server = await listen(app, port, deps);
  // Agents hired before 0067 get their persona keys (idempotent; failures are logged and never block).
  if (migrated) void backfillPersonasOnBoot(deps);
  // The demo seed may add a running vacation: the reconciler below runs after it.
  const seeded = migrated ? seedOnBoot(deps).catch(() => undefined) : Promise.resolve();
  // Every minute: is the orchestrator taking the work waiting on its task queues? An error line when it stops (SOAK-06).
  workerMonitor = monitorWorker({ temporal: deps.temporal, log: deps.log, taskQueue: env.TEMPORAL_TASK_QUEUE });
  if (env.APP_ENV === "development") void deps.temporal.reachable().then((ok) => !ok && deps.log.warn({ address: env.TEMPORAL_ADDRESS }, "Temporal is unreachable: start it with `temporal server start-dev` (workflows will report queued: false until then)"));

  // Long-lived workflows (vacations, Automated mode) for rows that have none: started at boot and every few minutes.
  void seeded.then(() => {
    if (!lifecycle.stopping) reconciler = startWorkflowReconciler(deps);
  });
}

const invokedDirectly = process.argv[1]?.endsWith("src/index.ts") || process.argv[1]?.endsWith("api/src/index.ts");
if (invokedDirectly && process.env.VITEST === undefined) {
  void main();
}
