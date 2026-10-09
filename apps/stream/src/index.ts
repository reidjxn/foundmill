/**
 * @foundmill/stream — WebSocket fan-out of Redis streams `ev:{businessId}` / `as:{sessionId}` to browser tabs
 * (docs/ARCHITECTURE.md §12, BUILD §8.2).
 *
 * Boot: load env → service database (repositories only, for membership checks) → ioredis → token verifier
 * (Supabase JWKS, or the dev bypass in development/test) → stream server listening on PORT (fallback STREAM_PORT)
 * on host "::" (Railway's private network is IPv6-only, §17; falls back to 0.0.0.0) → graceful shutdown on
 * SIGTERM/SIGINT. The browser client lives in `./client` (`@foundmill/stream/client`) and pulls in none of this.
 */
import { createServiceDb, closeDb } from "@foundmill/db";
import { loadEnv, servicePort } from "@foundmill/shared";
import { createLogger } from "@foundmill/shared/logger";
import { createTokenVerifier } from "./auth";
import { createCachedAuthorizer, createRepoAuthorizer } from "./authorize";
import { prepareDb } from "./db-boot";
import { createStreamRedis, probeRedis, unreachableMessage } from "./redis";
import { createStreamServer } from "./server";

export { createTokenVerifier, parseDevToken, StreamAuthError, type AuthUser, type TokenVerifier, type TokenVerifierOptions } from "./auth";
export { createRepoAuthorizer, createCachedAuthorizer, createMemoryAuthorizer, type Authorizer, type AuthorizationResult, type CachedAuthorizerOptions } from "./authorize";
export { OutboundQueue, eventFrame, type OutboundQueueOptions, type SocketLike } from "./connection";
export { ClientFrameSchema, parseClientFrame, MAX_INBOUND_BYTES, type ParsedFrame } from "./frames";
export { StreamHub, silentLog, type HubListener, type StreamHubOptions, type StreamLog } from "./hub";
export { Metrics, COUNTER_NAMES, GAUGE_NAMES, type CounterName, type GaugeName, type MetricsSnapshot } from "./metrics";
export * from "./protocol";
export { createStreamServer, type StreamServer, type StreamServerDeps, type StreamServerOptions, type HealthReport } from "./server";
export { probeRedis, createStreamRedis, unreachableMessage, type RedisProbe } from "./redis";
export { prepareDb, type DbReadiness } from "./db-boot";

export async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger("stream", env.LOG_LEVEL);
  if (!env.DATABASE_URL) {
    log.error({}, "DATABASE_URL is not set; the stream server cannot check memberships");
    process.exit(1);
  }
  const db = createServiceDb({ max: 4 });
  const readiness = await prepareDb(db, log, { service: "stream" });
  // Redis is required for fan-out: one bounded probe, one clear line when it is down, then stay up and unhealthy.
  const probe = await probeRedis(env.REDIS_URL);
  if (!probe.ok) log.error({ reason: probe.reason }, unreachableMessage(env.REDIS_URL, probe));
  // Blocking XREADs run on duplicated connections; the base one only duplicates and answers /health pings.
  const redis = createStreamRedis(env.REDIS_URL, log);
  redis.connect().catch(() => undefined); // failures are logged (de-duplicated) by the client's error handler

  const auth = createTokenVerifier({
    supabaseUrl: env.SUPABASE_URL,
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
    devUserId: env.DEV_AUTH_USER_ID ?? null,
    appEnv: env.APP_ENV,
  });
  if (auth.devUserId) log.warn({ userId: auth.devUserId }, "DEV_AUTH_USER_ID is set: tokens are not verified (development/test only)");

  const server = createStreamServer({
    redis,
    auth,
    authorizer: createCachedAuthorizer(createRepoAuthorizer(db, { log })),
    log,
    options: {
      checkRedis: async () => redis.status === "ready" && (await redis.ping()) === "PONG",
    },
  });
  const address = await server.listen(servicePort(env, "STREAM_PORT"));
  log.info({ port: address.port, host: address.address, db: readiness.ok, driver: readiness.driver, redis: probe.ok }, "stream listening");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "stream shutting down");
    await server.close();
    await redis.quit().catch(() => redis.disconnect());
    await closeDb(db);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

const entry = process.argv[1] ?? "";
if (/apps[\\/]stream[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
