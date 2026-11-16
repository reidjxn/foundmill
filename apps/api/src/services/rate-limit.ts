/**
 * Sliding-window limits for procedures that spend money on every call (a model call on the platform key, a vendor
 * lookup), shared by every api replica (SEC-13).
 *
 * `RateLimitStore` is what callers use (`ctx.limits`): `take` records one hit on every key when all of them have room
 * and nothing when any is full; `refund` gives a granted hit back when the call it paid for failed before reaching the
 * model. Two stores:
 *   - `RedisRateLimitStore` (staging and production, `REDIS_URL`): one sorted set per key, checked and written by one Lua
 *     script, so every replica counts against the same window and a take across several keys is atomic.
 *   - `MemoryRateLimitStore` (development, tests, and the Redis store's fallback): the same windows in this process.
 * When Redis fails the Redis store answers from its memory fallback for a short cool-down and then tries Redis again, so
 * an outage never blocks a founder and never lifts the limits (each replica still enforces them on its own).
 * Memory is bounded: timestamps outside the window are dropped on every take, and at most `maxKeys` keys are kept (the
 * least recently used goes first).
 */
import { randomUUID } from "node:crypto";
import { AppError } from "@foundmill/shared";

export interface WindowLimit {
  limit: number;
  windowMs: number;
}

export interface LimitEntry {
  key: string;
  rule: WindowLimit;
}

export type TakeResult = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

/** What a granted take recorded, so the hit can be given back (`refund`). */
export interface LimitTicket {
  keys: string[];
  at: number;
  member: string;
}

export type StoreTake = { ok: true; remaining: number; ticket: LimitTicket } | { ok: false; retryAfterMs: number };

export interface RateLimitStore {
  readonly kind: "memory" | "redis";
  /** Records a hit on every key when all of them have room; records nothing when any is full. */
  take(entries: readonly LimitEntry[]): Promise<StoreTake>;
  /** Gives a granted hit back (the call it paid for failed before reaching the model). */
  refund(ticket: LimitTicket): Promise<void>;
  /** How many hits `entry` still has in its window, recording nothing (the idea box's redraws left). */
  peek(entry: LimitEntry): Promise<number>;
}

/** The in-process window engine (synchronous): the memory store and the Redis store's fallback. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** What `take` would answer, without recording a hit. */
  peek(key: string, rule: WindowLimit): TakeResult {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > t - rule.windowMs);
    if (recent.length >= rule.limit) return { ok: false, retryAfterMs: Math.max(1, recent[0]! + rule.windowMs - t) };
    return { ok: true, remaining: rule.limit - recent.length };
  }

  /** Records a hit at `at` for every key when all of them have room; records nothing when any is full. */
  takeAll(entries: readonly LimitEntry[], at: number = this.now()): TakeResult {
    let remaining = Number.POSITIVE_INFINITY;
    for (const e of entries) {
      const r = this.peek(e.key, e.rule);
      if (!r.ok) return r;
      remaining = Math.min(remaining, r.remaining - 1);
    }
    for (const e of entries) {
      const recent = (this.hits.get(e.key) ?? []).filter((t) => t > at - e.rule.windowMs);
      recent.push(at);
      this.hits.delete(e.key);
      this.hits.set(e.key, recent);
    }
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    return { ok: true, remaining: Number.isFinite(remaining) ? remaining : 0 };
  }

  /** Removes one hit recorded at `at` from each key (the newest such hit). */
  refund(keys: readonly string[], at: number): void {
    for (const key of keys) {
      const list = this.hits.get(key);
      const i = list?.lastIndexOf(at) ?? -1;
      if (list && i >= 0) list.splice(i, 1);
    }
  }

  reset(): void {
    this.hits.clear();
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly kind = "memory" as const;
  private readonly limiter: SlidingWindowLimiter;

  constructor(private readonly now: () => number = Date.now) {
    this.limiter = new SlidingWindowLimiter(now);
  }

  async take(entries: readonly LimitEntry[]): Promise<StoreTake> {
    return this.takeNow(entries);
  }

  /** The same as `take`, synchronously (the Redis store's fallback). */
  takeNow(entries: readonly LimitEntry[]): StoreTake {
    const at = this.now();
    const r = this.limiter.takeAll(entries, at);
    return r.ok ? { ...r, ticket: { keys: entries.map((e) => e.key), at, member: "" } } : r;
  }

  async refund(ticket: LimitTicket): Promise<void> {
    this.limiter.refund(ticket.keys, ticket.at);
  }

  async peek(entry: LimitEntry): Promise<number> {
    return this.peekNow(entry);
  }

  /** The same as `peek`, synchronously (the Redis store's fallback). */
  peekNow(entry: LimitEntry): number {
    const r = this.limiter.peek(entry.key, entry.rule);
    return r.ok ? r.remaining : 0;
  }

  /** Forgets every window (tests start each case with a full allowance). */
  reset(): void {
    this.limiter.reset();
  }
}

/**
 * KEYS: one sorted set per window. ARGV: now (ms), the hit's member, then limit and window (ms) per key. Answers
 * `{1, remaining}` after recording the hit on every key, or `{0, retryAfterMs}` having recorded nothing.
 */
