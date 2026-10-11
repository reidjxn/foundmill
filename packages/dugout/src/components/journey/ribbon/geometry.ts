/**
 * Journey Ribbon geometry (BUILD §11.2, DESIGN §8). Pure functions: no React, no DOM.
 *
 * The ribbon is a timeline of labelled rows on one time axis: revenue per day (with the forecast after Today), new
 * signups, paying customers and agent hours, under a strip of chapters. Shapes are built once per (data, zoom, size)
 * in a fixed pixels-per-day space covering the first day → forecast horizon, so wheel/drag scrolling is a `translate`
 * and nothing is regenerated until the zoom or the data changes (AC-11.2.1: 2 years of daily data under 2 s; see
 * geometry.test.ts for the timing test).
 */
import { area, curveMonotoneX, line } from "d3-shape";
import type { DeptColourToken, MilestoneKind } from "@foundmill/shared";
import type { DateFormatPrefs } from "../../../lib/date-preferences";
import { formatDate } from "../../../lib/format";
import type { Chapter, Conversion, DayKey, ForecastPoint, JourneyDailyRow, Milestone, RibbonDepartment, RoadmapFlag, ZoomLevel } from "../types";

export const DAY_MS = 86_400_000;
/** Average month for horizon and runway arithmetic. */
export const MONTH_DAYS = 30.44;
/** The API's key for the business-wide row (`journey_daily_mv` stores "no department" as the nil uuid). */
export const NO_DEPARTMENT_ID = "00000000-0000-0000-0000-000000000000";

/* ---------- Dates (UTC, no locale) ---------- */

export function dayToMs(day: DayKey): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

export function msToDay(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysKey(day: DayKey, n: number): DayKey {
  return msToDay(dayToMs(day) + n * DAY_MS);
}

export function toDayKey(d: Date | string): DayKey {
  if (typeof d === "string") return d.length >= 10 ? d.slice(0, 10) : d;
  return d.toISOString().slice(0, 10);
}

/* ---------- Daily index ---------- */

export interface DayPoint {
  day: DayKey;
  /** UTC midnight. */
  t: number;
  /** Days since the first day. */
  index: number;
  /** agent_hours per department id. */
  hours: Record<string, number>;
  totalHours: number;
  revenueMinor: number;
  /** Trailing 7-day mean of revenueMinor (what the revenue line draws). */
  revenue7: number;
  spendMinor: number;
  signups: number;
  activations: number;
  payments: number;
  tasksDone: number;
  decisions: number;
}

export interface DailyIndex {
  points: DayPoint[];
  byDay: Map<DayKey, DayPoint>;
  kickoff: DayKey;
  last: DayKey;
  maxHours: number;
  maxRevenue7: number;
  departmentIds: string[];
}

/** Numbers as the API sends them: Postgres `numeric` and `bigint` can arrive as strings. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fold `journey_daily` rows into one point per calendar day from `kickoff` (default: first row) to `last`
 * (default: last row or today), filling gaps with zeros. Department rows feed agent hours; the business-wide row
 * (departmentId null or the nil uuid) feeds revenue and conversions, falling back to the sum of department rows when
 * absent. Numeric strings are read as numbers.
 */
export function indexDailyRows(rows: readonly JourneyDailyRow[], departments: readonly RibbonDepartment[], opts: { kickoff?: DayKey; last?: DayKey } = {}): DailyIndex {
  const departmentIds = departments.map((d) => d.id);
  let first = opts.kickoff ?? null;
  let last = opts.last ?? null;
  for (const r of rows) {
    if (!opts.kickoff && (first === null || r.day < first)) first = r.day;
    if (!opts.last && (last === null || r.day > last)) last = r.day;
  }
  if (first === null) first = last ?? msToDay(Date.now());
  if (last === null || last < first) last = first;
  const n = Math.round((dayToMs(last) - dayToMs(first)) / DAY_MS) + 1;
  const points: DayPoint[] = new Array(n);
  const byDay = new Map<DayKey, DayPoint>();
  const t0 = dayToMs(first);
  for (let i = 0; i < n; i++) {
    const hours: Record<string, number> = {};
    for (const id of departmentIds) hours[id] = 0;
    const p: DayPoint = { day: msToDay(t0 + i * DAY_MS), t: t0 + i * DAY_MS, index: i, hours, totalHours: 0, revenueMinor: 0, revenue7: 0, spendMinor: 0, signups: 0, activations: 0, payments: 0, tasksDone: 0, decisions: 0 };
    points[i] = p;
    byDay.set(p.day, p);
  }
  const hasBusinessRow = new Set<DayKey>();
  for (const r of rows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    if (r.departmentId === null || r.departmentId === NO_DEPARTMENT_ID) {
      hasBusinessRow.add(r.day);
      p.revenueMinor = num(r.revenueMinor);
      p.spendMinor = num(r.spendMinor);
      p.signups = num(r.signups);
      p.activations = num(r.activations);
      p.payments = num(r.payments);
      p.tasksDone = num(r.tasksDone);
      p.decisions = num(r.decisions);
    } else if (r.departmentId in p.hours) {
      const h = num(r.agentHours);
      p.hours[r.departmentId] = (p.hours[r.departmentId] ?? 0) + h;
      p.totalHours += h;
      if (!hasBusinessRow.has(r.day)) {
        p.revenueMinor += num(r.revenueMinor);
        p.spendMinor += num(r.spendMinor);
        p.signups += num(r.signups);
        p.activations += num(r.activations);
        p.payments += num(r.payments);
        p.tasksDone += num(r.tasksDone);
        p.decisions += num(r.decisions);
      }
    }
  }
  let maxHours = 0;
  let maxRevenue7 = 0;
  let window = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i] as DayPoint;
    window += p.revenueMinor;
    if (i >= 7) window -= (points[i - 7] as DayPoint).revenueMinor;
    p.revenue7 = window / Math.min(7, i + 1);
    if (p.totalHours > maxHours) maxHours = p.totalHours;
    if (p.revenue7 > maxRevenue7) maxRevenue7 = p.revenue7;
  }
  return { points, byDay, kickoff: first, last, maxHours, maxRevenue7, departmentIds };
}

