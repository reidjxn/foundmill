/**
 * Autopilot's settings form (Settings › Mode): the draft the fields edit, its parsing into the `business.autopilot.set`
 * input, and the labels. Pure so the rules (1 to 24 cycles a day, 1 to 10 idle cycles, a ceiling in dollars) are tested
 * without a screen. The decision itself, and the plain words for each state, live in @foundmill/shared.
 */
import { AUTOPILOT_CADENCES, AUTOPILOT_CADENCE_INFO, AUTOPILOT_LIMITS, type AutopilotCadence } from "@foundmill/shared/autopilot";
import { parseSpendCapMinor } from "@/components/new/commit/naming";

export interface AutopilotSettingsLike {
  cadence: AutopilotCadence;
  dailyHour: number;
  maxCyclesPerDay: number;
  spendCeilingMinor: number | null;
  maxIdleCycles: number;
}

/** What the fields hold, as text. */
export interface AutopilotDraft {
  cadence: AutopilotCadence;
  dailyHour: string;
  maxCyclesPerDay: string;
  /** Dollars; empty means the credits left. */
  spendCeiling: string;
  maxIdleCycles: string;
}

export type AutopilotDraftErrors = Partial<Record<"maxCyclesPerDay" | "spendCeiling" | "maxIdleCycles", string>>;

export interface AutopilotSettingsChange {
  cadence: AutopilotCadence;
  dailyHour: number;
  maxCyclesPerDay: number;
  spendCeilingMinor: number | null;
  maxIdleCycles: number;
}

export const CADENCE_OPTIONS = AUTOPILOT_CADENCES.map((value) => ({ value, label: AUTOPILOT_CADENCE_INFO[value].label, summary: AUTOPILOT_CADENCE_INFO[value].summary }));

/** "9:00 AM UTC": the daily hour is a UTC hour (a business has no time zone of its own). */
export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"} UTC`;
}

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }));

export function draftOf(s: AutopilotSettingsLike): AutopilotDraft {
  return {
    cadence: s.cadence,
    dailyHour: String(s.dailyHour),
    maxCyclesPerDay: String(s.maxCyclesPerDay),
    spendCeiling: s.spendCeilingMinor === null ? "" : String(s.spendCeilingMinor / 100),
    maxIdleCycles: String(s.maxIdleCycles),
  };
}

const whole = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/** The `set` input for a draft, or what is wrong with it. */
export function parseDraft(d: AutopilotDraft): { ok: true; change: AutopilotSettingsChange } | { ok: false; errors: AutopilotDraftErrors } {
  const errors: AutopilotDraftErrors = {};
  const cycles = whole(d.maxCyclesPerDay);
  const { min: cMin, max: cMax } = AUTOPILOT_LIMITS.maxCyclesPerDay;
  if (!(cycles >= cMin && cycles <= cMax)) errors.maxCyclesPerDay = `Use a whole number from ${cMin} to ${cMax}.`;
  const idle = whole(d.maxIdleCycles);
  const { min: iMin, max: iMax } = AUTOPILOT_LIMITS.maxIdleCycles;
  if (!(idle >= iMin && idle <= iMax)) errors.maxIdleCycles = `Use a whole number from ${iMin} to ${iMax}.`;
  const ceiling = parseSpendCapMinor(d.spendCeiling);
  if (Number.isNaN(ceiling) || (ceiling !== null && ceiling < 0)) errors.spendCeiling = "Use a number, like 5, or leave it empty to use the credits you have left.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, change: { cadence: d.cadence, dailyHour: Number(d.dailyHour), maxCyclesPerDay: cycles, spendCeilingMinor: ceiling, maxIdleCycles: idle } };
}

/** The draft differs from what is saved (the Save button enables). */
export function draftChanged(d: AutopilotDraft, saved: AutopilotSettingsLike): boolean {
  const parsed = parseDraft(d);
  if (!parsed.ok) return true;
  const c = parsed.change;
  return c.cadence !== saved.cadence || (c.cadence === "daily" && c.dailyHour !== saved.dailyHour) || c.maxCyclesPerDay !== saved.maxCyclesPerDay || c.spendCeilingMinor !== saved.spendCeilingMinor || c.maxIdleCycles !== saved.maxIdleCycles;
}

/** "2 of 6 cycles today" */
export function cyclesTodayLine(done: number, max: number): string {
  // plain-allow: shown only in Settings › Mode › Autopilot, whose help line defines "cycle" with a Term.
  return `${done} of ${max} cycle${max === 1 ? "" : "s"} today`;
}
