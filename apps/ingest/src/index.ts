/**
 * @foundmill/ingest — webhook receivers → verified → normalised platform events via the outbox
 * (docs/ARCHITECTURE.md §1, §5, §8, §17; BUILD §11.4 triggers, §13.1 webhooks, §13.3 Simulate, §14).
 *
 * Boot: load env → service database (repositories only) → vault (per-business webhook secrets; optional) →
 * connector registry (`createDefaultRegistry` with platform secrets, business resolver and secret lookup) →
 * nonce store (Redis in staging/production when `REDIS_URL` is set, memory otherwise) → follow-ups (composer at
 * COMPOSER_URL, Temporal at TEMPORAL_ADDRESS for journeyBuild and playbooks) → Hono app → listen on `PORT` (fallback
 * `INGEST_PORT`) on host `::` with a 0.0.0.0 fallback where IPv6 is unavailable. SIGTERM/SIGINT: stop accepting
 * connections, let in-flight deliveries and their follow-ups finish (a vendor whose request is cut retries it), close
 * Temporal, the nonce store and the database pool, exit 0, within SHUTDOWN_TIMEOUT_MS (docs/DEPLOY.md §3).
 */
import { serve, type ServerType } from "@hono/node-server";
import { Redis } from "ioredis";
import { APP_NAME, FLAGS } from "@foundmill/config";
import { createDefaultRegistry, mockWebhooksAllowed, platformSecretsFromEnv, type BusinessResolver, type ConnectorRegistry } from "@foundmill/connectors";
import { closeDb, createServiceDb, watchPoolOrExit, type Db } from "@foundmill/db";
import { liveConnectorKeys, loadEnv, platformMailDomain, servicePort, type Env } from "@foundmill/shared";
import { createLogger } from "@foundmill/shared/logger";
import { createVault, type Vault } from "@foundmill/shared/crypto";
import { drainHttpServer, onShutdown } from "@foundmill/shared/shutdown";
import { installTelemetry } from "@foundmill/shared/telemetry";
import { createIngestApp, type CreatedIngestApp, type IngestApp } from "./app";
import { createComposerNarrator, type ComposerNarrator } from "./composer-client";
import { prepareDb } from "./db-boot";
import { createFollowups, type IngestFollowups } from "./followups";
import { MemoryNonceStore, RedisNonceStore, type NonceStore, type RedisNonceClient } from "./nonce-store";
import { createBusinessSecretResolver } from "./secrets";
import { simulateEnabledFor, simulateRoutesMounted } from "./simulate";
import type { IngestPlatformMailConfig } from "./platform-mail";
import { silentLogger, type IngestDeps, type IngestLogger } from "./types";
import { createTemporalStarter, type WorkflowStarter } from "./workflows";

export * from "./types";
export * from "./nonce-store";
export * from "./replay";
export * from "./secrets";
export * from "./conversions";
export * from "./customers";
export * from "./composer-client";
export * from "./workflows";
export * from "./playbooks";
export * from "./followups";
export * from "./ingest";
export * from "./webhooks";
export * from "./simulate";
export * from "./simulate-token";
export * from "./billing";
export * from "./platform-mail";
export * from "./app";
export * from "./db-boot";

/** BUILD §14: five minutes, the tolerance Stripe's own library defaults to. */
export const DEFAULT_REPLAY_WINDOW_SECONDS = 300;
/** Verified delivery ids are remembered for a day (well past any vendor's retry schedule). */
export const DEFAULT_NONCE_TTL_MS = 24 * 60 * 60 * 1000;

export interface BuildIngestOptions {
  env?: Env;
  db?: Db;
  registry?: ConnectorRegistry;
  vault?: Vault | null;
  nonces?: NonceStore;
  log?: IngestLogger;
  now?: () => Date;
  replayWindowSeconds?: number;
  nonceTtlMs?: number;
  /** Maps a vendor account (Stripe `acct_…`, GitHub installation, Shopify shop) to a business for shared endpoints. */
  resolveBusinessId?: BusinessResolver;
  /** Force the Simulate routes on or off (defaults to `simulateEnabledFor(APP_ENV)`; production is always off). */
  simulateEnabled?: boolean;
  /** Secret the Simulate service token is verified with (defaults to `SESSION_TOKEN_SECRET`; null refuses every request). */
  simulateTokenSecret?: string | null;
  /** Secret the platform billing webhook verifies with (defaults to `STRIPE_BILLING_WEBHOOK_SECRET`; null refuses every delivery). */
  billingWebhookSecret?: string | null;
  /** Narrates a customer won (defaults to the composer at COMPOSER_URL; null leaves narration to journeyBuild). */
  composer?: ComposerNarrator | null;
  /** Starts journeyBuild and playbooks (defaults to Temporal at TEMPORAL_ADDRESS, main task queue). */
  workflows?: WorkflowStarter;
  /** Replaces the whole after-commit pipeline (tests). */
  followups?: IngestFollowups;
  /** The Foundmill sending address's endpoints (defaults to the PLATFORM_MAIL_* variables). */
  platformMail?: IngestPlatformMailConfig;
}

