import { describe, expect, it } from "vitest";
import { checkRateLimit, DAY_MS, DEFAULT_PER_MINUTE, MemoryRateLimitStore, MINUTE_MS, RedisRateLimitStore, type RedisCounter } from "../rate-limit";

const T0 = Date.UTC(2026, 9, 7, 10, 0, 0);

describe("MemoryRateLimitStore", () => {
  it("counts within a fixed window and resets after it", async () => {
    const store = new MemoryRateLimitStore();
    expect((await store.hit("k", MINUTE_MS, T0)).count).toBe(1);
    expect((await store.hit("k", MINUTE_MS, T0 + 30_000)).count).toBe(2);
    expect((await store.hit("k", MINUTE_MS, T0 + MINUTE_MS)).count).toBe(1);
  });
});

describe("checkRateLimit", () => {
  it("allows up to the per-minute limit then refuses with a retry-after", async () => {
    const store = new MemoryRateLimitStore();
    const input = { businessId: "b", connector: "c", limits: { perMinute: 2 } };
    expect((await checkRateLimit(store, input, T0)).allowed).toBe(true);
    const second = await checkRateLimit(store, input, T0 + 1000);
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    const third = await checkRateLimit(store, input, T0 + 2000);
    expect(third).toMatchObject({ allowed: false, scope: "minute", limit: 2, remaining: 0 });
    expect(third.retryAfterSeconds).toBe(58);
    expect((await checkRateLimit(store, input, T0 + MINUTE_MS)).allowed).toBe(true);
  });

  it("is keyed per business and per connector", async () => {
    const store = new MemoryRateLimitStore();
    const limits = { perMinute: 1 };
    expect((await checkRateLimit(store, { businessId: "a", connector: "c", limits }, T0)).allowed).toBe(true);
    expect((await checkRateLimit(store, { businessId: "a", connector: "c", limits }, T0)).allowed).toBe(false);
    expect((await checkRateLimit(store, { businessId: "b", connector: "c", limits }, T0)).allowed).toBe(true);
    expect((await checkRateLimit(store, { businessId: "a", connector: "d", limits }, T0)).allowed).toBe(true);
  });

  it("applies the daily limit too and reports the tighter window", async () => {
    const store = new MemoryRateLimitStore();
    const input = { businessId: "b", connector: "c", limits: { perMinute: 100, perDay: 2 } };
    expect(await checkRateLimit(store, input, T0)).toMatchObject({ allowed: true, scope: "day", remaining: 1 });
    expect(await checkRateLimit(store, input, T0 + MINUTE_MS * 5)).toMatchObject({ allowed: true, scope: "day", remaining: 0 });
    const refused = await checkRateLimit(store, input, T0 + MINUTE_MS * 10);
    expect(refused).toMatchObject({ allowed: false, scope: "day", limit: 2 });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(DAY_MS / 1000);
  });

  it("uses the default per-minute limit when a connector declares none", async () => {
    const store = new MemoryRateLimitStore();
    const d = await checkRateLimit(store, { businessId: "b", connector: "c", limits: {} }, T0);
    expect(d).toMatchObject({ allowed: true, limit: DEFAULT_PER_MINUTE, remaining: DEFAULT_PER_MINUTE - 1 });
  });
});

describe("RedisRateLimitStore", () => {
  it("uses INCR + PEXPIRE on the first hit of a window", async () => {
    const calls: string[] = [];
    const counters = new Map<string, number>();
    const redis: RedisCounter = {
      async incr(key) {
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        calls.push(`incr ${key}`);
        return n;
      },
      async pexpire(key, ms) {
        calls.push(`pexpire ${key} ${ms}`);
      },
    };
    const store = new RedisRateLimitStore(redis);
    expect((await store.hit("rl:b:c:minute", MINUTE_MS, T0)).count).toBe(1);
    expect((await store.hit("rl:b:c:minute", MINUTE_MS, T0 + 1)).count).toBe(2);
    expect(calls.filter((c) => c.startsWith("pexpire"))).toHaveLength(1);
    expect(store.isDegraded).toBe(false);
  });

  it("falls back to memory when Redis fails and says so once", async () => {
    let fallbacks = 0;
    const redis: RedisCounter = {
      async incr() {
        throw new Error("ECONNREFUSED");
      },
      async pexpire() {},
    };
    const store = new RedisRateLimitStore(redis, { onFallback: () => (fallbacks += 1) });
    expect((await store.hit("k", MINUTE_MS, T0)).count).toBe(1);
    expect((await store.hit("k", MINUTE_MS, T0)).count).toBe(2);
    expect(store.isDegraded).toBe(true);
    expect(fallbacks).toBe(1);
  });
});

describe("RedisRateLimitStore after a Redis failure", () => {
  it("tries Redis again after the cooldown and goes back to it (the first call used to latch memory for good)", async () => {
    let up = false;
    const counters = new Map<string, number>();
    let recovered = 0;
    const redis: RedisCounter = {
      async incr(key) {
        // The lazily connecting client refuses the very first command (offline queue off).
        if (!up) throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        return n;
      },
      async pexpire() {},
    };
    const store = new RedisRateLimitStore(redis, { retryAfterMs: 30_000, onRecover: () => (recovered += 1) });
    await store.hit("k", DAY_MS, T0);
    expect(store.isDegraded).toBe(true);
    up = true;
    // Within the cooldown the store stays on memory without asking Redis.
    await store.hit("k", DAY_MS, T0 + 10_000);
    expect(counters.size).toBe(0);
    // After it, Redis is asked again and counts from there on.
    expect((await store.hit("k", DAY_MS, T0 + 31_000)).count).toBe(1);
    expect((await store.hit("k", DAY_MS, T0 + 32_000)).count).toBe(2);
    expect(store.isDegraded).toBe(false);
    expect(recovered).toBe(1);
  });

  it("reports one fallback per outage", async () => {
    let fallbacks = 0;
    let up = true;
    const redis: RedisCounter = {
      async incr() {
        if (!up) throw new Error("ECONNRESET");
        return 1;
      },
      async pexpire() {},
    };
    const store = new RedisRateLimitStore(redis, { retryAfterMs: 1_000, onFallback: () => (fallbacks += 1) });
    up = false;
    await store.hit("k", MINUTE_MS, T0);
    await store.hit("k", MINUTE_MS, T0 + 2_000);
    expect(fallbacks).toBe(1);
    up = true;
    await store.hit("k", MINUTE_MS, T0 + 4_000);
    up = false;
    await store.hit("k", MINUTE_MS, T0 + 4_500);
    expect(fallbacks).toBe(2);
  });
});
