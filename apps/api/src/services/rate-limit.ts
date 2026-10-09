/**
 * In-process sliding-window limits for procedures that spend money on every call (logo generation is one Opus call).
 *
 * Process-local: staging runs one api instance, and a restart only forgets a few minutes of history. With several
 * replicas each one keeps its own window, so the effective limit is `limit × replicas`; move the window to Redis then.
 * Memory is bounded: timestamps outside the window are dropped on every take, and at most `maxKeys` keys are kept
 * (the least recently used goes first).
 */
import { AppError } from "@foundmill/shared";

export interface WindowLimit {
  limit: number;
  windowMs: number;
}

export type TakeResult = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

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

  /** Records a hit for every key when all of them have room; records nothing when any is full. */
  takeAll(entries: readonly { key: string; rule: WindowLimit }[]): TakeResult {
    let remaining = Number.POSITIVE_INFINITY;
    for (const e of entries) {
      const r = this.peek(e.key, e.rule);
      if (!r.ok) return r;
      remaining = Math.min(remaining, r.remaining - 1);
    }
    const t = this.now();
    for (const e of entries) {
      const recent = (this.hits.get(e.key) ?? []).filter((at) => at > t - e.rule.windowMs);
      recent.push(t);
      this.hits.delete(e.key);
      this.hits.set(e.key, recent);
    }
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    return { ok: true, remaining: Number.isFinite(remaining) ? remaining : 0 };
  }

  /** Gives one hit back (the call it paid for failed before reaching the model). */
  refund(keys: readonly string[]): void {
    for (const key of keys) this.hits.get(key)?.pop();
  }

  reset(): void {
    this.hits.clear();
  }
}

/** TOO_MANY_REQUESTS (429) with a sentence the founder can act on. */
export class RateLimitedError extends AppError {
  constructor(what: string, retryAfterMs: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
    super("rate_limited", `${what} limit reached. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`, 429, { retryAfterMs });
  }
}
