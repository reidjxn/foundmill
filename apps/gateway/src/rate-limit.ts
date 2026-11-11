/**
 * Per-connector, per-business rate limiting (BUILD §9.5 "Rate limit per connector per business").
 *
 * Fixed windows keyed `rl:{businessId}:{connector}:{minute|day}:{windowStart}`; the limits come from
 * `connector.rateLimits` (BUILD §13.1) with a default when a connector declares none. The store is Redis in
 * staging/production and an in-memory map in development and tests; the Redis store degrades to memory while
 * Redis is unreachable so a Redis outage slows nothing down (the limit still applies per process), and goes back to
 * Redis once it answers. /health reports the store actually in use.
 */

export interface RateLimitHit {
  count: number;
  /** Unix ms when the window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  /** Increments the counter for `key` inside a fixed window of `windowMs` and returns the new count. */
  hit(key: string, windowMs: number, now: number): Promise<RateLimitHit>;
  /**
   * Gives back one count in the current window (a counted send that did not go out: refused by the next guard, or by the
   * vendor). Optional: a store without it keeps the count, which only errs on the strict side.
   */
  release?(key: string, windowMs: number, now: number): Promise<void>;
  /**
   * True while the counts are shared by every replica and kept across restarts (Redis answering). A per-process memory
   * store, or a Redis store counting in memory while Redis is down, is not: a cap that must hold across replicas (a
   * project's daily sends) refuses rather than count there. Absent = not durable.
   */
  readonly durable?: boolean;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, RateLimitHit>();
  /** This process's memory: another replica, or this one after a restart, counts from zero. */
  readonly durable: boolean = false;

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

  async release(key: string, windowMs: number, now: number): Promise<void> {
    const current = this.counters.get(key);
    if (current && current.resetAt > now && current.resetAt === windowStart(now, windowMs) + windowMs && current.count > 0) current.count -= 1;
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
  decr?(key: string): Promise<number>;
}

export interface RedisRateLimitStoreOptions {
  /** Called when Redis fails and the store falls back to memory (once per outage, not per call). */
  onFallback?: (error: unknown) => void;
  /** Called when Redis answers again after a fallback. */
  onRecover?: () => void;
  /** How long the store stays on memory after a Redis failure before it tries Redis again (default 30 s). */
  retryAfterMs?: number;
}

/**
 * Counters in Redis (shared by every replica, kept across redeploys). A Redis failure moves the store to memory for
 * `retryAfterMs`, so an outage slows no call down, and then Redis is tried again: until 2026-10-12 one failure (the very
 * first call, issued while the lazily connecting client was still connecting) moved it to memory for good.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly fallback = new MemoryRateLimitStore();
  private degraded = false;
  private retryAt = 0;

  constructor(
    private readonly redis: RedisCounter,
    private readonly options: RedisRateLimitStoreOptions = {},
  ) {}

  /** True from a Redis failure until Redis answers again. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /** Counting in Redis right now (the last call reached it). */
  get durable(): boolean {
    return !this.degraded;
  }

  async hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    if (this.degraded && now < this.retryAt) return this.fallback.hit(key, windowMs, now);
    const start = windowStart(now, windowMs);
    const windowKey = `${key}:${start}`;
    try {
      const count = await this.redis.incr(windowKey);
      if (count === 1) await this.redis.pexpire(windowKey, windowMs + 1000);
      if (this.degraded) {
        this.degraded = false;
        this.options.onRecover?.();
      }
      return { count, resetAt: start + windowMs };
    } catch (e) {
      if (!this.degraded) this.options.onFallback?.(e);
      this.degraded = true;
      this.retryAt = now + (this.options.retryAfterMs ?? 30_000);
      return this.fallback.hit(key, windowMs, now);
    }
  }

  async release(key: string, windowMs: number, now: number): Promise<void> {
    if (this.degraded && now < this.retryAt) return this.fallback.release(key, windowMs, now);
    if (!this.redis.decr) return;
    try {
      await this.redis.decr(`${key}:${windowStart(now, windowMs)}`);
    } catch {
      // Best effort: a count that stays only errs on the strict side.
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
