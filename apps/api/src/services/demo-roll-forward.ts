/**
 * The sample businesses roll forward with the calendar (DECISIONS 2026-11-10; packages/db `rollDemoForward`). At boot,
 * after the demo seed has had its chance (SEED_ON_BOOT), and then every hour, the api moves Northwind's and Ledgerly's
 * timestamps forward by the whole days since their anchor, so "this week" on the sample never reads 0 just because
 * time passed. It touches only the demo businesses, by their fixed ids; a database without a finished demo seed has
 * nothing to roll. A failure is logged and the next pass tries again; nothing here blocks a request.
 */
import type { Db } from "@foundmill/db";
import { putNorthwindFirst, rollDemoForward, type DemoRollResult } from "@foundmill/db/seed";
import type { ApiLogger } from "./log";

export const DEMO_ROLL_INTERVAL_MS = 60 * 60 * 1000;

export interface DemoRollDeps {
  db: Db;
  log: Pick<ApiLogger, "info" | "warn">;
}

/** One pass: roll every demo business that is a day or more behind; keeps Northwind the newer of the two afterwards. */
export async function rollDemoBusinesses(deps: DemoRollDeps, now: Date = new Date()): Promise<DemoRollResult[]> {
  const moved = await rollDemoForward(deps.db, { now });
  if (moved.length) {
    // A capped created_at can tie the two businesses; a first sign-in opens the newest one, which must stay Northwind.
    await putNorthwindFirst(deps.db);
    deps.log.info({ moved }, "sample businesses rolled forward with the calendar");
  }
  return moved;
}

export function startDemoRollForward(deps: DemoRollDeps, intervalMs = DEMO_ROLL_INTERVAL_MS): { stop(): void; done: Promise<unknown> } {
  const pass = () => rollDemoBusinesses(deps).catch((err: unknown) => deps.log.warn({ err: (err as Error).message }, "rolling the sample businesses forward failed; the next pass tries again"));
  const done = pass();
  const timer = setInterval(() => void pass(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), done };
}
