/**
 * The daily streak (retention plan, founder 2026-11-11: "daily streak"): how many days in a row the founder has opened
 * their business. Days are the business's own calendar days (founder_visit_days). A vacation day freezes the streak: it
 * neither breaks it nor adds to it, because the founder chose to step away and the team kept working. Today does not
 * break a streak until it is over: a streak that reached yesterday is still alive this morning, only at risk.
 * Pure, so the Today panel, the morning brief and the mobile app read the same number.
 */
import { addDaysToKey } from "./founder-return";

/** Streak lengths worth a word of their own (the panel and the brief say so the day one is reached). */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365] as const;

export type StreakDayState = "visited" | "vacation" | "missed" | "today";

export interface StreakFacts {
  /** The business's today, `YYYY-MM-DD`. */
  today: string;
  /** Days the founder opened the business, any order, repeats allowed. */
  visitDays: readonly string[];
  /** Days the founder was on vacation, any order. */
  vacationDays: readonly string[];
}

export interface Streak {
  /** Days in a row, today included when visited. */
  current: number;
  /** The longest streak on record (at least `current`). */
  best: number;
  visitedToday: boolean;
  /** A streak of at least 1 that ends today unless the founder comes back. */
  atRisk: boolean;
  /** The milestone reached today (3, 7, 14…), or null. */
  milestone: number | null;
  /** The last seven days, oldest first, for the dots. */
  week: { day: string; state: StreakDayState }[];
}

/** Every day from the earliest key to `today`, oldest first (bounded at 800 days). */
function daysUntil(earliest: string, today: string): string[] {
  const out: string[] = [];
  for (let d = earliest, n = 0; d <= today && n < 800; d = addDaysToKey(d, 1), n += 1) out.push(d);
  return out;
}

export function dailyStreak(f: StreakFacts): Streak {
  const visited = new Set(f.visitDays.filter((d) => d <= f.today));
  const vacation = new Set(f.vacationDays);
  const visitedToday = visited.has(f.today);

  // Current: walk back from today (or from yesterday when today is not visited yet).
  let current = 0;
  for (let d = visitedToday ? f.today : addDaysToKey(f.today, -1), n = 0; n < 800; d = addDaysToKey(d, -1), n += 1) {
    if (visited.has(d)) current += 1;
    else if (vacation.has(d)) continue;
    else break;
  }

  // Best: the longest run over the record, with the same rules.
  let best = 0;
  let run = 0;
  const earliest = [...visited].sort()[0];
  if (earliest) {
    for (const d of daysUntil(earliest, f.today)) {
      if (visited.has(d)) run += 1;
      else if (vacation.has(d) || d === f.today) continue;
      else run = 0;
      best = Math.max(best, run);
    }
  }
  best = Math.max(best, current);

  const week: Streak["week"] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDaysToKey(f.today, -i);
    const state: StreakDayState = visited.has(day) ? "visited" : vacation.has(day) ? "vacation" : day === f.today ? "today" : "missed";
    week.push({ day, state });
  }

  const milestone = visitedToday && (STREAK_MILESTONES as readonly number[]).includes(current) ? current : null;
  return { current, best, visitedToday, atRisk: !visitedToday && current > 0, milestone, week };
}

/** The panel's and the brief's words for a streak. */
export function streakWords(s: Pick<Streak, "current" | "best" | "visitedToday" | "atRisk" | "milestone">): { headline: string; line: string } {
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (s.current === 0) return { headline: "Start a streak today", line: s.best > 0 ? `Your best so far is ${days(s.best)} in a row.` : "Open your business each day to build one. Vacation days never break it." };
  if (s.atRisk) return { headline: `${days(s.current)} in a row`, line: `Open your business today to make it ${days(s.current + 1)}.` };
  if (s.milestone) return { headline: `${days(s.current)} in a row`, line: `You reached ${days(s.milestone)} today. ${s.current >= s.best ? "Your best yet." : `Your best is ${days(s.best)}.`}` };
  return { headline: `${days(s.current)} in a row`, line: s.current >= s.best ? "Your best yet. Come back tomorrow to keep it going." : `Your best is ${days(s.best)}. Come back tomorrow to keep it going.` };
}

/** The vacation days of periods `{ startedAt, endedAt | until }` in a zone, as day keys (bounded). */
export function vacationDayKeys(periods: readonly { startedAt: Date | null; endedAt: Date | null; untilAt: Date | null }[], now: Date, dayOf: (d: Date) => string): string[] {
  const out: string[] = [];
  for (const p of periods) {
    if (!p.startedAt) continue;
    const end = p.endedAt ?? (p.untilAt && p.untilAt < now ? p.untilAt : now);
    const from = dayOf(p.startedAt);
    const to = dayOf(end);
    for (let d = from, n = 0; d <= to && n < 400; d = addDaysToKey(d, 1), n += 1) out.push(d);
  }
  return out;
}
