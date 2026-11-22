/**
 * Small display helpers for the booking components. Time arithmetic stays in @foundmill/shared/booking; this only
 * writes an instant in a zone the way the product writes dates: "Wed, Oct 7", "3:45 PM".
 */
import { isValidTimeZone } from "@foundmill/shared/time-zone";
import { durationLabel } from "@foundmill/shared/booking";
import { formatMoney } from "../../lib/format";

/** The zone the visitor's browser is in; UTC where the browser cannot say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const safeZone = (zone: string): string => (isValidTimeZone(zone) ? zone : "UTC");
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, zone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${key}|${zone}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, ...opts });
    cache.set(k, f);
  }
  return f;
}

/** "2026-11-23": the calendar day of an instant in a zone (a grouping key, never shown). */
export function dayKey(iso: string, zone: string): string {
  const p: Record<string, string> = {};
  for (const part of fmt("key", safeZone(zone), { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}
/** "Mon, Nov 23". */
export const dayLabel = (iso: string, zone: string): string => plain(fmt("day", safeZone(zone), { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso)));
/** "8:00 PM". */
export const clockLabel = (iso: string, zone: string): string => plain(fmt("clock", safeZone(zone), { hour: "numeric", minute: "2-digit" }).format(new Date(iso)));
/** "Wed, Nov 25, 2:00 PM", no zone name: for a table that says its zone once. */
export const whenLabel = (iso: string, zone: string): string => `${dayLabel(iso, zone)}, ${clockLabel(iso, zone)}`;

/** "Chicago time (CST)": the zone a list of times is written in. */
export function zoneNote(zone: string, at: Date): string {
  const z = safeZone(zone);
  const short = fmt("zone", z, { timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? z;
  const city = (z.split("/").pop() ?? z).replace(/_/g, " ");
  return z === "UTC" ? "UTC" : `${city} time (${short})`;
}

/** Slots grouped by the visitor's calendar day, in order. */
export function groupByDay(slots: readonly string[], zone: string): { key: string; label: string; times: string[] }[] {
  const days: { key: string; label: string; times: string[] }[] = [];
  for (const iso of slots) {
    const key = dayKey(iso, zone);
    let day = days.find((d) => d.key === key);
    if (!day) days.push((day = { key, label: dayLabel(iso, zone), times: [] }));
    day.times.push(iso);
  }
  return days;
}

/** "$90", "$12.50", "Free". */
export function priceLabel(priceMinor: number | null, currency: string): string {
  if (priceMinor === null || priceMinor === 0) return "Free";
  return formatMoney({ amountMinor: priceMinor, currency }).replace(/\.00(?!\d)/, "");
}

/** "Standard clean · 2 hours · $90". */
export const serviceLine = (s: { name: string; durationMin: number; priceMinor: number | null; currency: string }): string =>
  `${s.name} · ${durationLabel(s.durationMin)} · ${priceLabel(s.priceMinor, s.currency)}`;

export const MODE_LABEL = { online: "Online", in_person: "In person" } as const;
