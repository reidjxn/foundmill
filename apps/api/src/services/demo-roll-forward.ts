/**
 * The sample businesses roll forward with the calendar (DECISIONS 2026-11-10; packages/db `rollDemoForward`). At boot,
 * after the demo seed has had its chance (SEED_ON_BOOT), and then every hour, the api moves Northwind's and Ledgerly's
 * own sample rows forward by the whole days since their anchor, so "this week" on the sample never reads 0 just because
 * time passed. It touches only the demo businesses, by their fixed ids, and only the rows their seed wrote; a database
 * without a finished demo seed has nothing to roll. `DEMO_ROLL_FORWARD=off` turns it off. A failure is logged and the
 * next pass tries again; nothing here blocks a request, and the workflow reconciler waits for the boot roll at most
 * DEMO_ROLL_BOOT_WAIT_MS.
 *
 * The journey's daily rows are refreshed after a move, separately: a refresh that fails is retried on every pass until
 * it succeeds (the move itself is committed by then, so the next pass has no days to roll and would not refresh).
 */
import { repos, type Db } from "@foundmill/db";
import { rollDemoForward, type DemoRollResult } from "@foundmill/db/seed";
import type { Env } from "@foundmill/shared";
import type { ApiLogger } from "./log";

export const DEMO_ROLL_INTERVAL_MS = 60 * 60 * 1000;
/** How long the workflow reconciler waits at boot for the first roll before it starts anyway (apps/api index.ts). */
export const DEMO_ROLL_BOOT_WAIT_MS = 10_000;

export interface DemoRollDeps {
  db: Db;
  log: Pick<ApiLogger, "info" | "warn">;
}

/** A refresh of the journey's daily rows is still owed by an earlier pass (per process). */
export interface DemoRollState {
  refreshPending: boolean;
}

/**
 * One pass: roll every demo business that is a day or more behind (Northwind stays the newer of the two), then refresh
 * the journey's daily rows when anything moved now or a refresh failed before.
 */
export async function rollDemoBusinesses(deps: DemoRollDeps, now: Date = new Date(), state: DemoRollState = { refreshPending: false }): Promise<DemoRollResult[]> {
  const started = performance.now();
  const moved = await rollDemoForward(deps.db, { now, refreshDaily: false, log: (message) => deps.log.info({}, message) });
  if (moved.length) {
    state.refreshPending = true;
    // `ms`: how long the roll took (WP-11 T9; read in production for three days, docs/DEPLOY.md §6).
    deps.log.info({ moved, ms: Math.round(performance.now() - started) }, "sample businesses rolled forward with the calendar");
  }
  if (state.refreshPending) {
    try {
      await repos.journeys.refreshDaily(deps.db);
      state.refreshPending = false;
    } catch (err) {
      deps.log.warn({ err: (err as Error).message }, "the sample businesses rolled, but refreshing the journey's daily rows failed; the next pass tries again");
    }
  }
  return moved;
}

/** `DEMO_ROLL_FORWARD`: on unless "off". */
export const demoRollForwardEnabled = (env: Pick<Env, "DEMO_ROLL_FORWARD">): boolean => env.DEMO_ROLL_FORWARD !== "off";

export function startDemoRollForward(deps: DemoRollDeps, intervalMs = DEMO_ROLL_INTERVAL_MS): { stop(): void; done: Promise<unknown> } {
  const state: DemoRollState = { refreshPending: false };
  const pass = () => rollDemoBusinesses(deps, new Date(), state).catch((err: unknown) => deps.log.warn({ err: (err as Error).message }, "rolling the sample businesses forward failed; the next pass tries again"));
  const done = pass();
  const timer = setInterval(() => void pass(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), done };
}
