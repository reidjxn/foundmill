/**
 * @foundmill/ingest — webhook receivers → verified → normalised platform events via the outbox
 * (docs/ARCHITECTURE.md §1, §5, §8, §17; BUILD §11.4 triggers, §13.1 webhooks, §13.3 Simulate, §14).
 *
 * Boot: load env → service database (repositories only) → vault (per-business webhook secrets; optional) →
 * connector registry (`createDefaultRegistry` with platform secrets, business resolver and secret lookup) →
 * nonce store (Redis in staging/production when `REDIS_URL` is set, memory otherwise) → Hono app → listen on
 * `PORT` (fallback `INGEST_PORT`) on host `::` with a 0.0.0.0 fallback where IPv6 is unavailable.
 */
import { serve, type ServerType } from "@hono/node-server";
import { APP_NAME, FLAGS } from "@foundmill/config";
import { createDefaultRegistry, platformSecretsFromEnv, type BusinessResolver, type ConnectorRegistry } from "@foundmill/connectors";
import { closeDb, createServiceDb, type Db } from "@foundmill/db";
import { createLogger, createVault, loadEnv, servicePort, type Env, type Vault } from "@foundmill/shared";
import { createIngestApp, type CreatedIngestApp, type IngestApp } from "./app";
import { MemoryNonceStore, RedisNonceStore, type NonceStore, type RedisNonceClient } from "./nonce-store";
import { createBusinessSecretResolver } from "./secrets";
import { simulateEnabledFor } from "./simulate";
import { silentLogger, type IngestDeps, type IngestLogger } from "./types";

export * from "./types";
export * from "./nonce-store";
export * from "./replay";
export * from "./secrets";
export * from "./conversions";
export * from "./ingest";
export * from "./webhooks";
export * from "./simulate";
export * from "./app";

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
  /** Force the Simulate routes on or off (defaults to `simulateEnabledFor(APP_ENV)`). */
  simulateEnabled?: boolean;
}

export interface BuiltIngest extends CreatedIngestApp {
  deps: IngestDeps;
  env: Env;
}

/** Assembles the production dependency graph; every piece can be replaced (tests pass PGlite, a pinned clock and a memory store). */
export function buildIngest(options: BuildIngestOptions = {}): BuiltIngest {
  const env = options.env ?? loadEnv();
  const log = options.log ?? (createLogger("ingest", env.LOG_LEVEL) as unknown as IngestLogger);
  const db = options.db ?? createServiceDb();
  const now = options.now ?? (() => new Date());

  let vault: Vault | null = options.vault === undefined ? null : options.vault;
  if (options.vault === undefined && env.INTEGRATIONS_MODE === "live") {
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

  const deps: IngestDeps = {
    db,
    registry,
    mode: env.INTEGRATIONS_MODE,
    nonces: options.nonces ?? new MemoryNonceStore(),
    log,
    now,
    replayWindowSeconds: options.replayWindowSeconds ?? DEFAULT_REPLAY_WINDOW_SECONDS,
    nonceTtlMs: options.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS,
    env: { APP_ENV: env.APP_ENV },
    simulateEnabled: options.simulateEnabled ?? simulateEnabledFor(env.APP_ENV, FLAGS.devSimulatePanel),
  };
  const created = createIngestApp(deps);
  return { ...created, deps, env };
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

/** Redis-backed nonce store when `REDIS_URL` is set in staging/production and `ioredis` is resolvable; memory otherwise. */
export async function createNonceStore(env: Env, log: IngestLogger): Promise<NonceStore> {
  const wantsRedis = Boolean(env.REDIS_URL) && (env.APP_ENV === "staging" || env.APP_ENV === "production");
  if (!wantsRedis) return new MemoryNonceStore();
  const client = await loadRedis(env.REDIS_URL, log);
  if (!client) return new MemoryNonceStore();
  return new RedisNonceStore(client, { onFallback: (e) => log.warn({ err: (e as Error)?.message }, "nonce store fell back to memory") });
}

async function loadRedis(url: string, log: IngestLogger): Promise<RedisNonceClient | null> {
  // `ioredis` is not a declared dependency of this app (docs/NEEDED_DEPS.md); resolve it dynamically so the
  // service still boots (memory store) where the module is absent.
  const specifier = "ioredis";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as { Redis?: new (url: string, opts: Record<string, unknown>) => RedisNonceClient & { on(event: "error", fn: (e: Error) => void): unknown } };
    if (!mod.Redis) return null;
    const redis = new mod.Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    redis.on("error", (e) => log.warn({ err: e.message }, "redis error (nonce store falls back to memory)"));
    return redis;
  } catch (e) {
    log.warn({ reason: (e as Error).message }, "ioredis unavailable; nonce store uses memory");
    return null;
  }
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
  const log = createLogger("ingest", env.LOG_LEVEL) as unknown as IngestLogger;
  if (!env.DATABASE_URL) {
    log.error({}, "DATABASE_URL is not set; ingest cannot start");
    process.exit(1);
  }
  const db = createServiceDb();
  const nonces = await createNonceStore(env, log);
  const built = buildIngest({ env, db, nonces, log });
  const port = servicePort(env, "INGEST_PORT");
  const running = await listenIngest(built.app, port, log);
  log.info({ port: running.port, mode: built.deps.mode, nonceStore: nonces.kind, simulate: built.deps.simulateEnabled, webhooks: built.mounted.map((m) => m.path) }, `${APP_NAME} ingest listening`);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "ingest shutting down");
    await running.stop();
    await closeDb(db);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

const entry = process.argv[1] ?? "";
if (/apps[\\/]ingest[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
