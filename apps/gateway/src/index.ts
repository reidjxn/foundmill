// @foundmill/gateway — the only process that holds vendor secrets (docs/ARCHITECTURE.md §9).
// Session tokens, Cedar policy, connectors (real or mock), metering, audit, MCP endpoints.
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { Redis } from "ioredis";
import { APP_NAME } from "@foundmill/config";
import { createLogger, createVault, loadEnv, type Env, type Vault } from "@foundmill/shared";
import { createServiceDb, repos, type Db } from "@foundmill/db";
import { createDefaultRegistry, platformSecretsFromEnv, type ConnectorRegistry } from "@foundmill/connectors";
import { createGatewayApp, type GatewayApp } from "./app";
import { gatewayConfig, type GatewayConfig } from "./config";
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
export * from "./mcp";
export * from "./app";
export * from "./client";

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

  const deps: GatewayDeps = { db, registry, vault, mode: config.integrationsMode, rateLimits, recipients: new UntrustedRecipientRegistry(), log };
  const app = createGatewayApp(deps, { sessionTokenSecret: config.sessionTokenSecret, sessionTokenTtlSeconds: config.sessionTokenTtlSeconds, sessionTokenMaxTtlSeconds: config.sessionTokenMaxTtlSeconds, rateLimitStoreKind });
  return { app, deps, config, rateLimitStoreKind };
}

export interface RunningGateway {
  server: ServerType;
  port: number;
  url: string;
  stop(): Promise<void>;
}

/** Binds `app` on `host:port` (0 = ephemeral) and resolves once listening. */
export function listenGateway(app: GatewayApp, options: { port: number; host?: string }): Promise<RunningGateway> {
  return new Promise((resolve, reject) => {
    const host = options.host ?? "::";
    const server = serve({ fetch: app.fetch, port: options.port, hostname: host }, (info) => {
      const port = info.port;
      const hostForUrl = host === "::" || host === "0.0.0.0" ? "localhost" : host;
      resolve({
        server,
        port,
        url: `http://${hostForUrl}:${port}`,
        stop: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.once("error", reject);
  });
}

export async function startGateway(options: BuildDepsOptions = {}): Promise<RunningGateway & BuiltGateway> {
  const built = buildGateway(options);
  const running = await listenGateway(built.app, { port: built.config.port, host: built.config.host });
  built.deps.log.info(
    { port: running.port, host: built.config.host, mode: built.config.integrationsMode, connectors: built.deps.registry.keys().length, vault: built.deps.vault?.kind ?? "none", rateLimits: built.rateLimitStoreKind },
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
        void g.stop().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((e) => {
      console.error("gateway failed to start:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
