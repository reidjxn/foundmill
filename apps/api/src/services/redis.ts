/**
 * Redis connection for the outbox relay and health. ioredis is created lazily-connecting so an unreachable Redis
 * never blocks boot; the relay only starts once a PING succeeds (see index.ts).
 */
import { Redis } from "ioredis";
import type { StreamRedis } from "@foundmill/events";
import type { ApiLogger } from "./log";

export type ApiRedis = Redis & StreamRedis;

export function createRedis(url: string, log: ApiLogger): ApiRedis | null {
  if (!url) return null;
  try {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
      retryStrategy: (times) => Math.min(30_000, 500 * 2 ** Math.min(times, 6)),
    });
    client.on("error", (err) => log.debug({ err: err.message }, "redis error"));
    return client as ApiRedis;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "could not create the Redis client");
    return null;
  }
}

/** PING with a timeout; never throws. */
export async function redisReachable(redis: ApiRedis | null, timeoutMs = 1_500): Promise<boolean> {
  if (!redis) return false;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect().catch(() => undefined);
    const pong = await Promise.race([redis.ping(), new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))]);
    return pong === "PONG";
  } catch {
    return false;
  }
}
