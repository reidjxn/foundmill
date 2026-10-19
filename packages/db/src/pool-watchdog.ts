/**
 * Pool watchdog (docs/DECISIONS.md 2026-10-19 "The api's pool wedged for four hours"). postgres.js can lose a pooled
 * connection for good without a word: a slot its bookkeeping counts as busy while nothing is running on it
 * (porsager/postgres#1255, #1246). Each loss is invisible; the last one stops every query, and the process sits there
 * answering nothing until someone restarts it. Railway restarts a container that exits, never one that merely stops
 * answering, so the service has to notice for itself.
 *
 * Every `intervalMs` a `select 1` goes through the pool, bounded by `probeTimeoutMs`. After `strikes` misses in a row
 * one more `select 1` runs on a fresh single connection outside the pool: if that answers, the database is fine and the
 * pool is wedged (`onWedged`, once); if it does not, the database itself is unreachable (`down`) and a restart would
 * change nothing. A PGlite database has no pool and is never watched.
 */
import postgres from "postgres";
import { DEFAULT_CONNECT_TIMEOUT_S, postgresConnection, withinMs, type Db, type ServiceDb } from "./client";
import { isPgliteDb } from "./pglite";

export type PoolState = "ok" | "degraded" | "wedged" | "down" | "unwatched";

export interface PoolWatchdogStatus {
  state: PoolState;
  /** Consecutive pool probes that failed or went unanswered. */
  strikes: number;
  lastOkAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface PoolWatchdogOptions {
  db: Db;
  /** The connection string, for the out-of-pool probe; without it a wedged pool reads as `down`. */
  url?: string | null;
  /** Between probes; default 30 s. */
  intervalMs?: number;
  /** A probe unanswered this long has failed; default 10 s. */
  probeTimeoutMs?: number;
  /** Misses in a row before the out-of-pool probe decides between wedged and down; default 3. */
  strikes?: number;
  /** Called once, when the pool is wedged while the database answers outside it. */
  onWedged: (status: PoolWatchdogStatus) => void;
  /** Called on each check that finds the database unreachable outside the pool too. */
  onDown?: (status: PoolWatchdogStatus) => void;
  /** Test seams: the probes themselves. */
  poolProbe?: () => Promise<unknown>;
  directProbe?: () => Promise<unknown>;
}

export interface PoolWatchdog {
  status(): PoolWatchdogStatus;
  /** One probe round now (the timer runs them on its own). */
  check(): Promise<PoolWatchdogStatus>;
  stop(): void;
}

export const DEFAULT_WATCHDOG_INTERVAL_MS = 30_000;
export const DEFAULT_WATCHDOG_PROBE_TIMEOUT_MS = 10_000;
export const DEFAULT_WATCHDOG_STRIKES = 3;

/** `select 1` on a fresh connection of its own, closed afterwards: what the pool should have answered. */
export async function probeOutsidePool(url: string, timeoutS: number = DEFAULT_CONNECT_TIMEOUT_S): Promise<void> {
  const connection = postgresConnection(url);
  const client = postgres(connection.url, { max: 1, connect_timeout: timeoutS, prepare: false, onnotice: () => {} });
  try {
    await client.unsafe("select 1");
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

export function createPoolWatchdog(options: PoolWatchdogOptions): PoolWatchdog {
  const { db } = options;
  const client = isPgliteDb(db) ? null : ((db as Partial<ServiceDb>).$client ?? null);
  const status: PoolWatchdogStatus = { state: client ? "ok" : "unwatched", strikes: 0, lastOkAt: null, lastCheckedAt: null, lastError: null };
  if (!client || typeof client.unsafe !== "function") return { status: () => ({ ...status }), check: async () => ({ ...status }), stop: () => undefined };

  const intervalMs = options.intervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_WATCHDOG_PROBE_TIMEOUT_MS;
  const strikesNeeded = options.strikes ?? DEFAULT_WATCHDOG_STRIKES;
  const poolProbe = options.poolProbe ?? (() => client.unsafe("select 1"));
  const directProbe = options.directProbe ?? (options.url ? () => probeOutsidePool(options.url!) : null);
  let wedgedReported = false;
  let running: Promise<PoolWatchdogStatus> | null = null;

  const check = async (): Promise<PoolWatchdogStatus> => {
    status.lastCheckedAt = new Date().toISOString();
    try {
      await withinMs(probeTimeoutMs, poolProbe);
      status.strikes = 0;
      status.state = "ok";
      status.lastOkAt = status.lastCheckedAt;
      status.lastError = null;
      return { ...status };
    } catch (err) {
      status.strikes += 1;
      status.lastError = err instanceof Error ? err.message : String(err);
    }
    if (status.strikes < strikesNeeded) {
      status.state = "degraded";
      return { ...status };
    }
    let databaseAnswers = false;
    if (directProbe) {
      try {
        await withinMs(probeTimeoutMs, directProbe);
        databaseAnswers = true;
      } catch (err) {
        status.lastError = `outside the pool too: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    if (databaseAnswers) {
      status.state = "wedged";
      if (!wedgedReported) {
        wedgedReported = true;
        options.onWedged({ ...status });
      }
    } else {
      status.state = "down";
      options.onDown?.({ ...status });
    }
    return { ...status };
  };

  // One round at a time: a slow round is not joined by the next.
  const tick = () => {
    if (!running) running = check().finally(() => (running = null));
    return running;
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { status: () => ({ ...status }), check: tick, stop: () => clearInterval(timer) };
}

export interface WatchPoolOptions extends Omit<PoolWatchdogOptions, "onWedged" | "onDown"> {
  service: string;
  log: { error: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void };
  /** Default `process.exit`. */
  exit?: (code: number) => void;
  /** Delay before exiting, so the log line leaves the process; default 500 ms. */
  exitDelayMs?: number;
}

/**
 * The watchdog as every service runs it: a wedged pool is logged and the process exits with 1, which the platform's
 * restart policy (railway/*.toml `ON_FAILURE`) turns into a fresh process with a fresh pool within seconds. A database
 * that is down is logged (once a minute at most) and waited out: the pool reconnects on its own when it is back.
 */
export function watchPoolOrExit(options: WatchPoolOptions): PoolWatchdog {
  const { service, log, exit = (code) => process.exit(code), exitDelayMs = 500, ...rest } = options;
  let lastDownLog = 0;
  return createPoolWatchdog({
    ...rest,
    onWedged: (status) => {
      log.error({ service, pool: status }, `${service}: the database pool stopped answering while the database answers outside it; exiting so the platform restarts the process with a fresh pool`);
      const timer = setTimeout(() => exit(1), exitDelayMs);
      timer.unref?.();
    },
    onDown: (status) => {
      const now = Date.now();
      if (now - lastDownLog < 60_000) return;
      lastDownLog = now;
      log.warn({ service, pool: status }, `${service}: the database is not answering, inside or outside the pool; waiting for it`);
    },
  });
}
