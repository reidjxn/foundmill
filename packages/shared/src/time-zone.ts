/**
 * The business time zone (0041, businesses.time_zone): Home's "today", this week and this month, the Journey's daily
 * rows (journey_daily buckets in the same zone) and the top bar's date all use it, so they agree at any hour. Null or
 * unknown reads as UTC. Pure, server- and browser-safe (Intl only).
 */
export const DEFAULT_TIME_ZONE = "UTC";

/** Answers per zone name: building an Intl.DateTimeFormat to test a zone costs about 70 µs (audit C1). */
const knownZones = new Map<string, boolean>();

/** Whether the runtime knows this IANA zone ("Europe/London", "UTC"). */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  let known = knownZones.get(timeZone);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      known = true;
    } catch {
      known = false;
    }
    knownZones.set(timeZone, known);
  }
  return known;
}

/** Every zone the runtime knows, UTC first (Settings › Business). */
export function timeZoneNames(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] };
  const known = intl.supportedValuesOf?.("timeZone") ?? [];
  return [DEFAULT_TIME_ZONE, ...known.filter((z) => z !== DEFAULT_TIME_ZONE)];
}

/** "America/New York": a zone as people read it (underscores as spaces). */
export function timeZoneLabel(timeZone: string): string {
  return timeZone.replaceAll("_", " ");
}

/** The zone to compute days in: the business's when it is set and known, otherwise UTC. */
export function businessTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(date: Date, timeZone: string): Record<string, number> {
  let f = formatters.get(timeZone);
  if (!f) {
    // us-english-allow: the parts are read as numbers (the zone's date and hour 0–23), never shown to a person.
    f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

const pad2 = (n: number | undefined) => String(n ?? 0).padStart(2, "0");
const dayKeyOf = (p: Record<string, number>) => `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;

/** "2026-10-12": the calendar day of `date` in the zone (UTC when the zone is null or unknown). */
export function dayKeyIn(date: Date | number = new Date(), timeZone?: string | null): string {
  return dayKeyOf(partsIn(date instanceof Date ? date : new Date(date), businessTimeZone(timeZone)));
}

/** The calendar day and the hour of the day (0–23) of `date` in the zone: where an hour of activity falls on a heatmap. */
export function dayHourIn(date: Date | number, timeZone?: string | null): { day: string; hour: number } {
  const p = partsIn(date instanceof Date ? date : new Date(date), businessTimeZone(timeZone));
  return { day: dayKeyOf(p), hour: p.hour ?? 0 };
}

/** Milliseconds the zone is ahead of UTC at `date` (Tokyo +9 h, Los Angeles −7 h in October). */
function offsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a calendar day ("2026-10-12") starts in the zone; the next day's start bounds it (DST-safe). */
export function startOfDayIn(day: string, timeZone?: string | null): Date {
  const zone = businessTimeZone(timeZone);
  const guess = Date.parse(`${day}T00:00:00.000Z`);
  let t = guess - offsetMs(new Date(guess), zone);
  // The offset at the true start can differ from the guess's on a DST change day.
  const again = guess - offsetMs(new Date(t), zone);
  if (again !== t) t = again;
  return new Date(t);
}

/** The instants a range of calendar days covers in the zone: from the first day's start to the last day's end. */
export function dayRangeIn(from: string, to: string, timeZone?: string | null): { from: Date; to: Date } {
  const next = new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  return { from: startOfDayIn(from, timeZone), to: new Date(startOfDayIn(next, timeZone).getTime() - 1) };
}