export interface BuiltIngest extends CreatedIngestApp {
  deps: IngestDeps;
  env: Env;
  /** The Temporal starter the follow-ups use (closed at shutdown). */
  workflows: WorkflowStarter | null;
}

/** Assembles the production dependency graph; every piece can be replaced (tests pass PGlite, a pinned clock and a memory store). */
export function buildIngest(options: BuildIngestOptions = {}): BuiltIngest {
  const env = options.env ?? loadEnv();
  const log = options.log ?? (createLogger("ingest", env.LOG_LEVEL) as unknown as IngestLogger);
  const db = options.db ?? createServiceDb();
  const now = options.now ?? (() => new Date());

  const liveConnectors = liveConnectorKeys({ LIVE_CONNECTORS: env.LIVE_CONNECTORS ?? "" });
  let vault: Vault | null = options.vault === undefined ? null : options.vault;
  // Any live webhook may verify with a business's own secret (Stripe endpoint secret, Shopify custom app...).
  if (options.vault === undefined && (env.INTEGRATIONS_MODE === "live" || liveConnectors.length > 0)) {
    try {
      vault = createVault(env);
    } catch (e) {
      log.warn({ reason: (e as Error).message }, "no vault configured: per-business webhook secrets cannot be decrypted; platform secrets only");
      vault = null;
    }
  }

  const registry =
    options.registry ??
    createDefaultRegistry({
      secrets: platformSecretsFromEnv(env),
      now,
      resolveBusinessId: options.resolveBusinessId ?? unresolvedBusiness(log),
      getBusinessSecret: createBusinessSecretResolver(db, vault, log),
    });

  let workflows: WorkflowStarter | null = null;
  let followups = options.followups;
  if (!followups) {
    workflows = options.workflows ?? createTemporalStarter({ address: env.TEMPORAL_ADDRESS, namespace: env.TEMPORAL_NAMESPACE, taskQueue: env.TEMPORAL_TASK_QUEUE, log });
    const composer = options.composer === undefined ? createComposerNarrator({ baseUrl: env.COMPOSER_URL }) : options.composer;
    followups = createFollowups({ db, composer, workflows, log });
  }

  const deps: IngestDeps = {
    db,
    registry,
    mode: env.INTEGRATIONS_MODE,
    liveConnectors,
    nonces: options.nonces ?? new MemoryNonceStore(),
    log,
    now,
    replayWindowSeconds: options.replayWindowSeconds ?? DEFAULT_REPLAY_WINDOW_SECONDS,
    nonceTtlMs: options.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS,
    env: { APP_ENV: env.APP_ENV },
    simulateEnabled: options.simulateEnabled ?? simulateEnabledFor(env.APP_ENV, FLAGS.devSimulatePanel),
    simulateTokenSecret: options.simulateTokenSecret === undefined ? (env.SESSION_TOKEN_SECRET ?? null) : options.simulateTokenSecret,
    billingWebhookSecret: options.billingWebhookSecret === undefined ? (env.STRIPE_BILLING_WEBHOOK_SECRET?.trim() || null) : options.billingWebhookSecret,
    followups,
    platformMail: options.platformMail ?? {
      domain: platformMailDomain(env),
      signingSecret: env.PLATFORM_MAIL_SIGNING_SECRET?.trim() || null,
      inboundToken: env.PLATFORM_MAIL_INBOUND_TOKEN?.trim() || null,
      eventPublicKey: env.PLATFORM_MAIL_EVENT_PUBLIC_KEY?.trim() || null,
    },
  };
  if (simulateRoutesMounted(deps) && !deps.simulateTokenSecret) {
    log.warn({ env: env.APP_ENV }, "Simulate routes are enabled but SESSION_TOKEN_SECRET is not set: every simulate request will be refused (401)");
  }
  if (env.INTEGRATIONS_MODE === "mock" && !mockWebhooksAllowed(env.APP_ENV)) log.info({ env: env.APP_ENV, liveConnectors }, "mock webhooks are not mounted outside development and test; staging fabricates events through Simulate");
  const created = createIngestApp(deps);
  return { ...created, deps, env, workflows };
}

/**
 * Shared (Connect-style) endpoints need a cross-business lookup from vendor account to business, which the
 * business-scoped repositories do not offer yet; until packages/db exposes one, URL-less deliveries are refused.
 */
function unresolvedBusiness(log: IngestLogger): BusinessResolver {
  return async (hint) => {
    log.warn({ connector: hint.connectorKey, externalAccountId: hint.externalAccountId }, "webhook without a business in the URL; no account→business resolver is configured");
    return null;
  };
}

/** Redis-backed nonce store when `REDIS_URL` is set in staging/production; memory otherwise. */
export async function createNonceStore(env: Env, log: IngestLogger, connect: (url: string, log: IngestLogger) => Promise<RedisNonceClient | null> = connectRedis): Promise<NonceStore> {
  const wantsRedis = Boolean(env.REDIS_URL) && (env.APP_ENV === "staging" || env.APP_ENV === "production");
  if (!wantsRedis) return new MemoryNonceStore();
  const client = await connect(env.REDIS_URL, log);
  if (!client) return new MemoryNonceStore();
  return new RedisNonceStore(client, {
    onFallback: (e) => log.warn({ err: (e as Error)?.message }, "nonce store fell back to memory; retrying Redis in 30 s"),
    onRecover: () => log.info({}, "nonce store is back on Redis"),
  });
}

