import { describe, expect, it } from "vitest";
import { ModelRateLimitError } from "./errors";
import { RateLimiter, availableAt, backoffWithJitter, parseRateLimitHeaders, waitForCapacity } from "./rate-limit";

function clock(start = 1_700_000_000_000) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("parseRateLimitHeaders", () => {
  it("reads every documented anthropic-ratelimit-* header and retry-after seconds", () => {
    const resetAt = 1_700_000_060_000;
    const headers = new Headers({
      "retry-after": "7",
      "anthropic-ratelimit-requests-limit": "1000",
      "anthropic-ratelimit-requests-remaining": "999",
      "anthropic-ratelimit-requests-reset": iso(resetAt),
      "anthropic-ratelimit-tokens-limit": "2400000",
      "anthropic-ratelimit-tokens-remaining": "2399000",
      "anthropic-ratelimit-tokens-reset": iso(resetAt),
      "anthropic-ratelimit-input-tokens-limit": "2000000",
      "anthropic-ratelimit-input-tokens-remaining": "1999000",
      "anthropic-ratelimit-input-tokens-reset": iso(resetAt),
      "anthropic-ratelimit-output-tokens-limit": "400000",
      "anthropic-ratelimit-output-tokens-remaining": "399000",
      "anthropic-ratelimit-output-tokens-reset": iso(resetAt),
    });
    const parsed = parseRateLimitHeaders(headers);
    expect(parsed.retryAfterMs).toBe(7000);
    expect(parsed.requests).toEqual({ limit: 1000, remaining: 999, resetAt });
    expect(parsed.tokens).toEqual({ limit: 2_400_000, remaining: 2_399_000, resetAt });
    expect(parsed.inputTokens).toEqual({ limit: 2_000_000, remaining: 1_999_000, resetAt });
    expect(parsed.outputTokens).toEqual({ limit: 400_000, remaining: 399_000, resetAt });
  });

  it("accepts plain records (case-insensitive) and leaves missing buckets undefined", () => {
    const parsed = parseRateLimitHeaders({ "Anthropic-Ratelimit-Requests-Limit": "50", "anthropic-ratelimit-requests-remaining": "49" });
    expect(parsed.requests).toEqual({ limit: 50, remaining: 49 });
    expect(parsed.inputTokens).toBeUndefined();
    expect(parsed.retryAfterMs).toBeUndefined();
  });
});

