/**
 * UTC calendar helpers. `journey_daily` buckets by UTC day (migration 0007), so every helper here works in UTC
 * and never depends on the process time zone.
 */
import type { DayKey } from "./types";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function toDate(value: Date | string | number): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return d;
}

export const toIso = (value: Date | string | number): string => toDate(value).toISOString();

/** `YYYY-MM-DD` of the UTC day containing the instant. */
export function dayKeyUtc(value: Date | string | number): DayKey {
  return toDate(value).toISOString().slice(0, 10);
}

/** Midnight UTC of a day key, as a Date. */
export function dayKeyToDate(day: DayKey): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`Invalid day key: ${day}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function addDaysKey(day: DayKey, n: number): DayKey {
  return dayKeyUtc(dayKeyToDate(day).getTime() + n * DAY_MS);
}

/** Whole days from `a` to `b` (b − a); negative when b is earlier. */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((dayKeyToDate(b).getTime() - dayKeyToDate(a).getTime()) / DAY_MS);
}

/** Every day key from `from` to `to` inclusive. */
export function eachDayKey(from: DayKey, to: DayKey): DayKey[] {
  const n = daysBetween(from, to);
  if (n < 0) return [];
  const out: DayKey[] = new Array(n + 1);
  const start = dayKeyToDate(from).getTime();
  for (let i = 0; i <= n; i++) out[i] = dayKeyUtc(start + i * DAY_MS);
  return out;
}

/** ISO weekday 1 (Monday) … 7 (Sunday) of a UTC day key. */
export function isoWeekdayUtc(day: DayKey): number {
  const d = dayKeyToDate(day).getUTCDay();
  return d === 0 ? 7 : d;
}

export function hoursBetween(a: Date | string, b: Date | string): number {
  return (toDate(b).getTime() - toDate(a).getTime()) / HOUR_MS;
}

export function quarterOf(day: DayKey): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const d = dayKeyToDate(day);
  return { year: d.getUTCFullYear(), quarter: (Math.floor(d.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4 };
}

export function quarterStart(year: number, quarter: number): DayKey {
  return dayKeyUtc(Date.UTC(year, (quarter - 1) * 3, 1));
}

export function quarterEnd(year: number, quarter: number): DayKey {
  return dayKeyUtc(Date.UTC(year, quarter * 3, 0));
}

/** Stable comparator: by time, then by id, so sorts never depend on input order. */
export function compareByTimeThenId(a: { occurredAt: string; id: string }, b: { occurredAt: string; id: string }): number {
  const ta = Date.parse(a.occurredAt);
  const tb = Date.parse(b.occurredAt);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