/**
 * Totals over the `days` days ending on `end` (inclusive): what the row labels show when nothing is hovered.
 * `revenueChange` compares revenue with the `days` before (null when that window had none).
 */
export function windowTotals(index: DailyIndex, end: DayKey, days = 7): { revenuePerDay: number; revenueChange: number | null; signups: number; payments: number; hours: number; from: DayKey; to: DayKey } {
  const from = addDaysKey(end, -(days - 1));
  const before = addDaysKey(from, -days);
  let previous = 0;
  let revenue = 0;
  let signups = 0;
  let payments = 0;
  let hours = 0;
  for (const p of index.points) {
    if (p.day >= before && p.day < from) previous += p.revenueMinor;
    if (p.day < from || p.day > end) continue;
    revenue += p.revenueMinor;
    signups += p.signups;
    payments += p.payments;
    hours += p.totalHours;
  }
  return { revenuePerDay: revenue / days, revenueChange: previous > 0 ? (revenue - previous) / previous : null, signups, payments, hours, from, to: end };
}

/* ---------- Zoom ---------- */

export const ZOOM_SPAN_DAYS: Record<Exclude<ZoomLevel, "all">, number> = { week: 7, month: 30, quarter: 91 };

export const ZOOM_LABELS: Record<ZoomLevel, string> = { week: "Week", month: "Month", quarter: "Quarter", all: "All time" };

/** Days visible across the ribbon's width at a zoom level. */
export function zoomSpanDays(zoom: ZoomLevel, totalDays: number): number {
  return zoom === "all" ? Math.max(1, totalDays) : ZOOM_SPAN_DAYS[zoom];
}

/* ---------- Layout ---------- */

export type TrackKind = "signups" | "payments" | "hours";

export interface TrackBand {
  top: number;
  bottom: number;
}

/** Vertical bands of the plot (the SVG right of the row labels, under the toolbar). */
export interface RibbonLayout {
  width: number;
  height: number;
  chapterTop: number;
  chapterBottom: number;
  revenueTop: number;
  revenueBottom: number;
  tracks: Record<TrackKind, TrackBand>;
  axisTop: number;
}

const CHAPTER_STRIP = 24;
const TRACK_HEIGHTS: Record<TrackKind, number> = { signups: 22, payments: 22, hours: 26 };
const TRACK_GAP = 6;
const AXIS_HEIGHT = 26;
/** Pins (releases, milestones, planned items) are 22 px chips in lanes 28 px apart, the first 10 px under the chapters. */
export const PIN_TOP = CHAPTER_STRIP + 10;
export const PIN_LANE = 28;
export const PIN_HEIGHT = 22;
/** The chip starts this far left of its day, so the flag sits on the drop line. */
export const PIN_INSET = 9;

