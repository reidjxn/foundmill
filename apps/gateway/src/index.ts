// @foundmill/gateway — the only process that holds vendor secrets (docs/ARCHITECTURE.md §9).
// Session tokens, Cedar policy, connectors (real or mock), metering, audit, MCP endpoints.
// SIGTERM/SIGINT: stop accepting connections, let in-flight connector calls finish, close the rate-limit Redis client and
// the database pool, exit 0, within SHUTDOWN_TIMEOUT_MS (docs/DEPLOY.md §3).
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { Redis } from "ioredis";
import { APP_NAME } from "@foundmill/config";
import { loadEnv, type Env } from "@foundmill/shared";
import { createLogger } from "@foundmill/shared/logger";
import { createVault, type Vault } from "@foundmill/shared/crypto";
import { drainHttpServer, onShutdown } from "@foundmill/shared/shutdown";
import { installTelemetry } from "@foundmill/shared/telemetry";
import { closeDb, createServiceDb, keepPoolWarm, repos, watchPoolOrExit, type Db, type PoolWarmer, type PoolWatchdog } from "@foundmill/db";
import { createDefaultRegistry, createElevenlabsSpeechStreamer, platformSecretsFromEnv, type ConnectorRegistry } from "@foundmill/connectors";
import { createModelClient, effectiveModelMode, type ModelClient } from "@foundmill/models";
import { createGatewayApp, type GatewayApp } from "./app";
import { createGatewayBuiltins, gatewayUsageSink } from "./builtins";
import { platformMailConfig } from "./platform-mail";
import type { RepositoryFiles } from "./platform-host";
import { createRepositoryFiles } from "./repository-files";
import { gatewayConfig, type GatewayConfig } from "./config";
import { prepareDb, type DbReadiness } from "./db-boot";
import { type GatewayDeps, type GatewayLogger } from "./pipeline";
import { MemoryRateLimitStore, RedisRateLimitStore, type RateLimitStore } from "./rate-limit";
import { hashRecipient, RedisUntrustedRegister, UntrustedRecipientRegistry, type UntrustedRegister } from "./recipients";
import { createReaderModelClient } from "./reader-models";
import { createUntrustedReader, type UntrustedReader } from "./untrusted-reader";

export * from "./types";
export * from "./tokens";
export * from "./config";
export * from "./rate-limit";
export * from "./recipients";
export * from "./untrusted-reader";
export * from "./security-settings";
export * from "./credentials";
export * from "./pipeline";
export * from "./state";
export * from "./mcp";
export * from "./app";
export * from "./client";
export * from "./db-boot";
export * from "./builtins";
export * from "./platform-host";

export interface BuildDepsOptions {
  env?: Env;
  db?: Db;
  /** The whole connector registry; when given, the caller also decides which built-ins it serves. */
  registry?: ConnectorRegistry;
  /** The platform's model client for the quarantined reader (default: MODEL_MODE on ANTHROPIC_API_KEY). */
  models?: ModelClient;
  vault?: Vault | null;
  rateLimits?: RateLimitStore;
  /** The register of recipients first seen in untrusted content (default: Redis when it is configured, else memory). */
  recipients?: UntrustedRegister;
  /** Reads untrusted content for sessions that hold outbound tools (default: the quarantined-reader route of the model client). */
  reader?: UntrustedReader;
  log?: GatewayLogger;
}

export interface BuiltGateway {
  app: GatewayApp;
  deps: GatewayDeps;
  config: GatewayConfig;
  rateLimitStoreKind: "memory" | "redis";
  /** Settles database readiness once (PGlite boot + migrations, or a Postgres probe); `/health` reads the result. */
  prepare(): Promise<DbReadiness>;
  /** Closes the clients this graph opened itself (the rate-limit Redis connection); the database is the caller's. */
  close(): Promise<void>;
}

