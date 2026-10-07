/**
 * Clock abstraction (BUILD §13.3 "a fake clock for cycles").
 *
 * Activities never call `Date.now()` for business time: they ask the clock. In production the clock is the system
 * clock; in the holiday simulation and in tests a `FakeClock` is advanced explicitly so "until" dates, cadence
 * windows and "While you were away" ranges can be exercised in milliseconds. Workflow code never imports this file
 * (Temporal owns workflow time); activities and the holiday simulation harness do.
 */

export interface Clock {
  /** Current time. */
  now(): Date;
  /** Milliseconds since the epoch. */
  nowMs(): number;
  /** Wait for `ms` of clock time. The fake clock resolves as soon as it has been advanced far enough. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowMs(): number {
    return Date.now();
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, Math.max(0, ms));
      const onAbort = () => {
        clearTimeout(t);
        reject(signal?.reason ?? new Error("aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

interface Waiter {
  at: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/**
 * Deterministic clock. `advance(ms)` / `set(date)` move time forward and release every sleeper whose wake time has
 * passed, in wake order. Time never moves backwards (a `set` into the past throws).
 */
export class FakeClock implements Clock {
  private ms: number;
  private waiters: Waiter[] = [];

  constructor(start: Date | number | string = "2026-10-05T08:00:00.000Z") {
    this.ms = typeof start === "number" ? start : new Date(start).getTime();
    if (!Number.isFinite(this.ms)) throw new Error("FakeClock: invalid start time");
  }

  now(): Date {
    return new Date(this.ms);
  }

  nowMs(): number {
    return this.ms;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
      const waiter: Waiter = { at: this.ms + ms, resolve, reject };
      this.waiters.push(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(signal.reason ?? new Error("aborted"));
        },
        { once: true },
      );
    });
  }

  /** Move time forward by `ms`, waking sleepers in order (each continuation observes its own wake time). */
  advance(ms: number): Promise<void> {
    if (ms < 0) throw new Error("FakeClock: cannot advance backwards");
    return this.set(this.ms + ms);
  }

  /** Jump to an absolute time (not in the past). Resolves once every sleeper due by then has run its continuation. */
  async set(to: Date | number | string): Promise<void> {
    const target = typeof to === "number" ? to : new Date(to).getTime();
    if (!Number.isFinite(target)) throw new Error("FakeClock: invalid time");
    if (target < this.ms) throw new Error("FakeClock: time cannot move backwards");
    // Release waiters in wake order, letting each step settle the clock at its own wake time first and yielding so
    // the woken code runs (and may schedule the next sleep) before time moves on.
    for (;;) {
      const due = this.waiters.filter((w) => w.at <= target).sort((a, b) => a.at - b.at);
      const next = due[0];
      if (!next) break;
      this.ms = Math.max(this.ms, next.at);
      this.waiters = this.waiters.filter((w) => w !== next);
      next.resolve();
      await new Promise<void>((r) => setImmediate(r));
    }
    this.ms = target;
  }

  /** Number of pending sleepers (tests). */
  get pending(): number {
    return this.waiters.length;
  }
}

export const systemClock: Clock = new SystemClock();

/** Hours of agent work expressed in wall-clock milliseconds (one agent-hour = one hour of a running session). */
export const agentHoursToMs = (hours: number): number => Math.round(hours * 60 * 60 * 1000);