/** Bands for a plot of `width` × `height`: the chapter strip, the revenue chart (whatever is left), three bar rows, the axis. */
export function ribbonLayout(width: number, height: number): RibbonLayout {
  const axisTop = height - AXIS_HEIGHT;
  const hoursBottom = axisTop - 4;
  const hoursTop = hoursBottom - TRACK_HEIGHTS.hours;
  const paymentsBottom = hoursTop - TRACK_GAP;
  const paymentsTop = paymentsBottom - TRACK_HEIGHTS.payments;
  const signupsBottom = paymentsTop - TRACK_GAP;
  const signupsTop = signupsBottom - TRACK_HEIGHTS.signups;
  // The revenue scale starts under the first lane of pins when there is room, so the top gridline label is never
  // covered by a chip; a short ribbon keeps the old 20 px gap.
  const roomy = signupsTop - 12 - (CHAPTER_STRIP + 44) >= 120;
  const revenueTop = CHAPTER_STRIP + (roomy ? 44 : 20);
  const revenueBottom = Math.max(revenueTop + 40, signupsTop - 12);
  return {
    width,
    height,
    chapterTop: 0,
    chapterBottom: CHAPTER_STRIP,
    revenueTop,
    revenueBottom,
    tracks: { signups: { top: signupsTop, bottom: signupsBottom }, payments: { top: paymentsTop, bottom: paymentsBottom }, hours: { top: hoursTop, bottom: hoursBottom } },
    axisTop,
  };
}

/* ---------- Geometry ---------- */

export interface TrackBar {
  key: string;
  /** First day of the bar. */
  day: DayKey;
  /** Last day of the bar (same as `day` for one-day bars). */
  dayEnd: DayKey;
  x: number;
  w: number;
  y: number;
  h: number;
  value: number;
  /** Payments only: the conversion ids the ribbon knows for this bar (the API sends the most recent ones). */
  ids: string[];
}

export interface TrackGeometry {
  kind: TrackKind;
  top: number;
  bottom: number;
  /** Largest bar value over the whole history at this zoom. */
  max: number;
  /** Days per bar at this zoom (1 or 7). */
  bucketDays: number;
  bars: TrackBar[];
}

export interface RevenueGeometry {
  linePath: string;
  areaPath: string;
  max: number;
  y: (minor: number) => number;
  /** Gridline values (minor units per day), 0 first. */
  ticks: number[];
}

export type MilestoneGlyphKind = "trophy" | "flag" | "diamond" | "banner";

export interface MilestoneGlyph {
  id: string;
  kind: MilestoneKind;
  glyph: MilestoneGlyphKind;
  label: string;
  day: DayKey;
  x: number;
  y: number;
  /** Lane 0–2 (rows of pins, top first). */
  lane: number;
  /** Whether the label fits beside the pin at this zoom; otherwise only the pin is drawn (the name is in its title). */
  showLabel: boolean;
  stemTo: number;
}

export interface ChapterSpan {
  id: string;
  /** "Q3 2026". */
  name: string;
  x0: number;
  x1: number;
  label: string;
  status: Chapter["status"];
  /** Position among the chapters, for alternating shading. */
  order: number;
  chapter: Chapter;
}

export interface ForecastGeometry {
  conePath: string;
  basePath: string;
  /** Horizon end x. */
  x1: number;
}

export interface RoadmapGlyph {
  id: string;
  label: string;
  day: DayKey;
  x: number;
  y: number;
  showLabel: boolean;
}

export type RunwayHorizonTone = "neutral" | "warn" | "bad";

export interface RunwayGeometry {
  months: number;
  endDay: DayKey;
  /** x of the runway-out date (may be past the horizon). */
  x: number;
  /** Whether the runway-out date falls inside the drawn range. */
  inRange: boolean;
  tone: RunwayHorizonTone;
  label: string;
}

export interface RibbonTick {
  x: number;
  label: string;
  major: boolean;
  day: DayKey;
}

export interface RibbonGeometry {
  zoom: ZoomLevel;
  layout: RibbonLayout;
  pxPerDay: number;
  /** Width of the full ribbon (first day → horizon) at this zoom. */
  totalWidth: number;
  totalDays: number;
  kickoff: DayKey;
  today: DayKey;
  horizon: DayKey;
  todayX: number;
  revenue: RevenueGeometry;
  tracks: Record<TrackKind, TrackGeometry>;
  milestones: MilestoneGlyph[];
  chapters: ChapterSpan[];
  forecast: ForecastGeometry | null;
  roadmap: RoadmapGlyph[];
  runway: RunwayGeometry | null;
  ticks: RibbonTick[];
  /** x of a day's centre. */
  xOfDay: (day: DayKey) => number;
  /** x of a timestamp (ms). */
  xOfMs: (ms: number) => number;
  /** The day under an x position (clamped to first day … horizon). */
  dayAt: (x: number) => DayKey;
}

export interface RibbonGeometryInput {
  index: DailyIndex;
  departments: readonly RibbonDepartment[];
  conversions: readonly Conversion[];
  milestones: readonly Milestone[];
  chapters: readonly Chapter[];
  /** Revenue per day after Today (base, upside, downside). */
  forecast?: readonly ForecastPoint[];
  roadmap?: readonly RoadmapFlag[];
  runwayMonths?: number | null;
  today: DayKey;
  horizonMonths?: number;
  zoom: ZoomLevel;
  /** Plot width (the ribbon minus its row labels). */
  width: number;
  /** Plot height (the ribbon minus its toolbar). */
  height: number;
  /** The signed-in person's date format, for the axis and runway labels (US when absent). */
  datePrefs?: DateFormatPrefs | null;
}