describe("bucket maths", () => {
  it("replenishes linearly towards the limit until reset", () => {
    const b = { limit: 100, remaining: 0, resetAt: 10_000, observedAt: 0 };
    expect(availableAt(b, 0)).toBe(0);
    expect(availableAt(b, 5_000)).toBe(50);
    expect(availableAt(b, 10_000)).toBe(100);
    expect(availableAt(b, 99_000)).toBe(100);
    expect(waitForCapacity(b, 25, 0)).toBe(2_500);
    expect(waitForCapacity(b, 25, 3_000)).toBe(0);
    expect(waitForCapacity(b, 101, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is optimistic when limits are unknown", () => {
    expect(availableAt({ limit: null, remaining: null, resetAt: null, observedAt: 0 }, 1)).toBeNull();
    expect(waitForCapacity({ limit: null, remaining: null, resetAt: null, observedAt: 0 }, 50, 1)).toBe(0);
  });
});

describe("backoffWithJitter", () => {
  it("is full jitter under an exponential ceiling", () => {
    expect(backoffWithJitter(0, { baseMs: 1000, random: () => 0.5 })).toBe(500);
    expect(backoffWithJitter(3, { baseMs: 1000, random: () => 1 })).toBe(8000);
    expect(backoffWithJitter(20, { baseMs: 1000, maxMs: 60_000, random: () => 1 })).toBe(60_000);
    for (let i = 0; i < 50; i++) {
      const v = backoffWithJitter(2, { baseMs: 1000 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4000);
    }
  });
});

describe("RateLimiter", () => {
  it("acquires immediately when capacity is known and sufficient", async () => {
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep });
    limiter.observe("k1", {
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-requests-remaining": "10",
      "anthropic-ratelimit-requests-reset": iso(c.now() + 60_000),
      "anthropic-ratelimit-input-tokens-limit": "100000",
      "anthropic-ratelimit-input-tokens-remaining": "100000",
      "anthropic-ratelimit-input-tokens-reset": iso(c.now() + 60_000),
    });
    const r = await limiter.acquire("k1", { requests: 1, inputTokens: 5000 });
    expect(r.waitedMs).toBe(0);
    expect(c.sleeps).toEqual([]);
    expect(limiter.available("k1").requests).toBe(9);
    expect(limiter.available("k1").inputTokens).toBe(95_000);
  });

  it("waits for replenishment when a bucket is empty, then reserves", async () => {
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep });
    limiter.observe("k1", {
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-requests-remaining": "0",
      "anthropic-ratelimit-requests-reset": iso(c.now() + 60_000),
    });
    const r = await limiter.acquire("k1", { requests: 1 });
    expect(r.waitedMs).toBe(1200); // 50 requests replenish over 60 s → 1 request every 1.2 s
    expect(c.sleeps).toEqual([1200]);
    expect(limiter.available("k1").requests).toBeCloseTo(0, 5);
  });

  it("throws instead of waiting longer than maxWaitMs or for impossible requests", async () => {
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep, maxWaitMs: 1000 });
    limiter.observe("k1", {
      "anthropic-ratelimit-output-tokens-limit": "1000",
      "anthropic-ratelimit-output-tokens-remaining": "0",
      "anthropic-ratelimit-output-tokens-reset": iso(c.now() + 60_000),
    });
    await expect(limiter.acquire("k1", { outputTokens: 500 })).rejects.toBeInstanceOf(ModelRateLimitError);
    await expect(limiter.acquire("k1", { outputTokens: 5000 })).rejects.toThrow(/more capacity than the key's limit/);
    expect(c.sleeps).toEqual([]);
  });

  it("scopes 429 penalties to the affected caller only (BUILD §10.3)", async () => {
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep, random: () => 0.5, baseBackoffMs: 1000 });
    const first = limiter.reportRateLimited("session-a");
    expect(first).toBe(500); // full jitter at 0.5 × 1000
    expect(limiter.penaltyFor("session-a")).toBe(500);
    expect(limiter.penaltyFor("session-b")).toBe(0);
    const second = limiter.reportRateLimited("session-a");
    expect(second).toBe(1000); // 0.5 × 2000
    expect(limiter.penalty("session-a")?.attempts).toBe(2);

    const b = await limiter.acquire("k1", { requests: 1 }, "session-b");
    expect(b.waitedMs).toBe(0);
    const a = await limiter.acquire("k1", { requests: 1 }, "session-a");
    expect(a.waitedMs).toBe(1000);

    limiter.clearPenalty("session-a");
    expect(limiter.penaltyFor("session-a")).toBe(0);
    expect(limiter.penalty("session-a")).toBeUndefined();
  });

  it("honours retry-after when it is longer than the jittered backoff and caps at maxBackoffMs", () => {
    const c = clock();
    const limiter = new RateLimiter({ now: c.now, sleep: c.sleep, random: () => 0.1, baseBackoffMs: 1000, maxBackoffMs: 30_000 });
    expect(limiter.reportRateLimited("s", { retryAfterMs: 7000 })).toBe(7000);
    expect(limiter.reportRateLimited("s", { retryAfterMs: 90_000 })).toBe(30_000);
  });

  it("estimates the largest squad the key supports", () => {
    const limiter = new RateLimiter();
    expect(limiter.estimateConcurrency("unknown", { inputTokens: 1 })).toBeNull();
    limiter.observe("k1", {
      "anthropic-ratelimit-requests-limit": "1000",
      "anthropic-ratelimit-input-tokens-limit": "2000000",
      "anthropic-ratelimit-output-tokens-limit": "400000",
    });
    expect(limiter.estimateConcurrency("k1", { requests: 10, inputTokens: 50_000, outputTokens: 5_000 })).toBe(40);
    expect(limiter.estimateConcurrency("k1", { outputTokens: 100_000 })).toBe(4);
  });

  it("snapshots and resets", () => {
    const limiter = new RateLimiter();
    limiter.observe("k1", { "anthropic-ratelimit-requests-limit": "5" });
    expect(limiter.snapshot("k1")?.requests.limit).toBe(5);
    limiter.reset();
    expect(limiter.snapshot("k1")).toBeUndefined();
  });
});
