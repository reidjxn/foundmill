/**
 * Per-connector, per-business rate limiting (BUILD §9.5 "Rate limit per connector per business").
 *
 * Fixed windows keyed `rl:{businessId}:{connector}:{minute|day}:{windowStart}`; the limits come from
 * `connector.rateLimits` (BUILD §13.1) with a default when a connector declares none. The store is Redis in
 * staging/production and an in-memory map in development and tests; the Redis store degrades to memory when
 * Redis is unreachable so a Redis outage slows nothing down (the limit still applies per process).
 */

export interface RateLimitHit {
  count: number;
  /** Unix ms when the window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  /** Increments the counter for `key` inside a fixed window of `windowMs` and returns the new count. */
  hit(key: string, windowMs: number, now: number): Promise<RateLimitHit>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, RateLimitHit>();

  async hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    this.sweep(now);
    const current = this.counters.get(key);
    if (current && current.resetAt > now) {
      current.count += 1;
      return { ...current };
    }
    const fresh = { count: 1, resetAt: windowStart(now, windowMs) + windowMs };
    this.counters.set(key, fresh);
    return { ...fresh };
  }

  /** Current count without incrementing (tests, diagnostics). */
  peek(key: string, now: number): number {
    const current = this.counters.get(key);
    return current && current.resetAt > now ? current.count : 0;
  }

  private sweep(now: number): void {
    if (this.counters.size < 10_000) return;
    for (const [k, v] of this.counters) if (v.resetAt <= now) this.counters.delete(k);
  }
}

/** The ioredis surface the Redis store uses (structural, so tests can stub it). */
export interface RedisCounter {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
}

export interface RedisRateLimitStoreOptions {
  /** Called once when Redis fails and the store falls back to memory. */
  onFallback?: (error: unknown) => void;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly fallback = new MemoryRateLimitStore();
  private degraded = false;

  constructor(
    private readonly redis: RedisCounter,
    private readonly options: RedisRateLimitStoreOptions = {},
  ) {}

  get isDegraded(): boolean {
    return this.degraded;
  }

  async hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    if (this.degraded) return this.fallback.hit(key, windowMs, now);
    const start = windowStart(now, windowMs);
    const windowKey = `${key}:${start}`;
    try {
      const count = await this.redis.incr(windowKey);
      if (count === 1) await this.redis.pexpire(windowKey, windowMs + 1000);
      return { count, resetAt: start + windowMs };
    } catch (e) {
      this.degraded = true;
      this.options.onFallback?.(e);
      return this.fallback.hit(key, windowMs, now);
    }
  }
}

export const windowStart = (now: number, windowMs: number): number => Math.floor(now / windowMs) * windowMs;

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
/** Applied when a connector declares no `rateLimits.perMinute`. */
export const DEFAULT_PER_MINUTE = 600;

export interface RateLimitInput {
  businessId: string;
  connector: string;
  limits: { perMinute?: number; perDay?: number };
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Which window said no (or the tightest window when allowed). */
  scope: "minute" | "day";
  limit: number;
  remaining: number;
  /** Seconds until the limiting window resets; 0 when allowed. */
  retryAfterSeconds: number;
}

export function rateLimitKey(businessId: string, connector: string, scope: "minute" | "day"): string {
  return `rl:${businessId}:${connector}:${scope}`;
}

/** Counts this call against both windows and answers whether it may proceed. */
export async function checkRateLimit(store: RateLimitStore, input: RateLimitInput, now: number): Promise<RateLimitDecision> {
  const perMinute = input.limits.perMinute ?? DEFAULT_PER_MINUTE;
  const minute = await store.hit(rateLimitKey(input.businessId, input.connector, "minute"), MINUTE_MS, now);
  if (minute.count > perMinute) {
    return { allowed: false, scope: "minute", limit: perMinute, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((minute.resetAt - now) / 1000)) };
  }
  if (input.limits.perDay !== undefined) {
    const day = await store.hit(rateLimitKey(input.businessId, input.connector, "day"), DAY_MS, now);
    if (day.count > input.limits.perDay) {
      return { allowed: false, scope: "day", limit: input.limits.perDay, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((day.resetAt - now) / 1000)) };
    }
    const dayRemaining = input.limits.perDay - day.count;
    const minuteRemaining = perMinute - minute.count;
    return dayRemaining < minuteRemaining
      ? { allowed: true, scope: "day", limit: input.limits.perDay, remaining: dayRemaining, retryAfterSeconds: 0 }
      : { allowed: true, scope: "minute", limit: perMinute, remaining: minuteRemaining, retryAfterSeconds: 0 };
  }
  return { allowed: true, scope: "minute", limit: perMinute, remaining: perMinute - minute.count, retryAfterSeconds: 0 };
}
