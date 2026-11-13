/**
 * The transaction gate (2026-11-12, after the api's pool wedged every five minutes): a limit on how many database
 * transactions the requests hold at once, so one request can never take the whole pool.
 *
 * What happened. The pool has `max` connections (10). Every tRPC procedure opens its own RLS transaction (`ctx.rls`,
 * `withRls`), and one HTTP request can carry a batch of 8 to 10 procedures (the phone app's screens, the web's Today),
 * so a single request held 8 to 10 connections at once. The outbox relays, the pool watchdog's probe and the warm-up
 * queries then queued behind it; a second such request, or a client that gave up and sent the batch again, left nothing
 * free, answers took seconds and then never came, and the watchdog restarted the process.
 *
 * What the gate does. `forRequest(db, signal)` gives a request its own view of the database whose `transaction` waits
 * for two permits before it starts:
 *   - one of the request's own (`perRequest`, 4): a batch of ten procedures runs four transactions at a time;
 *   - one of the process's (`total`: the pool's size less a reserve), so the relays, the watchdog, the notify pass and
 *     plain queries always find a free connection, however many requests arrive.
 * Everything else on the view is the database itself (plain queries are short and are not gated). Background work
 * (the relays, the notify pass, the sample roll-forward) uses the database directly and is never gated.
 *
 * Three rules keep the gate from becoming a failure of its own:
 *   - a transaction opened inside a gated transaction (same async chain) passes straight through, so code that nests
 *     can never wait on a permit its own caller holds;
 *   - a wait is bounded (`waitMs`, 15 s): after it the transaction starts without the permit and `onTimeout` is told,
 *     so a permit that is never returned slows requests down and is seen in the log, but never stops them for good;
 *   - a request the client has closed starts no further transactions (`signal`): its queued procedures fail at once
 *     instead of doing work nobody reads while the next attempt of the same batch waits behind them.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { TRPCError } from "@trpc/server";

export interface TransactionGateOptions {
  /** Transactions all requests may hold at once (the pool's size less the reserve for background work). */
  total: number;
  /** Transactions one request may hold at once. */
  perRequest: number;
  /** The longest a transaction waits for a permit before it starts without one (default 15 s). */
  waitMs?: number;
  /** A wait ran out: `which` permit, and how many waited at that moment. Called at most once per wait. */
  onTimeout?: (which: "request" | "total", waiting: number) => void;
}

export interface TransactionGateStats {
  /** Transactions holding a process permit now. */
  held: number;
  /** Transactions waiting for a process permit now. */
  waiting: number;
  /** The most held at once since the process started. */
  peak: number;
  /** Waits that ran out since the process started. */
  timeouts: number;
  total: number;
  perRequest: number;
}

/**
 * Thrown for a transaction that was still waiting when its request was closed by the client. A tRPC error with the
 * code for exactly that, so it is answered (to nobody) as 499 and never logged as a server error.
 */
export class RequestClosedError extends TRPCError {
  constructor() {
    super({ code: "CLIENT_CLOSED_REQUEST", message: "The request was closed before this part of it started" });
    this.name = "RequestClosedError";
  }
}

type Release = () => void;
const NO_PERMIT: Release = () => undefined;

/** A counting semaphore with a first-in, first-out queue and a bounded wait. */
export class Semaphore {
  private inUse = 0;
  private readonly queue: { grant: (release: Release) => void; timer: ReturnType<typeof setTimeout> | null; done: boolean }[] = [];
  peak = 0;

  constructor(readonly limit: number) {}

  get held(): number {
    return this.inUse;
  }

  get waiting(): number {
    return this.queue.length;
  }

