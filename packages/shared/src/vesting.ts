/**
 * The vesting schedule a cap-table entry carries (`cap_table_entries.vesting`, BUILD §11.8): `months` of monthly
 * vesting after a `cliffMonths` cliff, counted from `startDate` (the entry's issue date when the schedule has none).
 * One shape for the API (`finance.capTable.createEntry`), the seeds and the Cap table screen. `readVesting` also reads
 * rows written before the shape existed (`{ schedule: "4y", startsAt }`, `{ totalMonths, cliff, start }`), so an old
 * row is never shown as fully vested just because its keys differ.
 */
import { z } from "zod";

export const VESTING_ACCELERATIONS = ["none", "single-trigger", "double-trigger"] as const;

export const VestingSchedule = z
  .object({
    /** Length of the whole schedule in months (48 for "4 years"). */
    months: z.number().int().min(1).max(240),
    /** Nothing vests before the cliff; the cliff's months vest on the day it passes. */
    cliffMonths: z.number().int().min(0).max(120).default(0),
    /** ISO date the schedule counts from; the entry's issue date when absent. */
    startDate: z.string().date().nullable().optional(),
    acceleration: z.enum(VESTING_ACCELERATIONS).optional(),
  })
  .refine((v) => v.cliffMonths <= v.months, { message: "The cliff cannot be longer than the schedule", path: ["cliffMonths"] });
export type VestingSchedule = z.output<typeof VestingSchedule>;
export type VestingScheduleInput = z.input<typeof VestingSchedule>;

export interface VestingTerms {
  months: number;
  cliffMonths: number;
  /** YYYY-MM-DD, or null when neither the schedule nor the entry says when it started. */
  startDate: string | null;
}

const DEFAULT_MONTHS = 48;
const DEFAULT_CLIFF_MONTHS = 12;

const whole = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);

/** "4y", "4 years", "48m", "48 months", "18" → months; null for anything else. */
export function parseVestingLength(v: unknown): number | null {
  if (typeof v === "number") return whole(v);
  if (typeof v !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years|m|mo|mos|month|months)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2] && m[2].toLowerCase().startsWith("y") ? n * 12 : n);
}

const isoDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * The schedule in a stored vesting JSON, in the shared shape. Missing lengths default to 4 years with a 1-year cliff
 * (the platform's default grant); a missing start falls back to `issuedAt`. Null for an entry without vesting.
 */
export function readVesting(raw: Record<string, unknown> | null | undefined, issuedAt?: string | null): VestingTerms | null {
  if (!raw) return null;
  const months = parseVestingLength(raw.months) ?? parseVestingLength(raw.totalMonths) ?? parseVestingLength(raw.schedule) ?? DEFAULT_MONTHS;
  const cliffMonths = Math.min(months, parseVestingLength(raw.cliffMonths) ?? parseVestingLength(raw.cliff) ?? DEFAULT_CLIFF_MONTHS);
  const startDate = isoDay(raw.startDate) ?? isoDay(raw.startsAt) ?? isoDay(raw.start) ?? isoDay(issuedAt);
  return { months, cliffMonths, startDate };
}
