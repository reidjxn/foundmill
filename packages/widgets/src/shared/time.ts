/** UTC day-key helpers (YYYY-MM-DD), pure and dependency-free. */
export const DAY_MS = 86_400_000;

export function dayKey(d: Date | string | number = new Date()): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return dayKey(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY_MS);
}

/** `n` day keys ending today (oldest first). */
export function lastDays(n: number, today: string = dayKey()): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / DAY_MS);
}

/** ISO week key (YYYY-Www) for grouping daily rows into weeks. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

/** Days until an ISO instant (negative when overdue); null for null input. */
export function daysUntil(at: string | null | undefined, now: Date = new Date()): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / DAY_MS);
}

/** Sum a numeric field over daily rows that fall inside [from, to]. */
export function sumInRange<T extends { day: string }>(rows: readonly T[], from: string, to: string, pick: (row: T) => number): number {
  let total = 0;
  for (const r of rows) if (r.day >= from && r.day <= to) total += pick(r);
  return total;
}

/** A dense per-day series over `days` (missing days → 0). */
export function dailySeries<T extends { day: string }>(rows: readonly T[], days: readonly string[], pick: (row: T) => number): number[] {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + pick(r));
  return days.map((d) => byDay.get(d) ?? 0);
}
