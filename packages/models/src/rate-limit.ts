/**
 * Rate-limit-aware scheduling (BUILD §10.3, docs/ARCHITECTURE.md §6).
 *
 * One `RateLimiter` holds token buckets per API key (requests, input tokens, output tokens), refreshed from Anthropic's
 * `anthropic-ratelimit-*` response headers. Anthropic replenishes continuously (token bucket), so between two
 * observations we interpolate linearly towards the limit at `*-reset`. `acquire()` waits until the needed capacity is
 * available and reserves it locally; `reportRateLimited()` applies exponential backoff with full jitter to ONE caller
 * scope (the agent session) so a 429 for one session never stalls the rest of the squad.
 *
 * Header names (verified against platform.claude.com/docs/en/api/rate-limits on 2026-10-05):
 *   retry-after (seconds)
 *   anthropic-ratelimit-requests-{limit,remaining,reset}
 *   anthropic-ratelimit-tokens-{limit,remaining,reset}            (most restrictive combined limit)
 *   anthropic-ratelimit-input-tokens-{limit,remaining,reset}
 *   anthropic-ratelimit-output-tokens-{limit,remaining,reset}
 * `*-reset` values are RFC 3339 timestamps; `*-remaining` token counts are rounded to the nearest thousand.
 */
import { ModelRateLimitError } from "./errors";

export type BucketKind = "requests" | "inputTokens" | "outputTokens" | "tokens";

export interface BucketState {
  limit: number | null;
  /** Remaining at `observedAt`, as reported (or as reserved locally since). */
  remaining: number | null;
  /** Epoch ms when the bucket is fully replenished. */
  resetAt: number | null;
  /** Epoch ms of the observation `remaining` refers to. */
  observedAt: number;
}

export interface KeyLimits {
  requests: BucketState;
  inputTokens: BucketState;
  outputTokens: BucketState;
  tokens: BucketState;
  /** Last time any header was observed for this key. */
  updatedAt: number;
}

export interface Need {
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface Penalty {
  attempts: number;
  until: number;
  lastBackoffMs: number;
}

export interface RateLimiterOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Uniform [0,1) source for jitter. */
  random?: () => number;
  /** First backoff on a 429 (ms). Default 1000. */
  baseBackoffMs?: number;
  /** Cap for one backoff (ms). Default 60000. */
  maxBackoffMs?: number;
  /** Longest `acquire()` is willing to wait before throwing ModelRateLimitError (ms). Default 120000. */
  maxWaitMs?: number;
}

export type HeadersLike = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

export interface ParsedRateLimitHeaders {
  retryAfterMs?: number;
  requests?: Partial<Pick<BucketState, "limit" | "remaining" | "resetAt">>;
  tokens?: Partial<Pick<BucketState, "limit" | "remaining" | "resetAt">>;
  inputTokens?: Partial<Pick<BucketState, "limit" | "remaining" | "resetAt">>;
  outputTokens?: Partial<Pick<BucketState, "limit" | "remaining" | "resetAt">>;
}

function readHeader(headers: HeadersLike, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v === null ? undefined : v;
  }
  const rec = headers as Record<string, string | string[] | undefined>;
  const direct = rec[name] ?? rec[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  if (direct !== undefined) return direct;
  const found = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = found ? rec[found] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

const toInt = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number.parseInt(s.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
};

const toEpochMs = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};

function readBucket(headers: HeadersLike, prefix: string): Partial<Pick<BucketState, "limit" | "remaining" | "resetAt">> | undefined {
  const limit = toInt(readHeader(headers, `${prefix}-limit`));
  const remaining = toInt(readHeader(headers, `${prefix}-remaining`));
  const resetAt = toEpochMs(readHeader(headers, `${prefix}-reset`));
  if (limit === undefined && remaining === undefined && resetAt === undefined) return undefined;
  const out: Partial<Pick<BucketState, "limit" | "remaining" | "resetAt">> = {};
  if (limit !== undefined) out.limit = limit;
  if (remaining !== undefined) out.remaining = remaining;
  if (resetAt !== undefined) out.resetAt = resetAt;
  return out;
}

/** Parse Anthropic rate-limit headers from a fetch `Headers` or a plain record. Missing headers are left undefined. */
export function parseRateLimitHeaders(headers: HeadersLike): ParsedRateLimitHeaders {
  const out: ParsedRateLimitHeaders = {};
  const retryAfter = readHeader(headers, "retry-after");
  if (retryAfter !== undefined) {
    const secs = Number.parseFloat(retryAfter);
    if (Number.isFinite(secs)) out.retryAfterMs = Math.max(0, Math.round(secs * 1000));
    else {
      const at = toEpochMs(retryAfter);
      if (at !== undefined) out.retryAfterMs = Math.max(0, at - Date.now());
    }
  }
  const requests = readBucket(headers, "anthropic-ratelimit-requests");
  const tokens = readBucket(headers, "anthropic-ratelimit-tokens");
  const inputTokens = readBucket(headers, "anthropic-ratelimit-input-tokens");
  const outputTokens = readBucket(headers, "anthropic-ratelimit-output-tokens");
  if (requests) out.requests = requests;
  if (tokens) out.tokens = tokens;
  if (inputTokens) out.inputTokens = inputTokens;
  if (outputTokens) out.outputTokens = outputTokens;
  return out;
}

