/**
 * Request context (docs/ARCHITECTURE.md §13): `{ db, redis, temporal, userId, email, log }` plus the process-wide
 * services every router needs (models client, composer client, vault, connector registry, env).
 *
 * `createApiDeps()` builds the services once per process from the environment; `createContextFactory(deps)` turns
 * them into the per-request context for tRPC (app.ts). Tests build deps by hand (PGlite db, mock clients).
 */
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { Context as HonoContext } from "hono";
import { loadEnv, type Env } from "@foundmill/shared";
import { createVault, type Vault } from "@foundmill/shared/crypto";
import type { Db, PoolWatchdog } from "@foundmill/db";
import { createDb } from "@foundmill/db";
import type { StreamRedis } from "@foundmill/events";
import type { ModelClient } from "@foundmill/models";
import { createDefaultRegistry, type ConnectorRegistry } from "@foundmill/connectors";
import { createAuthVerifier, type AuthVerifier } from "./auth";
import { requestIdFrom } from "./request-id";
import { createComposerClient, type ComposerClient } from "./services/composer";
import { createApiModelClient } from "./services/models";
import { createRateLimitStore, type RateLimitStore, type RedisLimitClient } from "./services/rate-limit";
import { createRedis } from "./services/redis";
import type { RelaySupervisor } from "./services/relay";
import { createSandboxRecordingResolver, type RecordingResolver } from "./services/replay";
import { createApiGatewayClient, type ApiGatewayClient } from "./services/gateway";
import { createIngestClient, type IngestClient } from "./services/simulate";
import { createTemporalService, type TemporalService } from "./services/temporal";
import { createLog, type ApiLogger } from "./services/log";
import type { BusinessAccess } from "./trpc";

export interface ApiDeps {
  env: Env;
  /** Service-role Drizzle database. User-originated queries go through `withRls` (see trpc.ts `ctx.rls`). */
  db: Db;
  redis: StreamRedis | null;
  /**
   * Allowances on procedures that spend money per call (model calls on the platform key, vendor lookups): Redis in
   * staging and production so every replica counts against one window, memory otherwise (services/rate-limit.ts).
   */
  limits: RateLimitStore;
  temporal: TemporalService;
  models: ModelClient;
  composer: ComposerClient;
  /** Envelope-encryption vault; null when neither KMS_KEY_ID nor DEV_MASTER_KEY is configured (keys.* refuse). */
  vault: Vault | null;
  connectors: ConnectorRegistry;
  auth: AuthVerifier;
  log: ApiLogger;
  /** Mock sandbox recordings for session replays without Redis (null when the sandbox package is not linked). */
  recordings: RecordingResolver | null;
  /** apps/ingest over the private network; `dev.simulate` mints the service token and proxies through it (SEC-2). */
  ingest: IngestClient;
  /** apps/gateway for App connectors (GitHub): their connect and health run where the App's keys are. */
  gateway: ApiGatewayClient;
  /** Reachability probes for /health; each must never throw. */
  health: {
    db(): Promise<boolean>;
    redis(): Promise<boolean>;
    temporal(): Promise<boolean>;
  };
  /** The outbox relay's supervisor (index.ts); absent in tests and the in-process caller. /health reports its state. */
  relay?: RelaySupervisor | null;
  /** The pool watchdog (index.ts); absent in tests and the in-process caller. /health reports its state. */
  poolWatchdog?: PoolWatchdog | null;
}

export interface Context extends ApiDeps {
  userId: string | null;
  email: string | null;
  /** When the signed-in user last authenticated (token `amr`/`iat`); null when anonymous or unknown. */
  authenticatedAt: Date | null;
  /**
   * The token shows the user controls `email` (auth.ts `emailConfirmedFromPayload`): what SIGNUP_ALLOWLIST requires
   * before it trusts the address (SEC2 S11). False when the token did not say.
   */
  emailConfirmed: boolean;
  requestId: string;
  /**
   * The membership and business lookups `businessProcedure` made in this HTTP request (trpc.ts), keyed by user and
   * business, so a batch of procedures for one business checks membership once. A new, empty map for every request
   * (`createContextFactory`), never shared between requests; absent for the in-process caller and tests, which look
   * up on every call.
   */
  accessMemo?: Map<string, Promise<BusinessAccess>>;
}

/** A signed-in user for the in-process caller and tests. */
export interface CallerUser {
  userId: string;
  email?: string | null;
  authenticatedAt?: Date | null;
  /** Defaults to true: the in-process caller names a user it already trusts. */
  emailConfirmed?: boolean;
}

export interface CreateApiDepsOptions {
  env?: Env;
  db?: Db;
  redis?: StreamRedis | null;
  log?: ApiLogger;
  recordings?: RecordingResolver | null;
  limits?: RateLimitStore;
}