/** Assembles the production dependency graph; every piece can be replaced (tests pass PGlite + a custom registry). */
export function buildGateway(options: BuildDepsOptions = {}): BuiltGateway {
  const env = options.env ?? loadEnv();
  const config = gatewayConfig(env);
  // Throws (the gateway does not start) with the domain set outside development and test and no 32+ character secret.
  const platformMail = platformMailConfig(env);
  const log = options.log ?? (createLogger("gateway", env.LOG_LEVEL) as unknown as GatewayLogger);
  const db = options.db ?? createServiceDb();

  let vault: Vault | null = options.vault === undefined ? null : options.vault;
  if (options.vault === undefined) {
    try {
      vault = createVault(env);
    } catch (e) {
      log.warn({ reason: (e as Error).message }, "no vault configured: per-business credentials cannot be decrypted (mock mode only)");
      vault = null;
    }
  }

  const secrets = platformSecretsFromEnv(env);
  let registry = options.registry;
  // The skill tools read the business's repository through this gateway's own pipeline, built further down.
  let repositoryFiles: RepositoryFiles | null = null;
  if (!registry) {
    registry = createDefaultRegistry({
      secrets,
      isSuppressed: (businessId, email) => repos.channels.isSuppressed(db, businessId, { emailHash: hashRecipient("email", email) }),
    });
    // The task board, typed messages, web reads and the quarantined reader are served here like any connector (BUILD §9.9).
    const mode = effectiveModelMode(env.MODEL_MODE, env.ANTHROPIC_API_KEY, log);
    // Every model call made here (the quarantined reader) is booked to the business that asked, like any other service's.
    const onUsage = gatewayUsageSink(db, log);
    const models = options.models ?? createModelClient({ mode, apiKey: env.ANTHROPIC_API_KEY, logger: log, onUsage });
    for (const connector of createGatewayBuiltins({ db, vault, models, mode, log, onUsage, live: { secrets }, repository: () => repositoryFiles })) registry.register(connector);
  }

  let rateLimitStoreKind: "memory" | "redis" = "memory";
  let rateLimits: RateLimitStore;
  let redisClient: Redis | null = null;
  if (options.rateLimits) {
    rateLimits = options.rateLimits;
  } else if (config.redisUrl && config.appEnv !== "test" && config.appEnv !== "development") {
    // Connected in prepare(), before the gateway listens: with the offline queue off, a command sent while the lazy
    // client is still connecting is refused, and the first tool call used to land there.
    const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2_000 });
    redisClient = redis;
    redis.on("error", (e) => log.debug({ err: e.message }, "redis error"));
    rateLimits = new RedisRateLimitStore(redis, {
      onFallback: (e) => log.warn({ err: e instanceof Error ? e.message : String(e) }, "rate limiting fell back to the in-memory store; retrying Redis in 30 s"),
      onRecover: () => log.info({}, "rate limiting is back on Redis"),
    });
    rateLimitStoreKind = "redis";
  } else {
    rateLimits = new MemoryRateLimitStore();
  }
  // What /health reports: the store in use right now (memory while a Redis store is falling back).
  const rateLimitStoreInUse = (): "memory" | "redis" => (rateLimits instanceof RedisRateLimitStore && rateLimits.isDegraded ? "memory" : rateLimitStoreKind);

  // Recipients first seen in untrusted content are one register per business, shared by every session and replica (Redis).
  const recipients: UntrustedRegister = options.recipients ?? (redisClient ? new RedisUntrustedRegister(redisClient, { onFallback: (e) => log.warn({ err: e }, "the untrusted-recipient register fell back to this process's memory") }) : new UntrustedRecipientRegistry());
  const reader: UntrustedReader = options.reader ?? createUntrustedReader(createReaderModelClient(env, db, log));
  const deps: GatewayDeps = { db, registry, vault, mode: config.integrationsMode, liveConnectors: config.liveConnectors, appEnv: config.appEnv, rateLimits, recipients, reader, log, platformMail, speechStreamer: createElevenlabsSpeechStreamer({ secrets }) };
  repositoryFiles = createRepositoryFiles(deps);
  // Until prepare() has run the database is assumed reachable (tests build the graph over an already-migrated PGlite).
  let readiness: DbReadiness | null = null;
  const app = createGatewayApp(deps, {
    sessionTokenSecret: config.sessionTokenSecret,
    sessionTokenTtlSeconds: config.sessionTokenTtlSeconds,
    sessionTokenMaxTtlSeconds: config.sessionTokenMaxTtlSeconds,
    rateLimitStoreKind: rateLimitStoreInUse,
    dbReady: () => readiness?.ok ?? true,
  });
  const prepare = async () => {
    if (redisClient) await connectRedis(redisClient, log);
    readiness = await prepareDb(db, log, { service: "gateway" });
    return readiness;
  };
  const close = async () => {
    const redis = redisClient;
    if (redis && redis.status !== "end") await redis.quit().catch(() => redis.disconnect());
  };
  return { app, deps, config, rateLimitStoreKind, prepare, close };
}

/**
 * Opens the rate-limit Redis connection before the first call. A Redis that does not answer is logged and left to
 * ioredis's reconnects; the store counts in memory meanwhile and tries Redis again every 30 s.
 */
export async function connectRedis(redis: Pick<Redis, "status" | "connect">, log: Pick<GatewayLogger, "info" | "warn">, timeoutMs = 3_000): Promise<boolean> {
  if (redis.status === "ready") return true;
  try {
    if (redis.status === "wait" || redis.status === "end") {
      await Promise.race([redis.connect(), new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs).unref?.())]);
    }
    log.info({}, "rate limits are counted in Redis");
    return true;
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, "redis did not answer at boot; rate limits are counted in memory until it does");
    return false;
  }
}

/** Hosts tried in order: `::` (Railway's IPv6-only private network, ARCHITECTURE §17) then `0.0.0.0` where IPv6 is unavailable. */
export const DEFAULT_LISTEN_HOSTS: readonly string[] = ["::", "0.0.0.0"];

