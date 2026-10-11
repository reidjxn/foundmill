/**
 * @foundmill/stream — WebSocket fan-out of Redis streams `ev:{businessId}` / `as:{sessionId}` to browser tabs
 * (docs/ARCHITECTURE.md §12, BUILD §8.2).
 *
 * Boot: load env → service database (repositories only, for membership checks) → ioredis → token verifier
 * (Supabase JWKS, or the dev bypass in development/test) → stream server listening on PORT (fallback STREAM_PORT)
 * on host "::" (Railway's private network is IPv6-only, §17; falls back to 0.0.0.0). SIGTERM/SIGINT: refuse new
 * upgrades, close every socket with 1001 "going away" (clients reconnect, to the new deployment), stop the Redis
 * readers, close Redis and the database pool, exit 0, within SHUTDOWN_TIMEOUT_MS (docs/DEPLOY.md §3). The browser
 * client lives in `./client` (`@foundmill/stream/client`) and pulls in none of this.
 */
import { createServiceDb, closeDb } from "@foundmill/db";
import { loadEnv, servicePort } from "@foundmill/shared";
import { createLogger } from "@foundmill/shared/logger";
import { onShutdown } from "@foundmill/shared/shutdown";
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
  let redis: ReturnType<typeof createStreamRedis> | null = null;
  let server: ReturnType<typeof createStreamServer> | null = null;
  const lifecycle = onShutdown({
    service: "stream",
    log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    steps: () => [
      // Refuses new upgrades, sends 1001 to every socket, waits for the close handshakes, stops the readers and the HTTP server.
      { name: "close sockets", run: () => server?.close() },
      { name: "close redis", run: () => redis?.quit().catch(() => redis?.disconnect()) },
      { name: "close database", run: () => closeDb(db) },
    ],
  });
  const readiness = await prepareDb(db, log, { service: "stream" });
  // Redis is required for fan-out: one bounded probe, one clear line when it is down, then stay up and unhealthy.
  const probe = await probeRedis(env.REDIS_URL);
  if (!probe.ok) log.error({ reason: probe.reason }, unreachableMessage(env.REDIS_URL, probe));
  // Blocking XREADs run on duplicated connections; the base one only duplicates and answers /health pings.
  redis = createStreamRedis(env.REDIS_URL, log);
  redis.connect().catch(() => undefined); // failures are logged (de-duplicated) by the client's error handler
  const client = redis;

  const auth = createTokenVerifier({
    supabaseUrl: env.SUPABASE_URL,
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
    devUserId: env.DEV_AUTH_USER_ID ?? null,
    appEnv: env.APP_ENV,
  });
  if (auth.devUserId) log.warn({ userId: auth.devUserId }, "DEV_AUTH_USER_ID is set: tokens are not verified (development/test only)");

  if (lifecycle.stopping) return;
  server = createStreamServer({
    redis: client,
    auth,
    authorizer: createCachedAuthorizer(createRepoAuthorizer(db, { log })),
    log,
    options: {
      checkRedis: async () => client.status === "ready" && (await client.ping()) === "PONG",
    },
  });
  const address = await server.listen(servicePort(env, "STREAM_PORT"));
  log.info({ port: address.port, host: address.address, db: readiness.ok, driver: readiness.driver, redis: probe.ok }, "stream listening");
}

const entry = process.argv[1] ?? "";
if (/apps[\\/]stream[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