export const TAKE_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local remaining = -1
for i = 1, #KEYS do
  local limit = tonumber(ARGV[1 + 2 * i])
  local window = tonumber(ARGV[2 + 2 * i])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  local count = redis.call('ZCARD', KEYS[i])
  if count >= limit then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    local retry = window
    if oldest[2] then retry = tonumber(oldest[2]) + window - now end
    if retry < 1 then retry = 1 end
    return {0, retry}
  end
  local left = limit - count - 1
  if remaining < 0 or left < remaining then remaining = left end
end
for i = 1, #KEYS do
  redis.call('ZADD', KEYS[i], now, member)
  redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[2 + 2 * i]))
end
if remaining < 0 then remaining = 0 end
return {1, remaining}
`;

/** KEYS[1]: one window. ARGV: now (ms), limit, window (ms). Answers the hits left, recording nothing. */
export const PEEK_SCRIPT = `
local count = redis.call('ZCOUNT', KEYS[1], '(' .. (tonumber(ARGV[1]) - tonumber(ARGV[3])), '+inf')
local left = tonumber(ARGV[2]) - count
if left < 0 then left = 0 end
return left
`;

/** The ioredis surface the Redis store uses (structural, so tests can stub it). */
export interface RedisLimitClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
}

export interface RedisRateLimitStoreOptions {
  now?: () => number;
  /** Prefix for every key, so limits never collide with the event streams in the same Redis. */
  prefix?: string;
  /** How long the store answers from memory after a Redis failure before it tries Redis again. */
  coolDownMs?: number;
  /** Called when Redis fails and the store falls back to memory (once per outage). */
  onFallback?: (error: unknown) => void;
}

export class RedisRateLimitStore implements RateLimitStore {
  readonly kind = "redis" as const;
  private readonly now: () => number;
  private readonly prefix: string;
  private readonly coolDownMs: number;
  private readonly fallback: MemoryRateLimitStore;
  private degradedUntil = 0;

  constructor(
    private readonly redis: RedisLimitClient,
    private readonly options: RedisRateLimitStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.prefix = options.prefix ?? "rl:api:";
    this.coolDownMs = options.coolDownMs ?? 30_000;
    this.fallback = new MemoryRateLimitStore(this.now);
  }

  /** True while answers come from the memory fallback. */
  get isDegraded(): boolean {
    return this.degradedUntil > this.now();
  }

  async take(entries: readonly LimitEntry[]): Promise<StoreTake> {
    if (entries.length === 0) return { ok: true, remaining: 0, ticket: { keys: [], at: this.now(), member: "" } };
    if (this.isDegraded) return this.fallback.takeNow(entries);
    const at = this.now();
    const member = `${at}:${randomUUID()}`;
    const keys = entries.map((e) => this.prefix + e.key);
    const args = entries.flatMap((e) => [e.rule.limit, e.rule.windowMs]);
    try {
      const answer = (await this.redis.eval(TAKE_SCRIPT, keys.length, ...keys, at, member, ...args)) as [number, number];
      if (!Array.isArray(answer) || answer.length < 2) throw new Error("unexpected answer from the rate-limit script");
      return Number(answer[0]) === 1 ? { ok: true, remaining: Number(answer[1]), ticket: { keys, at, member } } : { ok: false, retryAfterMs: Math.max(1, Number(answer[1])) };
    } catch (err) {
      if (!this.isDegraded) this.options.onFallback?.(err);
      this.degradedUntil = this.now() + this.coolDownMs;
      return this.fallback.takeNow(entries);
    }
  }

  async peek(entry: LimitEntry): Promise<number> {
    if (this.isDegraded) return this.fallback.peekNow(entry);
    try {
      const answer = Number(await this.redis.eval(PEEK_SCRIPT, 1, this.prefix + entry.key, this.now(), entry.rule.limit, entry.rule.windowMs));
      if (!Number.isFinite(answer)) throw new Error("unexpected answer from the rate-limit peek");
      return answer;
    } catch (err) {
      if (!this.isDegraded) this.options.onFallback?.(err);
      this.degradedUntil = this.now() + this.coolDownMs;
      return this.fallback.peekNow(entry);
    }
  }

  async refund(ticket: LimitTicket): Promise<void> {
    // A ticket from the fallback has no member: it lives in memory.
    if (!ticket.member) return this.fallback.refund(ticket);
    try {
      await Promise.all(ticket.keys.map((key) => this.redis.zrem(key, ticket.member)));
    } catch {
      // A refund that cannot reach Redis is dropped: the hit expires with its window.
    }
  }
}

/** Redis when the api has a client, memory otherwise. */
export function createRateLimitStore(redis: RedisLimitClient | null, options: RedisRateLimitStoreOptions = {}): RateLimitStore {
  return redis ? new RedisRateLimitStore(redis, options) : new MemoryRateLimitStore(options.now);
}

/** TOO_MANY_REQUESTS (429) with a sentence the founder can act on. */
export class RateLimitedError extends AppError {
  constructor(what: string, retryAfterMs: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
    super("rate_limited", `${what} limit reached. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`, 429, { retryAfterMs });
  }
}

/** Takes one hit from every entry, or throws TOO_MANY_REQUESTS naming `what` (nothing recorded). */
export async function takeOrThrow(store: RateLimitStore, what: string, entries: readonly LimitEntry[]): Promise<LimitTicket> {
  const r = await store.take(entries);
  if (!r.ok) throw new RateLimitedError(what, r.retryAfterMs);
  return r.ticket;
}
