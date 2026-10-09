// @foundmill/gateway — the only process that holds vendor secrets (docs/ARCHITECTURE.md §9).
// Session tokens, Cedar policy, connectors (real or mock), metering, audit, MCP endpoints.
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { Redis } from "ioredis";
import { APP_NAME } from "@foundmill/config";
import { createLogger, createVault, loadEnv, type Env, type Vault } from "@foundmill/shared";
import { closeDb, createServiceDb, repos, type Db } from "@foundmill/db";
import { createDefaultRegistry, platformSecretsFromEnv, type ConnectorRegistry } from "@foundmill/connectors";
import { createGatewayApp, type GatewayApp } from "./app";
import { gatewayConfig, type GatewayConfig } from "./config";
import { prepareDb, type DbReadiness } from "./db-boot";
import { type GatewayDeps, type GatewayLogger } from "./pipeline";
import { MemoryRateLimitStore, RedisRateLimitStore, type RateLimitStore } from "./rate-limit";
import { hashRecipient, UntrustedRecipientRegistry } from "./recipients";

export * from "./types";
export * from "./tokens";
export * from "./config";
export * from "./rate-limit";
export * from "./recipients";
export * from "./credentials";
export * from "./pipeline";
export * from "./state";
export * from "./mcp";
export * from "./app";
export * from "./client";
export * from "./db-boot";

export interface BuildDepsOptions {
  env?: Env;
  db?: Db;
  registry?: ConnectorRegistry;
  vault?: Vault | null;
  rateLimits?: RateLimitStore;
  log?: GatewayLogger;
}

export interface BuiltGateway {
  app: GatewayApp;
  deps: GatewayDeps;
  config: GatewayConfig;
  rateLimitStoreKind: "memory" | "redis";
  /** Settles database readiness once (PGlite boot + migrations, or a Postgres probe); `/health` reads the result. */
  prepare(): Promise<DbReadiness>;
}

/** Assembles the production dependency graph; every piece can be replaced (tests pass PGlite + a custom registry). */
export function buildGateway(options: BuildDepsOptions = {}): BuiltGateway {
  const env = options.env ?? loadEnv();
  const config = gatewayConfig(env);
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

  const registry =
    options.registry ??
    createDefaultRegistry({
      secrets: platformSecretsFromEnv(env),
      isSuppressed: (businessId, email) => repos.channels.isSuppressed(db, businessId, { emailHash: hashRecipient("email", email) }),
    });

  let rateLimitStoreKind: "memory" | "redis" = "memory";
  let rateLimits: RateLimitStore;
  if (options.rateLimits) {
    rateLimits = options.rateLimits;
  } else if (config.redisUrl && config.appEnv !== "test" && config.appEnv !== "development") {
    const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    redis.on("error", (e) => log.warn({ err: e }, "redis error (rate limiting falls back to memory)"));
    rateLimits = new RedisRateLimitStore(redis, { onFallback: (e) => log.warn({ err: e }, "rate limiting fell back to the in-memory store") });
    rateLimitStoreKind = "redis";
  } else {
    rateLimits = new MemoryRateLimitStore();
  }

  const deps: GatewayDeps = { db, registry, vault, mode: config.integrationsMode, liveConnectors: config.liveConnectors, rateLimits, recipients: new UntrustedRecipientRegistry(), log };
  // Until prepare() has run the database is assumed reachable (tests build the graph over an already-migrated PGlite).
  let readiness: DbReadiness | null = null;
  const app = createGatewayApp(deps, {
    sessionTokenSecret: config.sessionTokenSecret,
    sessionTokenTtlSeconds: config.sessionTokenTtlSeconds,
    sessionTokenMaxTtlSeconds: config.sessionTokenMaxTtlSeconds,
    rateLimitStoreKind,
    dbReady: () => readiness?.ok ?? true,
  });
  const prepare = async () => {
    readiness = await prepareDb(db, log, { service: "gateway" });
    return readiness;
  };
  return { app, deps, config, rateLimitStoreKind, prepare };
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
  startGateway()
    .then((g) => {
      const shutdown = () => {
        g.deps.log.info("gateway shutting down");
        void g
          .stop()
          .then(() => closeDb(g.deps.db))
          .finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((e) => {
      console.error("gateway failed to start:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