export const MILESTONE_GLYPH: Record<MilestoneKind, MilestoneGlyphKind> = {
  customer: "trophy",
  revenue: "trophy",
  trophy: "trophy",
  release: "flag",
  decision: "diamond",
  incorporation: "banner",
  funding: "banner",
  launch: "banner",
};

/** DESIGN §8 runway horizon: neutral, amber under 9 months, red under 6. */
export function runwayToneFor(months: number): RunwayHorizonTone {
  if (months < 6) return "bad";
  if (months < 9) return "warn";
  return "neutral";
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * An axis label in the signed-in person's date format: "Wed 7" at week zoom (no month, so the same in every format);
 * "Oct 7" / "7 Oct" / "10-07" at month and quarter zoom; "Oct ’26" (ISO "2026-10") at the whole span, a January the
 * bare year.
 */
export function ribbonTickLabel(day: DayKey, zoom: ZoomLevel, prefs?: DateFormatPrefs | null): string {
  const d = new Date(dayToMs(day));
  const dd = d.getUTCDate();
  if (zoom === "week") return `${DOW_SHORT[d.getUTCDay()]} ${dd}`;
  if (zoom === "all") {
    if (dd === 1 && d.getUTCMonth() === 0) return String(d.getUTCFullYear());
    return prefs?.date === "iso" ? formatDate(day, "monthYear", prefs) : `${MONTHS_SHORT[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`;
  }
  return formatDate(day, "dayMonth", prefs);
}

/** "Mar 2027" for a day ("2027-03" in ISO). */
export function monthYear(day: DayKey, prefs?: DateFormatPrefs | null): string {
  return formatDate(day, "monthYear", prefs);
}

/** "2026-Q3" → "Q3 2026"; anything else unchanged. */
export function chapterName(id: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(id);
  return m ? `Q${m[2]} ${m[1]}` : id;
}

/** Round gridline values: 0 and up to `count` steps of 1, 2, 2.5 or 5 × 10ⁿ covering `max`. */
export function niceTicks(max: number, count = 3): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow) as number;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Labels longer than this are cut with an ellipsis on the chip (the full label is in its tooltip). */
export const PIN_LABEL_MAX = 28;
/**
 * The width of a pin chip from its day's x: the flag, 12 px Inter 500 at about 6.6 px a character, and padding (no DOM
 * to measure in a pure function). `labelWidth(label) - PIN_INSET` is how far right of the day the chip ends.
 */
export const pinChipWidth = (text: string) => 33 + Math.min(text.length, PIN_LABEL_MAX) * 6.6;
const labelWidth = (text: string) => pinChipWidth(text) - PIN_INSET + 4;
/** An icon-only chip (the label did not fit). */
const ICON_CHIP = PIN_HEIGHT - PIN_INSET + 4;

/**
 * Pack pins into up to three lanes left to right; a label is shown when it fits before the next pin in its lane.
 * `blocked` spans (Today's tag in lane 0) are never covered.
 */
function packPins<T extends { x: number; label: string }>(items: readonly T[], maxLanes = 3, blocked: ReadonlyArray<{ lane: number; x0: number; x1: number }> = []): Array<T & { lane: number; showLabel: boolean }> {
  const out: Array<T & { lane: number; showLabel: boolean }> = [];
  const laneEnd: number[] = Array.from({ length: maxLanes }, () => -Infinity);
  const free = (lane: number, x0: number, x1: number) => (laneEnd[lane] ?? -Infinity) <= x0 && !blocked.some((b) => b.lane === lane && b.x0 < x1 && b.x1 > x0);
  for (const it of items) {
    const start = it.x - PIN_INSET - 2;
    let lane = -1;
    let showLabel = true;
    for (let l = 0; l < maxLanes && lane === -1; l++) if (free(l, start, it.x + labelWidth(it.label))) lane = l;
    if (lane === -1) {
      showLabel = false;
      for (let l = 0; l < maxLanes && lane === -1; l++) if (free(l, start, it.x + ICON_CHIP)) lane = l;
    }
    if (lane === -1) lane = laneEnd.indexOf(Math.min(...laneEnd));
    laneEnd[lane] = it.x + (showLabel ? labelWidth(it.label) : ICON_CHIP);
    out.push({ ...it, lane, showLabel });
  }
  // A label can only stay if nothing later in its lane starts under it.
  for (let i = 0; i < out.length; i++) {
    const a = out[i] as T & { lane: number; showLabel: boolean };
    if (!a.showLabel) continue;
    const next = out.slice(i + 1).find((b) => b.lane === a.lane);
    if (next && next.x - PIN_INSET - 2 < a.x + labelWidth(a.label)) a.showLabel = false;
  }
  return out;
}

