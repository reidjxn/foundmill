/**
 * Request context (docs/ARCHITECTURE.md §13): `{ db, redis, temporal, userId, email, log }` plus the process-wide
 * services every router needs (models client, composer client, vault, connector registry, env).
 *
 * `createApiDeps()` builds the services once per process from the environment; `createContextFactory(deps)` turns
 * them into the per-request context for tRPC (app.ts). Tests build deps by hand (PGlite db, mock clients).
 */
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { Context as HonoContext } from "hono";
import { createVault, loadEnv, type Env, type Vault } from "@foundmill/shared";
import type { Db } from "@foundmill/db";
import { createDb } from "@foundmill/db";
import type { StreamRedis } from "@foundmill/events";
import type { ModelClient } from "@foundmill/models";
import { createDefaultRegistry, type ConnectorRegistry } from "@foundmill/connectors";
import { createAuthVerifier, type AuthVerifier } from "./auth";
import { createComposerClient, type ComposerClient } from "./services/composer";
import { createApiModelClient } from "./services/models";
import { createRedis } from "./services/redis";
import { createSandboxRecordingResolver, type RecordingResolver } from "./services/replay";
import { createApiGatewayClient, type ApiGatewayClient } from "./services/gateway";
import { createIngestClient, type IngestClient } from "./services/simulate";
import { createTemporalService, type TemporalService } from "./services/temporal";
import { createLog, type ApiLogger } from "./services/log";

export interface ApiDeps {
  env: Env;
  /** Service-role Drizzle database. User-originated queries go through `withRls` (see trpc.ts `ctx.rls`). */
  db: Db;
  redis: StreamRedis | null;
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
}

export interface Context extends ApiDeps {
  userId: string | null;
  email: string | null;
  /** When the signed-in user last authenticated (token `amr`/`iat`); null when anonymous or unknown. */
  authenticatedAt: Date | null;
  requestId: string;
}

/** A signed-in user for the in-process caller and tests. */
export interface CallerUser {
  userId: string;
  email?: string | null;
  authenticatedAt?: Date | null;
}

export interface CreateApiDepsOptions {
  env?: Env;
  db?: Db;
  redis?: StreamRedis | null;
  log?: ApiLogger;
  recordings?: RecordingResolver | null;
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
  const temporal = createTemporalService({ address: env.TEMPORAL_ADDRESS, namespace: env.TEMPORAL_NAMESPACE, taskQueue: env.TEMPORAL_TASK_QUEUE, log });
  const models = createApiModelClient(env, log);
  const composer = createComposerClient({ url: env.COMPOSER_URL, db, models, log, allowFallback: env.APP_ENV === "development" || env.APP_ENV === "test" });

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
    // SUPABASE_JWT_SECRET is not in the shared env schema yet (packages/shared/src/env.ts); read here only.
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
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

  return { env, db, redis, temporal, models, composer, vault, connectors, auth, log, recordings, ingest, gateway, health };
}

/** Per-request context factory for `trpcServer({ createContext })`. */
export function createContextFactory(deps: ApiDeps) {
  return async (opts: FetchCreateContextFnOptions, c?: HonoContext): Promise<Context> => {
    const authorization = opts.req.headers.get("authorization");
    const user = await deps.auth.resolve(authorization);
    const requestId = c?.get("requestId") ?? opts.req.headers.get("x-request-id") ?? crypto.randomUUID();
    return { ...deps, userId: user?.userId ?? null, email: user?.email ?? null, authenticatedAt: user?.authenticatedAt ?? null, requestId };
  };
}

/** Context for tests and the in-process caller (`authenticatedAt` defaults to now for a signed-in user). */
export function createTestContext(deps: ApiDeps, user: CallerUser | null): Context {
  return { ...deps, userId: user?.userId ?? null, email: user?.email ?? null, authenticatedAt: user ? (user.authenticatedAt === undefined ? new Date() : user.authenticatedAt) : null, requestId: crypto.randomUUID() };
}