/** Build every process-wide service from the environment. Never throws for an unreachable backend. */
export function createApiDeps(options: CreateApiDepsOptions = {}): ApiDeps {
  const env = options.env ?? loadEnv();
  const log = options.log ?? createLog(env);

  let db: Db;
  if (options.db) db = options.db;
  else if (env.DATABASE_URL) db = createDb(env.DATABASE_URL, { max: 10 }) as unknown as Db;
  else {
    log.error({}, "DATABASE_URL is not set; the API will answer /health but every tRPC call will fail");
    db = createDb("postgres://invalid@127.0.0.1:1/invalid", { max: 1 }) as unknown as Db;
  }

  const redis = options.redis === undefined ? createRedis(env.REDIS_URL, log) : options.redis;
  // Deployed replicas share their windows through Redis; development and tests keep them in the process.
  const shared = env.APP_ENV === "staging" || env.APP_ENV === "production";
  const limits =
    options.limits ??
    createRateLimitStore(shared && redis && typeof (redis as Partial<RedisLimitClient>).eval === "function" ? (redis as unknown as RedisLimitClient) : null, {
      onFallback: (err) => log.warn({ err: (err as Error)?.message }, "rate limits fell back to memory (Redis did not answer); retrying Redis in 30 s"),
    });
  const temporal = createTemporalService({ address: env.TEMPORAL_ADDRESS, namespace: env.TEMPORAL_NAMESPACE, taskQueue: env.TEMPORAL_TASK_QUEUE, log });
  // Calls made for a business are booked to its usage ledger through the client (services/models.ts).
  const models = createApiModelClient(env, log, { db });
  const composer = createComposerClient({ url: env.COMPOSER_URL, db, models, log, timeoutMs: env.COMPOSER_TIMEOUT_MS, allowFallback: env.APP_ENV === "development" || env.APP_ENV === "test" });

  let vault: Vault | null = null;
  try {
    vault = createVault(env);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "vault not configured; keys.* will refuse until KMS_KEY_ID or DEV_MASTER_KEY is set");
  }

  const connectors = createDefaultRegistry();
  const recordings = options.recordings === undefined ? createSandboxRecordingResolver() : options.recordings;
  const ingest = createIngestClient({ url: env.INGEST_URL, secret: env.SESSION_TOKEN_SECRET ?? null });
  const gateway = createApiGatewayClient({ url: env.GATEWAY_URL, secret: env.SESSION_TOKEN_SECRET ?? null });
  const auth = createAuthVerifier({
    supabaseUrl: env.SUPABASE_URL ?? null,
    jwtSecret: env.SUPABASE_JWT_SECRET ?? null,
    devUserId: env.DEV_AUTH_USER_ID ?? null,
    appEnv: env.APP_ENV,
  });

  const health = {
    db: async () => {
      try {
        const { sql } = await import("drizzle-orm");
        // Reachability probe, not a data query (ARCHITECTURE §13 "health reports it").
        // eslint-disable-next-line fm/no-raw-db -- liveness probe
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    redis: async () => {
      if (!redis) return false;
      try {
        const r = redis as unknown as { ping?: () => Promise<string> };
        if (typeof r.ping === "function") return (await r.ping()) === "PONG";
        await redis.xlen("health:probe");
        return true;
      } catch {
        return false;
      }
    },
    temporal: () => temporal.reachable(),
  };

  return { env, db, redis, limits, temporal, models, composer, vault, connectors, auth, log, recordings, ingest, gateway, health };
}

/** Per-request context factory for `trpcServer({ createContext })`. */
export function createContextFactory(deps: ApiDeps) {
  return async (opts: FetchCreateContextFnOptions, c?: HonoContext): Promise<Context> => {
    const authorization = opts.req.headers.get("authorization");
    const user = await deps.auth.resolve(authorization);
    const requestId = c?.get("requestId") ?? requestIdFrom(opts.req.headers.get("x-request-id"));
    return { ...deps, userId: user?.userId ?? null, email: user?.email ?? null, authenticatedAt: user?.authenticatedAt ?? null, emailConfirmed: user?.emailConfirmed === true, requestId, accessMemo: new Map() };
  };
}

/** Context for tests and the in-process caller (`authenticatedAt` defaults to now for a signed-in user). */
export function createTestContext(deps: ApiDeps, user: CallerUser | null): Context {
  return { ...deps, userId: user?.userId ?? null, email: user?.email ?? null, authenticatedAt: user ? (user.authenticatedAt === undefined ? new Date() : user.authenticatedAt) : null, emailConfirmed: user ? user.emailConfirmed !== false : false, requestId: crypto.randomUUID() };
}