/** The Today tag's half-width, reserved in the first pin lane ("Today · 30 Sep · 12 live" fits). */
export const TODAY_TAG_HALF = 62;

/** The y of a pin lane's chips (lane 0 is level with the Today tag). */
export const pinLaneY = (lane: number) => PIN_TOP + lane * PIN_LANE;

export interface PinChipInput {
  id: string;
  /** The pin's day, in plot pixels (before scrolling). */
  x: number;
  /** Its lane's y from the packing. */
  y: number;
  /** The label to show (already cut to PIN_LABEL_MAX), or null for an icon-only chip. */
  label: string | null;
}

export interface PlacedPinChip {
  id: string;
  y: number;
  /** The label drawn, or null when only the icon fits. */
  label: string | null;
  /** Window pixels (after scrolling). */
  left: number;
  right: number;
  /** "end": the chip ends at its drop line (flipped to the left of its day). */
  anchor: "start" | "end";
}

/**
 * Place the pin chips of the visible window so that none overlaps another or the Today tag (`avoid`, in window
 * pixels). The packing in `buildRibbonGeometry` works on the whole time axis; here the window is known, so a chip
 * that would cross the plot's right edge flips to end at its day, and a chip that then meets the Today tag (whose
 * position is clamped into the window) or another chip tries, in order: its other side, another lane, its icon alone
 * in its lane, its icon in another lane. A chip with nowhere to go is left out (its drop line and title remain). Pure.
 */
export function placePinChips(pins: readonly PinChipInput[], opts: { scrollX: number; plotW: number; lanes?: number; avoid?: { left: number; right: number; y: number } | null; gap?: number }): Map<string, PlacedPinChip> {
  const { scrollX, plotW } = opts;
  const lanes = opts.lanes ?? 3;
  const gap = opts.gap ?? 4;
  const taken = new Map<number, Array<{ left: number; right: number }>>();
  const take = (y: number, r: { left: number; right: number }) => taken.set(y, [...(taken.get(y) ?? []), r]);
  if (opts.avoid) take(opts.avoid.y, { left: opts.avoid.left, right: opts.avoid.right });
  const free = (y: number, r: { left: number; right: number }) => !(taken.get(y) ?? []).some((t) => t.left < r.right + gap && t.right > r.left - gap);
  const rect = (sx: number, w: number, anchor: "start" | "end") => (anchor === "start" ? { left: sx - PIN_INSET, right: sx - PIN_INSET + w } : { left: sx + PIN_INSET - w, right: sx + PIN_INSET });
  const out = new Map<string, PlacedPinChip>();
  for (const p of [...pins].sort((a, b) => a.x - b.x)) {
    const sx = p.x - scrollX;
    const ys = [p.y, ...Array.from({ length: lanes }, (_, l) => pinLaneY(l)).filter((y) => y !== p.y)];
    const tries: Array<{ y: number; label: string | null; anchor: "start" | "end" }> = [];
    const sides = (w: number): Array<"start" | "end"> => {
      const start = rect(sx, w, "start");
      const end = rect(sx, w, "end");
      // Preferred: to the right of the day, unless that crosses the plot's edge and the left side has room.
      const startFits = start.right <= plotW - 4;
      const endFits = end.left >= 0;
      if (startFits) return endFits ? ["start", "end"] : ["start"];
      return endFits ? ["end"] : ["start"];
    };
    if (p.label) for (const y of ys) for (const a of sides(pinChipWidth(p.label))) tries.push({ y, label: p.label, anchor: a });
    for (const y of ys) tries.push({ y, label: null, anchor: "start" });
    for (const t of tries) {
      const r = rect(sx, t.label ? pinChipWidth(t.label) : PIN_HEIGHT, t.anchor);
      if (!free(t.y, r)) continue;
      take(t.y, r);
      out.set(p.id, { id: p.id, y: t.y, label: t.label, anchor: t.anchor, ...r });
      break;
    }
  }
  return out;
}