/** Exponential backoff with full jitter: uniform in [0, min(max, base * 2^attempt)], attempt starting at 0. */
export function backoffWithJitter(attempt: number, opts: { baseMs?: number; maxMs?: number; random?: () => number } = {}): number {
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 60_000;
  const random = opts.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}

const emptyBucket = (now: number): BucketState => ({ limit: null, remaining: null, resetAt: null, observedAt: now });

/** Available capacity of a bucket at `now`, assuming linear replenishment to `limit` by `resetAt`. `null` = unknown. */
export function availableAt(bucket: BucketState, now: number): number | null {
  if (bucket.remaining === null) return null;
  if (bucket.limit === null || bucket.resetAt === null) return bucket.remaining;
  if (now >= bucket.resetAt || bucket.resetAt <= bucket.observedAt) return bucket.limit;
  const fraction = Math.min(1, Math.max(0, (now - bucket.observedAt) / (bucket.resetAt - bucket.observedAt)));
  return Math.min(bucket.limit, bucket.remaining + (bucket.limit - bucket.remaining) * fraction);
}

/** Milliseconds until `bucket` can supply `need` units at `now` (0 when it already can; Infinity when it never can). */
export function waitForCapacity(bucket: BucketState, need: number, now: number): number {
  if (need <= 0) return 0;
  const avail = availableAt(bucket, now);
  if (avail === null || avail >= need) return 0;
  if (bucket.limit === null || bucket.resetAt === null) return 0; // unknown limit: optimistic
  if (need > bucket.limit) return Number.POSITIVE_INFINITY;
  if (bucket.remaining === null) return 0;
  const span = bucket.resetAt - bucket.observedAt;
  if (span <= 0) return 0;
  const deficit = need - bucket.remaining;
  const rate = (bucket.limit - bucket.remaining) / span; // units per ms
  if (rate <= 0) return Math.max(0, bucket.resetAt - now);
  const t = bucket.observedAt + deficit / rate;
  return Math.max(0, Math.ceil(t - now));
}

export class RateLimiter {
  private readonly keys = new Map<string, KeyLimits>();
  private readonly penalties = new Map<string, Penalty>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly maxWaitMs: number;

  constructor(opts: RateLimiterOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 60_000;
    this.maxWaitMs = opts.maxWaitMs ?? 120_000;
  }

  private limitsFor(key: string): KeyLimits {
    let k = this.keys.get(key);
    if (!k) {
      const now = this.now();
      k = { requests: emptyBucket(now), inputTokens: emptyBucket(now), outputTokens: emptyBucket(now), tokens: emptyBucket(now), updatedAt: now };
      this.keys.set(key, k);
    }
    return k;
  }

  /** Update the buckets for `key` from response headers (success or 429). Returns the new state. */
  observe(key: string, headers: HeadersLike | ParsedRateLimitHeaders): KeyLimits {
    const parsed = isParsed(headers) ? headers : parseRateLimitHeaders(headers);
    const limits = this.limitsFor(key);
    const now = this.now();
    const apply = (kind: BucketKind, patch?: Partial<Pick<BucketState, "limit" | "remaining" | "resetAt">>) => {
      if (!patch) return;
      const b = limits[kind];
      if (patch.limit !== undefined) b.limit = patch.limit;
      if (patch.remaining !== undefined) b.remaining = patch.remaining;
      if (patch.resetAt !== undefined) b.resetAt = patch.resetAt;
      b.observedAt = now;
    };
    apply("requests", parsed.requests);
    apply("inputTokens", parsed.inputTokens);
    apply("outputTokens", parsed.outputTokens);
    apply("tokens", parsed.tokens);
    limits.updatedAt = now;
    return limits;
  }

  snapshot(key: string): KeyLimits | undefined {
    const k = this.keys.get(key);
    return k ? structuredClone(k) : undefined;
  }

  /** Currently available capacity (interpolated). `null` = never observed. */
  available(key: string): Record<Exclude<BucketKind, "tokens">, number | null> {
    const k = this.limitsFor(key);
    const now = this.now();
    return { requests: availableAt(k.requests, now), inputTokens: availableAt(k.inputTokens, now), outputTokens: availableAt(k.outputTokens, now) };
  }