  private take(): Release {
    this.inUse += 1;
    if (this.inUse > this.peak) this.peak = this.inUse;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse -= 1;
      this.next();
    };
  }

  private next(): void {
    while (this.inUse < this.limit && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      if (waiter.done) continue;
      waiter.done = true;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.grant(this.take());
    }
  }

  /**
   * Resolves with the permit's release. After `waitMs` without a permit it resolves with a release that does nothing
   * and `timedOut` true: the caller goes ahead (the gate never blocks for good). `signal` aborted while waiting rejects
   * with `RequestClosedError`.
   */
  acquire(waitMs: number, signal?: AbortSignal | null): Promise<{ release: Release; timedOut: boolean }> {
    if (signal?.aborted) return Promise.reject(new RequestClosedError());
    if (this.inUse < this.limit && this.queue.length === 0) return Promise.resolve({ release: this.take(), timedOut: false });
    return new Promise((resolve, reject) => {
      const waiter: (typeof this.queue)[number] = { grant: (release) => finish(() => resolve({ release, timedOut: false })), timer: null, done: false };
      const onAbort = () => {
        if (waiter.done) return;
        waiter.done = true;
        if (waiter.timer) clearTimeout(waiter.timer);
        const at = this.queue.indexOf(waiter);
        if (at >= 0) this.queue.splice(at, 1);
        finish(() => reject(new RequestClosedError()));
      };
      const finish = (settle: () => void) => {
        signal?.removeEventListener("abort", onAbort);
        settle();
      };
      waiter.timer = setTimeout(() => {
        if (waiter.done) return;
        waiter.done = true;
        const at = this.queue.indexOf(waiter);
        if (at >= 0) this.queue.splice(at, 1);
        finish(() => resolve({ release: NO_PERMIT, timedOut: true }));
      }, waitMs);
      waiter.timer.unref?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }
}

/** The part of a database the gate needs: something with `transaction`. */
interface Transactional {
  transaction: (...args: never[]) => Promise<unknown>;
}

export interface TransactionGate {
  /** The request's view of `db`: the same database, with `transaction` waiting for the request's and the process's permits. */
  forRequest<D extends Transactional>(db: D, signal?: AbortSignal | null): D;
  stats(): TransactionGateStats;
}

export const DEFAULT_GATE_WAIT_MS = 15_000;
/** Transactions one request holds at once. */
export const REQUEST_TRANSACTION_LIMIT = 4;
/** Connections kept free of request transactions: the two relays, the watchdog's probe, the notify pass and plain queries. */
export const POOL_RESERVE = 4;

/** The gate's limits for a pool of `poolMax` connections: all but the reserve, and never fewer than one. */
export const gateLimitsFor = (poolMax: number): Pick<TransactionGateOptions, "total" | "perRequest"> => {
  const total = Math.max(1, poolMax - POOL_RESERVE);
  return { total, perRequest: Math.min(REQUEST_TRANSACTION_LIMIT, total) };
};

export function createTransactionGate(options: TransactionGateOptions): TransactionGate {
  const waitMs = options.waitMs ?? DEFAULT_GATE_WAIT_MS;
  const total = new Semaphore(Math.max(1, options.total));
  const perRequest = Math.max(1, options.perRequest);
  /** Set while the current async chain runs inside a gated transaction: a nested one passes through. */
  const inside = new AsyncLocalStorage<true>();
  let timeouts = 0;

  return {
    forRequest<D extends Transactional>(db: D, signal?: AbortSignal | null): D {
      const own = new Semaphore(perRequest);
      const base = db.transaction as (...args: unknown[]) => Promise<unknown>;
      const gated = async (...args: unknown[]): Promise<unknown> => {
        if (inside.getStore()) return base.apply(db, args);
        const mine = await own.acquire(waitMs, signal);
        if (mine.timedOut) {
          timeouts += 1;
          options.onTimeout?.("request", own.waiting);
        }
        let all: { release: Release; timedOut: boolean };
        try {
          all = await total.acquire(waitMs, signal);
        } catch (err) {
          mine.release();
          throw err;
        }
        if (all.timedOut) {
          timeouts += 1;
          options.onTimeout?.("total", total.waiting);
        }
        try {
          return await inside.run(true, () => base.apply(db, args));
        } finally {
          all.release();
          mine.release();
        }
      };
      // The same database with one method replaced: every other property resolves through the prototype chain.
      return Object.create(db, { transaction: { value: gated, enumerable: false, writable: false, configurable: true } }) as D;
    },
    stats: () => ({ held: total.held, waiting: total.waiting, peak: total.peak, timeouts, total: total.limit, perRequest }),
  };
}