export function buildRibbonGeometry(input: RibbonGeometryInput): RibbonGeometry {
  const { index, zoom, width, height, today } = input;
  const horizonMonths = input.horizonMonths ?? 6;
  const layout = ribbonLayout(width, height);
  const kickoff = index.kickoff;
  const kickoffMs = dayToMs(kickoff);
  const horizonDays = Math.round(horizonMonths * MONTH_DAYS);
  const horizon = addDaysKey(today, horizonDays);
  const totalDays = Math.max(1, Math.round((dayToMs(horizon) - kickoffMs) / DAY_MS) + 1);
  const spanDays = zoomSpanDays(zoom, totalDays);
  const pxPerDay = width / spanDays;
  const totalWidth = totalDays * pxPerDay;
  const xOfMs = (ms: number) => ((ms - kickoffMs) / DAY_MS) * pxPerDay;
  const xOfDay = (day: DayKey) => xOfMs(dayToMs(day)) + pxPerDay / 2;
  const dayAt = (x: number) => {
    const i = Math.max(0, Math.min(totalDays - 1, Math.floor(x / pxPerDay)));
    return msToDay(kickoffMs + i * DAY_MS);
  };
  const todayX = xOfDay(today);
  const history = index.points.filter((p) => p.day <= today);

  // Revenue per day (7-day mean) with gridlines, and the forecast cone on the same scale.
  const forecastPoints = (input.forecast ?? []).filter((f) => f.day > today && f.day <= horizon);
  let revPeak = index.maxRevenue7;
  for (const f of forecastPoints) if (f.upsideMinor > revPeak) revPeak = f.upsideMinor;
  const ticks = niceTicks(Math.max(1, revPeak));
  const revMax = Math.max(1, ticks[ticks.length - 1] ?? 1);
  const revY = (v: number) => layout.revenueBottom - (Math.max(0, v) / revMax) * (layout.revenueBottom - layout.revenueTop);
  const revLine = line<DayPoint>()
    .x((d) => xOfDay(d.day))
    .y((d) => revY(d.revenue7))
    .curve(curveMonotoneX);
  const revArea = area<DayPoint>()
    .x((d) => xOfDay(d.day))
    .y0(layout.revenueBottom)
    .y1((d) => revY(d.revenue7))
    .curve(curveMonotoneX);
  const revenue: RevenueGeometry = {
    linePath: history.length > 1 ? (revLine(history) ?? "") : "",
    areaPath: history.length > 1 ? (revArea(history) ?? "") : "",
    max: revMax,
    y: revY,
    ticks,
  };

  let forecast: ForecastGeometry | null = null;
  if (forecastPoints.length > 0) {
    const lastReal = history[history.length - 1];
    const seed: ForecastPoint | null = lastReal ? { day: lastReal.day, baseMinor: lastReal.revenue7, upsideMinor: lastReal.revenue7, downsideMinor: lastReal.revenue7 } : null;
    const pts = seed ? [seed, ...forecastPoints] : [...forecastPoints];
    if (pts.length > 1) {
      const cone = area<ForecastPoint>()
        .x((d) => xOfDay(d.day))
        .y0((d) => revY(d.downsideMinor))
        .y1((d) => revY(d.upsideMinor))
        .curve(curveMonotoneX);
      const base = line<ForecastPoint>()
        .x((d) => xOfDay(d.day))
        .y((d) => revY(d.baseMinor))
        .curve(curveMonotoneX);
      forecast = { conePath: cone(pts) ?? "", basePath: base(pts) ?? "", x1: xOfDay(horizon) };
    }
  }

  // Bar rows: one bar per day while days are at least 4 px wide, one per week otherwise.
  const bucketDays = pxPerDay >= 4 ? 1 : 7;
  const paymentIds = new Map<DayKey, string[]>();
  for (const c of input.conversions) {
    if (c.kind !== "payment") continue;
    const ms = Date.parse(c.occurredAt);
    if (!Number.isFinite(ms)) continue;
    const day = msToDay(ms);
    const list = paymentIds.get(day) ?? [];
    list.push(c.id);
    paymentIds.set(day, list);
  }
  const buildTrack = (kind: TrackKind, value: (p: DayPoint) => number): TrackGeometry => {
    const band = layout.tracks[kind];
    const sums: Array<{ b: number; value: number; first: DayPoint; last: DayPoint; ids: string[] }> = [];
    for (const p of history) {
      const b = Math.floor(p.index / bucketDays);
      let s = sums[sums.length - 1];
      if (!s || s.b !== b) {
        s = { b, value: 0, first: p, last: p, ids: [] };
        sums.push(s);
      }
      s.value += value(p);
      s.last = p;
      if (kind === "payments") s.ids.push(...(paymentIds.get(p.day) ?? []));
    }
    let max = 0;
    for (const s of sums) if (s.value > max) max = s.value;
    const usable = band.bottom - band.top - 1;
    const span = bucketDays * pxPerDay;
    // Bars sit centred on their day (or week), like the axis ticks and the revenue line; wide days get a capped bar.
    const w = Math.max(1, Math.min(span >= 4 ? span - 1 : span, Math.max(span * 0.7, 6), 36));
    const bars: TrackBar[] = [];
    for (const s of sums) {
      if (s.value <= 0) continue;
      const h = Math.max(1.5, (s.value / Math.max(1e-9, max)) * usable);
      const centre = xOfMs(dayToMs(s.first.day)) + span / 2;
      bars.push({ key: `${kind}:${s.b}`, day: s.first.day, dayEnd: s.last.day, x: centre - w / 2, w, y: band.bottom - h, h, value: s.value, ids: s.ids });
    }
    return { kind, top: band.top, bottom: band.bottom, max, bucketDays, bars };
  };
  const tracks: Record<TrackKind, TrackGeometry> = {
    signups: buildTrack("signups", (p) => p.signups),
    payments: buildTrack("payments", (p) => p.payments),
    hours: buildTrack("hours", (p) => p.totalHours),
  };

  // Milestones and planned roadmap items as labelled pins over the revenue chart, packed together into up to three
  // rows so no two labels overlap.
  const pinY = pinLaneY;
  type Pin = { x: number; label: string; day: DayKey; id: string } & ({ type: "milestone"; kind: MilestoneKind; glyph: MilestoneGlyphKind } | { type: "planned" });
  const pins: Pin[] = [];
  for (const m of input.milestones) {
    const ms = Date.parse(m.achievedAt);
    if (!Number.isFinite(ms)) continue;
    const day = msToDay(ms);
    if (day < kickoff || day > horizon) continue;
    pins.push({ type: "milestone", id: m.id ?? `${m.kind}:${m.achievedAt}`, kind: m.kind, glyph: MILESTONE_GLYPH[m.kind], label: m.label, day, x: xOfDay(day) });
  }
  for (const f of input.roadmap ?? []) {
    if (f.plannedOn <= today || f.plannedOn > horizon) continue;
    pins.push({ type: "planned", id: f.id, label: f.label, day: f.plannedOn, x: xOfDay(f.plannedOn) });
  }
  pins.sort((a, b) => a.x - b.x || a.label.localeCompare(b.label));
  const packed = packPins(pins, 3, [{ lane: 0, x0: todayX - TODAY_TAG_HALF - 4, x1: todayX + TODAY_TAG_HALF + 4 }]);
  const milestones: MilestoneGlyph[] = [];
  const roadmap: RoadmapGlyph[] = [];
  for (const p of packed) {
    if (p.type === "milestone") milestones.push({ id: p.id, kind: p.kind, glyph: p.glyph, label: p.label, day: p.day, x: p.x, y: pinY(p.lane), lane: p.lane, showLabel: p.showLabel, stemTo: layout.revenueBottom });
    else roadmap.push({ id: p.id, label: p.label, day: p.day, x: p.x, y: pinY(p.lane), showLabel: p.showLabel });
  }

  // Chapters (quarters) along the top.
  const chapters: ChapterSpan[] = [];
  for (const ch of input.chapters) {
    if (ch.endsOn < kickoff || ch.startsOn > horizon) continue;
    const start = ch.startsOn < kickoff ? kickoff : ch.startsOn;
    const end = ch.endsOn > horizon ? horizon : ch.endsOn;
    chapters.push({ id: ch.id, name: chapterName(ch.id), x0: xOfDay(start) - pxPerDay / 2, x1: xOfDay(end) + pxPerDay / 2, label: ch.title ?? ch.provisionalTitle, status: ch.status, order: ch.index, chapter: ch });
  }

  // Runway: the estimated day the cash runs out.
  let runway: RunwayGeometry | null = null;
  if (input.runwayMonths !== null && input.runwayMonths !== undefined && Number.isFinite(input.runwayMonths)) {
    const months = Math.max(0, input.runwayMonths);
    const endDay = addDaysKey(today, Math.round(months * MONTH_DAYS));
    const x = xOfDay(endDay);
    const monthsText = months < 10 ? months.toFixed(1).replace(/\.0$/, "") : String(Math.round(months));
    runway = { months, endDay, x, inRange: endDay <= horizon, tone: runwayToneFor(months), label: endDay <= horizon ? `Cash runs out ~${monthYear(endDay, input.datePrefs)}` : `Cash lasts ${monthsText} months` };
  }

  // Axis ticks for the whole domain; the component culls to the visible window.
  const axisTicks: RibbonTick[] = [];
  const step = zoom === "week" ? 1 : zoom === "month" ? 7 : zoom === "quarter" ? 14 : 0;
  if (step > 0) {
    for (let i = 0; i < totalDays; i += step) {
      const day = msToDay(kickoffMs + i * DAY_MS);
      const d = new Date(dayToMs(day));
      axisTicks.push({ x: xOfDay(day), label: ribbonTickLabel(day, zoom, input.datePrefs), major: step === 1 ? d.getUTCDay() === 1 : d.getUTCDate() <= step, day });
    }
  } else {
    // Month starts.
    const d = new Date(kickoffMs);
    d.setUTCDate(1);
    if (msToDay(d.getTime()) < kickoff) d.setUTCMonth(d.getUTCMonth() + 1);
    const horizonMs = dayToMs(horizon);
    const everyN = totalDays > 1200 ? 3 : totalDays > 600 ? 2 : 1;
    let k = 0;
    while (d.getTime() <= horizonMs) {
      const day = msToDay(d.getTime());
      if (k % everyN === 0 || d.getUTCMonth() === 0) axisTicks.push({ x: xOfDay(day), label: ribbonTickLabel(day, zoom, input.datePrefs), major: d.getUTCMonth() === 0, day });
      d.setUTCMonth(d.getUTCMonth() + 1);
      k += 1;
    }
  }

  return { zoom, layout, pxPerDay, totalWidth, totalDays, kickoff, today, horizon, todayX, revenue, tracks, milestones, chapters, forecast, roadmap, runway, ticks: axisTicks, xOfDay, xOfMs, dayAt };
}

