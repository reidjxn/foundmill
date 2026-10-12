/**
 * The allowance stores (SEC-13, audit 2026-10-12 #31): the memory store takes all keys or none and gives a hit back; the
 * Redis store sends one script per take (every replica counts against one window), gives a hit back with ZREM, and
 * falls back to memory when Redis fails, then tries Redis again after the cool-down. With REDIS_TEST_URL set, the
 * script itself runs against a real Redis.
 */
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { createRateLimitStore, MemoryRateLimitStore, RedisRateLimitStore, TAKE_SCRIPT, type RedisLimitClient } from "../services/rate-limit";

const rule = { limit: 2, windowMs: 1000 };

describe("MemoryRateLimitStore", () => {
  it("takes every key or none, frees up as the window slides, and gives a hit back", async () => {
    let now = 0;
    const s = new MemoryRateLimitStore(() => now);
    const a = await s.take([{ key: "u", rule }, { key: "b", rule: { limit: 5, windowMs: 1000 } }]);
    expect(a).toMatchObject({ ok: true, remaining: 1 });
    now = 100;
    expect(await s.take([{ key: "u", rule }])).toMatchObject({ ok: true, remaining: 0 });
    expect(await s.take([{ key: "b", rule: { limit: 5, windowMs: 1000 } }, { key: "u", rule }])).toEqual({ ok: false, retryAfterMs: 900 });
    // The refused take recorded nothing on "b" (3 left of 5 after one hit).
    expect(await s.take([{ key: "b", rule: { limit: 5, windowMs: 1000 } }])).toMatchObject({ ok: true, remaining: 3 });
    if (a.ok) await s.refund(a.ticket);
    expect(await s.take([{ key: "u", rule }])).toMatchObject({ ok: true, remaining: 0 });
    now = 1101;
    expect(await s.take([{ key: "u", rule }])).toMatchObject({ ok: true });
  });
});

/** A stand-in for the script's semantics, recording what the store sends. */
function fakeRedis() {
  const sets = new Map<string, { score: number; member: string }[]>();
  const calls: { script: string; keys: string[]; args: (string | number)[] }[] = [];
  let down = false;
  const client: RedisLimitClient & { calls: typeof calls; setDown(v: boolean): void; sets: typeof sets } = {
    calls,
    sets,
    setDown: (v) => void (down = v),
    async eval(script, numKeys, ...rest) {
      if (down) throw new Error("connect ECONNREFUSED");
      const keys = rest.slice(0, numKeys).map(String);
      const args = rest.slice(numKeys);
      calls.push({ script, keys, args });
      const now = Number(args[0]);
      const member = String(args[1]);
      let remaining = -1;
      for (let i = 0; i < keys.length; i++) {
        const limit = Number(args[2 + 2 * i]);
        const window = Number(args[3 + 2 * i]);
        const live = (sets.get(keys[i]!) ?? []).filter((m) => m.score > now - window);
        sets.set(keys[i]!, live);
        if (live.length >= limit) return [0, Math.max(1, live[0]!.score + window - now)];
        const left = limit - live.length - 1;
        if (remaining < 0 || left < remaining) remaining = left;
      }
      for (const k of keys) sets.get(k)!.push({ score: now, member });
      return [1, Math.max(0, remaining)];
    },
    async zrem(key, ...members) {
      if (down) throw new Error("connect ECONNREFUSED");
      sets.set(key, (sets.get(key) ?? []).filter((m) => !members.includes(m.member)));
      return 1;
    },
  };
  return client;
}

describe("RedisRateLimitStore", () => {
  it("sends one script per take with prefixed keys, limits and windows, and refunds with ZREM", async () => {
    const redis = fakeRedis();
    const now = 5_000;
    const s = new RedisRateLimitStore(redis, { now: () => now });
    const t = await s.take([{ key: "model:plan:user:60000:u1", rule }]);
    expect(t).toMatchObject({ ok: true, remaining: 1 });
    expect(redis.calls[0]).toMatchObject({ script: TAKE_SCRIPT, keys: ["rl:api:model:plan:user:60000:u1"], args: [5000, expect.stringMatching(/^5000:/), 2, 1000] });
    await s.take([{ key: "model:plan:user:60000:u1", rule }]);
    expect(await s.take([{ key: "model:plan:user:60000:u1", rule }])).toEqual({ ok: false, retryAfterMs: 1000 });
    if (t.ok) await s.refund(t.ticket);
    expect(await s.take([{ key: "model:plan:user:60000:u1", rule }])).toMatchObject({ ok: true, remaining: 0 });
  });

  it("falls back to memory when Redis fails (still enforcing), and tries Redis again after the cool-down", async () => {
    const redis = fakeRedis();
    let now = 0;
    const fallbacks: unknown[] = [];
    const s = new RedisRateLimitStore(redis, { now: () => now, coolDownMs: 30_000, onFallback: (e) => fallbacks.push(e) });
    redis.setDown(true);
    expect(await s.take([{ key: "k", rule }])).toMatchObject({ ok: true, remaining: 1 });
    expect(s.isDegraded).toBe(true);
    expect(await s.take([{ key: "k", rule }])).toMatchObject({ ok: true, remaining: 0 });
    expect(await s.take([{ key: "k", rule }])).toMatchObject({ ok: false });
    expect(fallbacks).toHaveLength(1);
    // Redis is back after the cool-down: answers come from Redis again.
    redis.setDown(false);
    now = 30_001;
    expect(await s.take([{ key: "k", rule }])).toMatchObject({ ok: true });
    expect(redis.calls.length).toBe(1);
    expect(s.isDegraded).toBe(false);
  });

  it("createRateLimitStore picks Redis only when there is a client", () => {
    expect(createRateLimitStore(null).kind).toBe("memory");
    expect(createRateLimitStore(fakeRedis()).kind).toBe("redis");
  });
});

// The script against a real Redis (CI and local runs set REDIS_TEST_URL to a scratch instance; never a shared one).
const url = process.env.REDIS_TEST_URL;
describe.runIf(Boolean(url))("TAKE_SCRIPT on Redis", () => {
  const redis = url ? new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1 }) : null;
  afterAll(async () => {
    await redis?.quit();
  });

  it("takes all keys or none, reports when to retry, and is shared by two stores (two replicas)", async () => {
    const prefix = `rl:test:${crypto.randomUUID()}:`;
    let now = 1_000_000;
    const one = new RedisRateLimitStore(redis!, { prefix, now: () => now });
    const two = new RedisRateLimitStore(redis!, { prefix, now: () => now });
    const first = await one.take([{ key: "u", rule }, { key: "b", rule: { limit: 3, windowMs: 1000 } }]);
    expect(first).toMatchObject({ ok: true, remaining: 1 });
    now += 100;
    expect(await two.take([{ key: "u", rule }])).toMatchObject({ ok: true, remaining: 0 });
    expect(await one.take([{ key: "b", rule: { limit: 3, windowMs: 1000 } }, { key: "u", rule }])).toEqual({ ok: false, retryAfterMs: 900 });
    // Nothing was recorded on "b" by the refused take: two of three left.
    expect(await two.take([{ key: "b", rule: { limit: 3, windowMs: 1000 } }])).toMatchObject({ ok: true, remaining: 1 });
    if (first.ok) await two.refund(first.ticket);
    expect(await one.take([{ key: "u", rule }])).toMatchObject({ ok: true, remaining: 0 });
    now += 1000;
    expect(await one.take([{ key: "u", rule }])).toMatchObject({ ok: true });
    expect(await redis!.pttl(`${prefix}u`)).toBeGreaterThan(0);
  });
});