/**
 * The nonce store's Redis connection, opened before the first delivery: with the offline queue off, ioredis refuses a
 * command sent while a lazy client is still connecting, and the first webhook after every boot used to be that command.
 * A Redis that does not answer at boot is logged; the store counts in memory and tries Redis again every 30 s while
 * ioredis keeps reconnecting.
 */
export async function connectRedis(url: string, log: IngestLogger, timeoutMs = 3_000): Promise<RedisNonceClient | null> {
  let redis: Redis;
  try {
    redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2_000 });
  } catch (e) {
    log.warn({ reason: (e as Error).message }, "could not create the Redis client; nonce store uses memory");
    return null;
  }
  redis.on("error", (e) => log.debug({ err: e.message }, "redis error"));
  try {
    await Promise.race([redis.connect(), new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs).unref?.())]);
  } catch (e) {
    log.warn({ err: (e as Error).message }, "redis did not answer at boot; nonces are kept in memory until it does");
  }
  return redis as unknown as RedisNonceClient;
}

export interface RunningIngest {
  server: ServerType;
  port: number;
  url: string;
  stop(): Promise<void>;
}

/** Binds `app` on `port` (0 = ephemeral) trying `::` first (Railway's IPv6-only private network) then `0.0.0.0`. */
export function listenIngest(app: IngestApp, port: number, log: IngestLogger = silentLogger, hosts: readonly string[] = ["::", "0.0.0.0"]): Promise<RunningIngest> {
  const [hostname, ...rest] = hosts;
  if (!hostname) return Promise.reject(new Error("no address family available to listen on"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      settled = true;
      resolve({
        server,
        port: info.port,
        url: `http://localhost:${info.port}`,
        stop: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      if ((err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") && rest.length > 0) {
        log.warn({ hostname, code: err.code }, "address family unavailable; falling back");
        server.close();
        listenIngest(app, port, log, rest).then(resolve, reject);
      } else reject(err);
    });
  });
}

export async function main(): Promise<void> {
  const env = loadEnv();
  // Traces to OTEL_EXPORTER_OTLP_ENDPOINT and error reports to SENTRY_DSN, when set (packages/shared telemetry.ts).
  const telemetry = installTelemetry("ingest", env);
  const log = createLogger("ingest", env.LOG_LEVEL) as unknown as IngestLogger;
  if (!env.DATABASE_URL) {
    log.error({}, "DATABASE_URL is not set; ingest cannot start");
    process.exit(1);
  }
  const db = createServiceDb();
  // A pool that stops answering while the database is fine exits the process; the platform restarts it (DECISIONS 2026-10-19).
  const watchdog = watchPoolOrExit({ db, url: env.DATABASE_URL, log, service: "ingest" });
  let running: RunningIngest | null = null;
  let nonces: NonceStore | null = null;
  let built: BuiltIngest | null = null;
  const lifecycle = onShutdown({
    service: "ingest",
    log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    steps: () => [
      {
        name: "drain http",
        run: async ({ remainingMs }) => {
          if (!running) return;
          const { forced } = await drainHttpServer(running.server, { timeoutMs: Math.max(0, remainingMs - 5_000) });
          if (forced > 0) log.warn({ forced }, "ingest: connections still open at the drain deadline were cut");
        },
      },
      {
        name: "finish follow-ups",
        run: async ({ remainingMs }) => {
          if (!built) return;
          // Narration and workflow starts of deliveries already acknowledged; past the budget they are left to Refresh.
          await Promise.race([built.deps.followups.idle(), new Promise((r) => setTimeout(r, Math.max(0, remainingMs - 5_000)).unref())]);
        },
      },
      { name: "close temporal", run: () => built?.workflows?.close() },
      { name: "close nonce store", run: () => nonces?.close?.() },
      { name: "stop pool watchdog", run: () => watchdog.stop() },
      { name: "close database", run: () => closeDb(db) },
      { name: "flush telemetry", run: () => telemetry.shutdown() },
    ],
  });
  // PGlite boots + migrates here; a locked directory or an unreachable Postgres is one clear line and /health says db:false.
  const readiness = await prepareDb(db, log, { service: "ingest" });
  nonces = await createNonceStore(env, log);
  built = buildIngest({ env, db, nonces, log });
  const port = servicePort(env, "INGEST_PORT");
  if (lifecycle.stopping) return;
  running = await listenIngest(built.app, port, log);
  log.info({ port: running.port, db: readiness.ok, driver: readiness.driver, mode: built.deps.mode, nonceStore: nonces.kind, simulate: built.deps.simulateEnabled, webhooks: built.mounted.map((m) => m.path) }, `${APP_NAME} ingest listening`);
}

const entry = process.argv[1] ?? "";
if (/apps[\\/]ingest[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