const FALLBACK_CODES = new Set(["EAFNOSUPPORT", "EADDRNOTAVAIL"]);

export interface RunningGateway {
  server: ServerType;
  port: number;
  /** The host that accepted the bind. */
  host: string;
  url: string;
  stop(): Promise<void>;
}

export interface ListenGatewayOptions {
  /** 0 = ephemeral. */
  port: number;
  /** One host; shorthand for `hosts: [host]`. */
  host?: string;
  /** Hosts tried in order when the address family is unavailable (EAFNOSUPPORT / EADDRNOTAVAIL). Default DEFAULT_LISTEN_HOSTS. */
  hosts?: readonly string[];
  log?: Pick<GatewayLogger, "warn">;
}

/**
 * Binds `app` on `port` (0 = ephemeral) and resolves once listening. Tries `::` first and falls back to `0.0.0.0`
 * on hosts without IPv6, like every other service, so local containers and Railway boot the same binary.
 */
export function listenGateway(app: GatewayApp, options: ListenGatewayOptions): Promise<RunningGateway> {
  const hosts = options.hosts ?? (options.host ? [options.host] : DEFAULT_LISTEN_HOSTS);
  const [host, ...rest] = hosts;
  if (!host) return Promise.reject(new Error("no address family available to listen on"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch: app.fetch, port: options.port, hostname: host }, (info) => {
      settled = true;
      const port = info.port;
      const hostForUrl = host === "::" || host === "0.0.0.0" ? "localhost" : host;
      resolve({
        server,
        port,
        host,
        url: `http://${hostForUrl}:${port}`,
        stop: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      if (err.code && FALLBACK_CODES.has(err.code) && rest.length > 0) {
        options.log?.warn({ host, code: err.code, next: rest[0] }, "address family unavailable; falling back");
        server.close();
        listenGateway(app, { ...options, host: undefined, hosts: rest }).then(resolve, reject);
      } else reject(err);
    });
  });
}

export async function startGateway(options: BuildDepsOptions = {}): Promise<RunningGateway & BuiltGateway> {
  const built = buildGateway(options);
  const readiness = await built.prepare();
  const running = await listenGateway(built.app, { port: built.config.port, hosts: [built.config.host, ...DEFAULT_LISTEN_HOSTS.filter((h) => h !== built.config.host)], log: built.deps.log });
  built.deps.log.info(
    { port: running.port, host: running.host, db: readiness.ok, driver: readiness.driver, mode: built.config.integrationsMode, liveConnectors: built.config.liveConnectors, connectors: built.deps.registry.keys().length, vault: built.deps.vault?.kind ?? "none", rateLimits: built.rateLimitStoreKind },
    `${APP_NAME} gateway listening`,
  );
  return { ...built, ...running };
}

const isMain = typeof process !== "undefined" && process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const env = loadEnv();
  // Traces to OTEL_EXPORTER_OTLP_ENDPOINT and error reports to SENTRY_DSN, when set (packages/shared telemetry.ts).
  const telemetry = installTelemetry("gateway", env);
  const log = createLogger("gateway", env.LOG_LEVEL) as unknown as GatewayLogger;
  let gateway: (RunningGateway & BuiltGateway) | null = null;
  let warmer: PoolWarmer | null = null;
  let watchdog: PoolWatchdog | null = null;
  onShutdown({
    service: "gateway",
    log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    steps: () => [
      {
        name: "drain http",
        run: async ({ remainingMs }) => {
          if (!gateway) return;
          const { forced } = await drainHttpServer(gateway.server, { timeoutMs: Math.max(0, remainingMs - 5_000) });
          if (forced > 0) log.warn({ forced }, "gateway: connections still open at the drain deadline were cut");
        },
      },
      { name: "stop pool warmer", run: () => warmer?.stop() },
      { name: "stop pool watchdog", run: () => watchdog?.stop() },
      { name: "close redis", run: () => gateway?.close() },
      { name: "close database", run: () => gateway && closeDb(gateway.deps.db) },
      { name: "flush telemetry", run: () => telemetry.shutdown() },
    ],
  });
  startGateway({ env, log })
    .then((g) => {
      gateway = g;
      // Tool calls find open connections: each new one to the pooler costs a TLS and SCRAM handshake (packages/db `keepPoolWarm`).
      warmer = keepPoolWarm(g.deps.db, { connections: 4, onError: (err) => log.warn({ err: (err as Error)?.message }, "warming the database pool failed") });
      // A pool that stops answering while the database is fine exits the process; the platform restarts it (DECISIONS 2026-10-19).
      watchdog = watchPoolOrExit({ db: g.deps.db, url: env.DATABASE_URL ?? null, log, service: "gateway" });
    })
    .catch((e) => {
      console.error("gateway failed to start:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