/** The forecast (revenue per day) for a future day, interpolated between the points either side. */
export function forecastAt(forecast: readonly ForecastPoint[] | undefined, day: DayKey): ForecastPoint | null {
  if (!forecast || forecast.length === 0) return null;
  const sorted = [...forecast].sort((a, b) => a.day.localeCompare(b.day));
  const exact = sorted.find((f) => f.day === day);
  if (exact) return exact;
  const after = sorted.findIndex((f) => f.day > day);
  if (after <= 0) return null; // before the first point or after the last
  const a = sorted[after - 1] as ForecastPoint;
  const b = sorted[after] as ForecastPoint;
  const t = (dayToMs(day) - dayToMs(a.day)) / Math.max(1, dayToMs(b.day) - dayToMs(a.day));
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return { day, baseMinor: mix(a.baseMinor, b.baseMinor), upsideMinor: mix(a.upsideMinor, b.upsideMinor), downsideMinor: mix(a.downsideMinor, b.downsideMinor) };
}

/* ---------- Scrolling helpers ---------- */

/** Clamp a scroll offset so the window stays inside the ribbon. */
/**
 * Width of the flow-in reveal mask at a frame: ease-out cubic from 0 to `plotW`. A frame's timestamp can be earlier
 * than the moment the animation started, so progress is clamped to 0–1 and the width is never negative.
 */
