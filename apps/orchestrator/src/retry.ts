/**
 * Bounded, backed-off retries (audit O-08). A failed session used to remove its task and its agent from the loop for
 * good: the task stayed `failed` and never reached the planner, the agent stayed `failing` and was never picked again.
 * Now a failed task is offered to the planner again after a pause that doubles with each failure in a row, up to
 * `TASK_RETRY_LIMIT` automatic retries (then it waits for the founder's Start on the Plan), and a failing agent goes
 * back to idle once it has rested, longer after each failure in a row, never longer than `AGENT_COOLDOWN_MAX_MS`. Pure:
 * the brief feeds it the latest ended sessions, newest first.
 */

/** Automatic retries of a failed task after its first failure; then only the founder restarts it. */
export const TASK_RETRY_LIMIT = 3;
/** Wait before the first retry of a failed task; doubles with each failure in a row (15, 30, 60 min). */
export const TASK_RETRY_BASE_MS = 15 * 60 * 1000;
/** Rest of a failing agent after one failure; doubles with each failure in a row. */
export const AGENT_COOLDOWN_BASE_MS = 10 * 60 * 1000;
export const AGENT_COOLDOWN_MAX_MS = 4 * 60 * 60 * 1000;

export interface EndedSession {
  outcome: string | null;
  endedAt: Date | string | null;
}

export interface FailureStreak {
  /** Sessions in a row, newest first, that ended `failed`. */
  failures: number;
  /** When the newest of them ended (null: no ended session). */
  lastEndedAt: Date | null;
}

/** Count the failures in a row from the newest session back (sessions newest first). */
export function failureStreak(sessions: readonly EndedSession[]): FailureStreak {
  let failures = 0;
  for (const s of sessions) {
    if (s.outcome !== "failed") break;
    failures += 1;
  }
  const newest = sessions[0]?.endedAt ?? null;
  return { failures, lastEndedAt: newest === null ? null : new Date(newest) };
}

export interface TaskRetry {
  /** Failures in a row (at least 1 for a failed task: a session that never ended still failed it). */
  failures: number;
  /** Offered to the planner again now. */
  due: boolean;
  /** No automatic retry left: the founder starts it again from the Plan. */
  exhausted: boolean;
  /** When the next automatic retry is due (null when due now or exhausted). */
  nextAttemptAt: string | null;
}

/** When a failed task may run again. */
export function taskRetry(streak: FailureStreak, now: Date): TaskRetry {
  const failures = Math.max(1, streak.failures);
  if (failures > TASK_RETRY_LIMIT) return { failures, due: false, exhausted: true, nextAttemptAt: null };
  const at = (streak.lastEndedAt?.getTime() ?? 0) + TASK_RETRY_BASE_MS * 2 ** (failures - 1);
  return at <= now.getTime() ? { failures, due: true, exhausted: false, nextAttemptAt: null } : { failures, due: false, exhausted: false, nextAttemptAt: new Date(at).toISOString() };
}

/** When a failing agent with no open session may work again. */
export function agentCooldown(streak: FailureStreak, now: Date): { failures: number; due: boolean; until: string | null } {
  const failures = Math.max(1, streak.failures);
  const rest = Math.min(AGENT_COOLDOWN_MAX_MS, AGENT_COOLDOWN_BASE_MS * 2 ** (failures - 1));
  const at = (streak.lastEndedAt?.getTime() ?? 0) + rest;
  return at <= now.getTime() ? { failures, due: true, until: null } : { failures, due: false, until: new Date(at).toISOString() };
}
