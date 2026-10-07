/**
 * Redis for the stream server (docs/ARCHITECTURE.md §12). The server cannot fan out without Redis streams, so when
 * Redis is unreachable it stays up and unhealthy (`/health` → 503, subscriptions answer `unavailable`) and says so
 * once, instead of exiting (a restart loop on Railway) or logging every reconnect attempt (ioredis emits an `error`
 * per attempt forever).
 *
 * - `probeRedis(url)`: one bounded connect + PING; never throws.
 * - `createStreamRedis(url, log)`: ioredis with a capped reconnect backoff, errors logged once per distinct failure and
 *   a line when it comes back; readers (StreamHub) resume by themselves.
 */
import { Redis } from "ioredis";
import type { StreamLog } from "./hub";

export interface RedisProbe {
  ok: boolean;
  reason: string | null;
}

export const REDIS_PROBE_TIMEOUT_MS = 1_500;
/** Reconnect backoff: 200 ms × attempts, capped at 10 s. */
export const REDIS_RETRY_CAP_MS = 10_000;

export const redactUrl = (url: string): string => url.replace(/\/\/[^@/]*@/, "//***@");

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

/** The one line the boot logs when Redis is down: what is affected and what to do. */
export function unreachableMessage(url: string, probe: RedisProbe): string {
  return `Redis is unreachable at ${redactUrl(url)} (${probe.reason}); the stream server is up but unhealthy (/health 503) and tabs cannot subscribe until it answers. Start Redis or set REDIS_URL; readers reconnect by themselves.`;
}

/** ioredis for the hub: blocking XREADs run on `duplicate()`d connections, this one answers pings and duplicates. */
export function createStreamRedis(url: string, log: Pick<StreamLog, "warn" | "info">): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, REDIS_RETRY_CAP_MS),
  });
  let lastError: string | null = null;
  client.on("error", (err: Error) => {
    if (err.message === lastError) return;
    lastError = err.message;
    log.warn({ err: err.message, url: redactUrl(url) }, "redis error (reconnecting with a capped backoff; repeated identical errors are not logged again)");
  });
  client.on("ready", () => {
    if (lastError !== null) log.info({ url: redactUrl(url) }, "redis reconnected");
    lastError = null;
  });
  return client;
}