export function revealWidth(now: number, start: number, durationMs: number, plotW: number): number {
  const t = Math.min(1, Math.max(0, (now - start) / durationMs));
  return Math.ceil((1 - Math.pow(1 - t, 3)) * Math.max(0, plotW));
}

export function clampScroll(scrollX: number, totalWidth: number, width: number): number {
  return Math.max(0, Math.min(Math.max(0, totalWidth - width), scrollX));
}

/** Scroll offset that puts Today at `anchor` (0–1) of the visible width. */
export function scrollForToday(geometry: Pick<RibbonGeometry, "todayX" | "totalWidth">, width: number, anchor = 0.7): number {
  return clampScroll(geometry.todayX - width * anchor, geometry.totalWidth, width);
}

/** Keep the day under `fraction` of the window fixed when the zoom changes. */
export function scrollKeepingDay(day: DayKey, fraction: number, next: Pick<RibbonGeometry, "xOfDay" | "totalWidth">, width: number): number {
  return clampScroll(next.xOfDay(day) - width * fraction, next.totalWidth, width);
}

/* ---------- Day summaries ("On this day", DayDigest) ---------- */

export interface DaySummary {
  day: DayKey;
  point: DayPoint | null;
  chapter: Chapter | null;
  departments: Array<{ id: string; name: string; dept: DeptColourToken; hours: number }>;
  conversions: Conversion[];
  milestones: Milestone[];
  isFuture: boolean;
  isToday: boolean;
}

export function summariseDay(day: DayKey, args: { index: DailyIndex; departments: readonly RibbonDepartment[]; conversions: readonly Conversion[]; milestones: readonly Milestone[]; chapters: readonly Chapter[]; today: DayKey }): DaySummary {
  const point = args.index.byDay.get(day) ?? null;
  const chapter = args.chapters.find((c) => c.startsOn <= day && day <= c.endsOn) ?? null;
  const departments = args.departments
    .map((d) => ({ id: d.id, name: d.name, dept: d.dept, hours: point?.hours[d.id] ?? 0 }))
    .sort((a, b) => b.hours - a.hours);
  const conversions = args.conversions.filter((c) => c.occurredAt.slice(0, 10) === day).sort((a, b) => b.amountMinor - a.amountMinor || a.occurredAt.localeCompare(b.occurredAt));
  const milestones = args.milestones.filter((m) => m.achievedAt.slice(0, 10) === day);
  return { day, point, chapter, departments, conversions, milestones, isFuture: day > args.today, isToday: day === args.today };
}
