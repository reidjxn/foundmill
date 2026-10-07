/**
 * Redis for the orchestrator: session streams (`as:{sessionId}`) and the control bus (`asctl:{sessionId}`).
 *
 * Without Redis the worker must still start with one clear log line, never a crash loop (docs/ARCHITECTURE.md §3,
 * §10). `probeRedis` answers once, with a bound; `chooseRedisBackend` turns the answer into a decision:
 *   - reachable → ioredis;
 *   - unreachable in development/test → the in-memory stream + control bus for this process (browser tabs get no
 *     live session events and signals only reach sessions in this worker; a warning says so);
 *   - unreachable in staging/production → ioredis anyway, retrying with a capped backoff, one error line now and one
 *     per change of failure reason afterwards (not one per attempt).
 */
import { Redis } from "ioredis";

export interface RedisLog {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface RedisProbe {
  ok: boolean;
  reason: string | null;
}

export interface RedisBackendChoice {
  kind: "redis" | "memory";
  level: "info" | "warn" | "error";
  message: string;
}

export const REDIS_PROBE_TIMEOUT_MS = 1_500;
/** Reconnect backoff: 200 ms × attempts, capped at 10 s. */
export const REDIS_RETRY_CAP_MS = 10_000;

const redact = (url: string) => url.replace(/\/\/[^@/]*@/, "//***@");

/** One bounded connect + PING; never throws. */
export async function probeRedis(url: string, timeoutMs = REDIS_PROBE_TIMEOUT_MS): Promise<RedisProbe> {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null, connectTimeout: timeoutMs });
  client.on("error", () => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    const pong = await Promise.race([
      client.connect().then(() => client.ping()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return pong === "PONG" ? { ok: true, reason: null } : { ok: false, reason: `unexpected PING reply ${String(pong)}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  } finally {
    if (timer) clearTimeout(timer);
    client.disconnect();
  }
}

export function chooseRedisBackend(env: { APP_ENV: string; REDIS_URL: string }, probe: RedisProbe): RedisBackendChoice {
  const url = redact(env.REDIS_URL);
  if (probe.ok) return { kind: "redis", level: "info", message: `redis reachable at ${url}` };
  if (env.APP_ENV === "development" || env.APP_ENV === "test") {
    return {
      kind: "memory",
      level: "warn",
      message: `Redis is unreachable at ${url} (${probe.reason}); session streams and the control bus run in memory for this process: browser tabs will not receive live session events and shouts/pauses only reach sessions in this worker. Start Redis (or set REDIS_URL) to enable them.`,
    };
  }
  return {
    kind: "redis",
    level: "error",
    message: `Redis is unreachable at ${url} (${probe.reason}); the worker keeps running and reconnects with a capped backoff, but session events cannot be streamed until it answers.`,
  };
}

/** ioredis with a capped reconnect backoff and de-duplicated error logging (one line per distinct failure, not per attempt). */
export function createRedisClient(url: string, log: RedisLog): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, REDIS_RETRY_CAP_MS),
  });
  let lastError: string | null = null;
  client.on("error", (err: Error) => {
    if (err.message === lastError) return;
    lastError = err.message;
    log.warn({ err: err.message, url: redact(url) }, "redis error (reconnecting with a capped backoff; repeated identical errors are not logged again)");
  });
  client.on("ready", () => {
    if (lastError !== null) log.info({ url: redact(url) }, "redis reconnected");
    lastError = null;
  });
  return client;
}