  /** Milliseconds `acquire()` would wait right now for `need` under `scope` (bucket wait or scope penalty, whichever is longer). */
  waitTimeFor(key: string, need: Need, scope = "default"): number {
    const k = this.limitsFor(key);
    const now = this.now();
    const waits = [
      waitForCapacity(k.requests, need.requests ?? 1, now),
      waitForCapacity(k.inputTokens, need.inputTokens ?? 0, now),
      waitForCapacity(k.outputTokens, need.outputTokens ?? 0, now),
      this.penaltyFor(scope),
    ];
    return Math.max(...waits);
  }

  /**
   * Wait for capacity and reserve it. Throws ModelRateLimitError when the wait would exceed `maxWaitMs` or the request
   * can never fit (need > limit).
   */
  async acquire(key: string, need: Need = {}, scope = "default"): Promise<{ waitedMs: number }> {
    let waited = 0;
    for (;;) {
      const wait = this.waitTimeFor(key, need, scope);
      if (wait === 0) break;
      if (!Number.isFinite(wait)) {
        throw new ModelRateLimitError(`Request needs more capacity than the key's limit allows`, scope, undefined, { key, need });
      }
      if (waited + wait > this.maxWaitMs) {
        throw new ModelRateLimitError(`Rate-limit wait of ${waited + wait} ms exceeds maxWaitMs=${this.maxWaitMs}`, scope, wait, { key, need });
      }
      await this.sleep(wait);
      waited += wait;
    }
    this.reserve(key, need);
    return { waitedMs: waited };
  }

  /** Decrement the local view of the buckets so concurrent callers do not all assume the same headroom. */
  reserve(key: string, need: Need): void {
    const k = this.limitsFor(key);
    const now = this.now();
    const take = (b: BucketState, n: number) => {
      if (b.remaining === null || n <= 0) return;
      const avail = availableAt(b, now);
      b.remaining = Math.max(0, (avail ?? b.remaining) - n);
      b.observedAt = now;
    };
    take(k.requests, need.requests ?? 1);
    take(k.inputTokens, need.inputTokens ?? 0);
    take(k.outputTokens, need.outputTokens ?? 0);
  }

  /**
   * Record a 429 for `scope`. Returns the backoff (ms) the caller should wait: the larger of `retry-after` and
   * exponential backoff with full jitter for this scope's consecutive attempt count. Other scopes are unaffected.
   */
  reportRateLimited(scope: string, opts: { retryAfterMs?: number } = {}): number {
    const now = this.now();
    const prev = this.penalties.get(scope);
    const attempts = (prev?.attempts ?? 0) + 1;
    const jittered = backoffWithJitter(attempts - 1, { baseMs: this.baseBackoffMs, maxMs: this.maxBackoffMs, random: this.random });
    const backoff = Math.min(this.maxBackoffMs, Math.max(jittered, opts.retryAfterMs ?? 0, Math.round(this.baseBackoffMs / 4)));
    this.penalties.set(scope, { attempts, until: now + backoff, lastBackoffMs: backoff });
    return backoff;
  }

  /** Clear the penalty for a scope after a successful call. */
  clearPenalty(scope: string): void {
    this.penalties.delete(scope);
  }

  /** Remaining penalty for `scope` in ms (0 when none). */
  penaltyFor(scope: string): number {
    const p = this.penalties.get(scope);
    if (!p) return 0;
    return Math.max(0, p.until - this.now());
  }

  penalty(scope: string): Penalty | undefined {
    const p = this.penalties.get(scope);
    return p ? { ...p } : undefined;
  }

  /**
   * Largest number of concurrent agent sessions this key supports (Training Ground "largest squad the key supports"),
   * given a per-session consumption profile per minute. `null` when limits are unknown. Labelled estimate.
   */
  estimateConcurrency(key: string, perSessionPerMinute: { requests?: number; inputTokens?: number; outputTokens?: number }): number | null {
    const k = this.keys.get(key);
    if (!k) return null;
    const candidates: number[] = [];
    const consider = (b: BucketState, perSession: number | undefined) => {
      if (!perSession || perSession <= 0 || b.limit === null) return;
      candidates.push(Math.floor(b.limit / perSession));
    };
    consider(k.requests, perSessionPerMinute.requests);
    consider(k.inputTokens, perSessionPerMinute.inputTokens);
    consider(k.outputTokens, perSessionPerMinute.outputTokens);
    if (candidates.length === 0) return null;
    return Math.max(0, Math.min(...candidates));
  }

  reset(): void {
    this.keys.clear();
    this.penalties.clear();
  }
}

function isParsed(h: HeadersLike | ParsedRateLimitHeaders): h is ParsedRateLimitHeaders {
  if (typeof (h as { get?: unknown }).get === "function") return false;
  const keys = Object.keys(h as object);
  return keys.length > 0 && keys.every((k) => ["retryAfterMs", "requests", "tokens", "inputTokens", "outputTokens"].includes(k));
}
