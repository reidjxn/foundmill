/**
 * Journey Ribbon geometry (BUILD §11.2, DESIGN §8). Pure functions: no React, no DOM.
 *
 * Paths are built once per (data, zoom, size) in a fixed pixels-per-day space covering kick-off → forecast horizon,
 * so wheel/drag scrolling is a `translate` and nothing is regenerated until the zoom or the data changes
 * (AC-11.2.1: 2 years of daily data under 2 s; see geometry.test.ts for the timing test).
 */
import { area, curveBasis, curveMonotoneX, line, stack, stackOffsetSilhouette, stackOrderInsideOut } from "d3-shape";
import type { ConversionKind, DeptColourToken, MilestoneKind } from "@founder-manager/shared";
import type { Chapter, Conversion, DayKey, ForecastPoint, JourneyDailyRow, Milestone, RibbonDepartment, RoadmapFlag, ZoomLevel } from "../types";

export const DAY_MS = 86_400_000;
/** Average month for horizon and runway arithmetic. */
export const MONTH_DAYS = 30.44;

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
  /** Days since kick-off. */
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

/**
 * Fold `journey_daily` rows into one point per calendar day from `kickoff` (default: first row) to `last`
 * (default: last row or today), filling gaps with zeros. Department rows feed the river; the business-wide row
 * (departmentId null) feeds revenue and conversions, falling back to the sum of department rows when absent.
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
    if (r.departmentId === null) {
      hasBusinessRow.add(r.day);
      p.revenueMinor = r.revenueMinor;
      p.spendMinor = r.spendMinor;
      p.signups = r.signups;
      p.activations = r.activations;
      p.payments = r.payments;
      p.tasksDone = r.tasksDone;
      p.decisions = r.decisions;
    } else if (r.departmentId in p.hours) {
      p.hours[r.departmentId] = (p.hours[r.departmentId] ?? 0) + r.agentHours;
      p.totalHours += r.agentHours;
      if (!hasBusinessRow.has(r.day)) {
        p.revenueMinor += r.revenueMinor;
        p.spendMinor += r.spendMinor;
        p.signups += r.signups;
        p.activations += r.activations;
        p.payments += r.payments;
        p.tasksDone += r.tasksDone;
        p.decisions += r.decisions;
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

/* ---------- Zoom ---------- */

export const ZOOM_SPAN_DAYS: Record<Exclude<ZoomLevel, "all">, number> = { week: 7, month: 30, quarter: 91 };

export const ZOOM_LABELS: Record<ZoomLevel, string> = { week: "Week", month: "Month", quarter: "Quarter", all: "All time" };

/** Days visible across the ribbon's width at a zoom level. */
export function zoomSpanDays(zoom: ZoomLevel, totalDays: number): number {
  return zoom === "all" ? Math.max(1, totalDays) : ZOOM_SPAN_DAYS[zoom];
}

/* ---------- Layout ---------- */

export interface RibbonLayout {
  width: number;
  height: number;
  chapterBand: number;
  laneTop: number;
  lanes: Record<ConversionKind, number>;
  revenueTop: number;
  revenueBottom: number;
  riverTop: number;
  riverBottom: number;
  riverMid: number;
  axisTop: number;
}

/** Vertical bands for a given height (reference 300 px, DESIGN §9). Everything scales with the height. */
export function ribbonLayout(width: number, height: number): RibbonLayout {
  const s = height / 300;
  const r = (v: number) => Math.round(v * s);
  const riverTop = r(142);
  const riverBottom = r(262);
  return {
    width,
    height,
    chapterBand: r(20),
    laneTop: r(26),
    lanes: { payment: r(34), activation: r(47), signup: r(58) },
    revenueTop: r(68),
    revenueBottom: r(136),
    riverTop,
    riverBottom,
    riverMid: Math.round((riverTop + riverBottom) / 2),
    axisTop: r(266),
  };
}

/* ---------- Geometry ---------- */

export interface RiverBand {
  departmentId: string;
  name: string;
  dept: DeptColourToken;
  path: string;
}

export interface RevenueGeometry {
  path: string;
  max: number;
  y: (minor: number) => number;
}

export interface MarkerBucket {
  key: string;
  kind: ConversionKind;
  /** First day of the bucket. */
  day: DayKey;
  /** Last day of the bucket (same as `day` for one-day buckets). */
  dayEnd: DayKey;
  x: number;
  y: number;
  /** Radius in px, grows with the count. */
  r: number;
  count: number;
  amountMinor: number;
  currency: string;
  ids: string[];
  names: string[];
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
  stemTo: number;
}

export interface ChapterSpan {
  id: string;
  x0: number;
  x1: number;
  label: string;
  status: Chapter["status"];
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
}

export type RunwayHorizonTone = "neutral" | "warn" | "bad";

export interface RunwayGeometry {
  months: number;
  endDay: DayKey;
  /** x of the runway-out date (may be past the horizon). */
  x: number;
  /** Clamped to the horizon for drawing. */
  xDrawn: number;
  y: number;
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
  /** Width of the full ribbon (kick-off → horizon) at this zoom. */
  totalWidth: number;
  totalDays: number;
  kickoff: DayKey;
  today: DayKey;
  horizon: DayKey;
  todayX: number;
  bands: RiverBand[];
  revenue: RevenueGeometry;
  markers: MarkerBucket[];
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
  /** The day under an x position (clamped to kick-off … horizon). */
  dayAt: (x: number) => DayKey;
}

export interface RibbonGeometryInput {
  index: DailyIndex;
  departments: readonly RibbonDepartment[];
  conversions: readonly Conversion[];
  milestones: readonly Milestone[];
  chapters: readonly Chapter[];
  forecast?: readonly ForecastPoint[];
  roadmap?: readonly RoadmapFlag[];
  runwayMonths?: number | null;
  today: DayKey;
  horizonMonths?: number;
  zoom: ZoomLevel;
  width: number;
  height: number;
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

function tickLabel(day: DayKey, zoom: ZoomLevel): string {
  const d = new Date(dayToMs(day));
  const dd = d.getUTCDate();
  const mm = MONTHS_SHORT[d.getUTCMonth()] as string;
  if (zoom === "week") return `${DOW_SHORT[d.getUTCDay()]} ${dd}`;
  if (zoom === "all") return dd === 1 && d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : `${mm} ’${String(d.getUTCFullYear()).slice(2)}`;
  return `${dd} ${mm}`;
}

/** Marker radius: base size per kind (DESIGN §8: dots 4 px, rings 8 px, goal markers 10 px), grown by log count. */
export function markerRadius(kind: ConversionKind, count: number): number {
  const base = kind === "signup" ? 2 : kind === "activation" ? 4 : 5;
  return count <= 1 ? base : Math.min(base * 1.9, base + Math.log2(count) * 0.9);
}

export function buildRibbonGeometry(input: RibbonGeometryInput): RibbonGeometry {
  const { index, departments, zoom, width, height, today } = input;
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

  // River: stacked silhouette of agent hours per department, curveBasis (DESIGN §8).
  const half = Math.max(1e-6, index.maxHours / 2);
  const riverScale = (layout.riverBottom - layout.riverTop) / 2 / half;
  const riverY = (v: number) => layout.riverMid - v * riverScale;
  const stacker = stack<DayPoint, string>()
    .keys(index.departmentIds)
    .value((d, key) => d.hours[key] ?? 0)
    .offset(stackOffsetSilhouette)
    .order(stackOrderInsideOut);
  const series = stacker(index.points);
  const areaGen = area<{ 0: number; 1: number; data: DayPoint }>()
    .x((d) => xOfDay(d.data.day))
    .y0((d) => riverY(d[0]))
    .y1((d) => riverY(d[1]))
    .curve(curveBasis);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const bands: RiverBand[] = series.map((s) => {
    const dept = deptById.get(String(s.key)) as RibbonDepartment;
    return { departmentId: dept.id, name: dept.name, dept: dept.dept, path: areaGen(s as unknown as Array<{ 0: number; 1: number; data: DayPoint }>) ?? "" };
  });

  // Revenue line (7-day mean) in kit-primary, plus the forecast cone on the same scale.
  const forecastPoints = (input.forecast ?? []).filter((f) => f.day > today && f.day <= horizon);
  let revMax = index.maxRevenue7;
  for (const f of forecastPoints) if (f.upsideMinor > revMax) revMax = f.upsideMinor;
  revMax = Math.max(1, revMax);
  const revY = (v: number) => layout.revenueBottom - (v / revMax) * (layout.revenueBottom - layout.revenueTop);
  const revLine = line<DayPoint>()
    .x((d) => xOfDay(d.day))
    .y((d) => revY(d.revenue7))
    .curve(curveMonotoneX);
  const revenuePoints = index.points.filter((p) => p.day <= today);
  const revenue: RevenueGeometry = { path: revenuePoints.length > 1 ? (revLine(revenuePoints) ?? "") : "", max: revMax, y: revY };

  let forecast: ForecastGeometry | null = null;
  if (forecastPoints.length > 1) {
    const lastReal = revenuePoints[revenuePoints.length - 1];
    const seed: ForecastPoint | null = lastReal ? { day: lastReal.day, baseMinor: lastReal.revenue7, upsideMinor: lastReal.revenue7, downsideMinor: lastReal.revenue7 } : null;
    const pts = seed ? [seed, ...forecastPoints] : [...forecastPoints];
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

  // Conversion markers: individual at wide zooms, bucketed by day(s) when days are narrower than 48 px.
  const bucketDays = pxPerDay >= 48 ? 0 : Math.max(1, Math.ceil(12 / pxPerDay));
  const buckets = new Map<string, MarkerBucket>();
  for (const c of input.conversions) {
    const ms = Date.parse(c.occurredAt);
    if (!Number.isFinite(ms)) continue;
    const dayKey = msToDay(ms);
    if (dayKey < kickoff || dayKey > today) continue;
    const dayIdx = Math.floor((dayToMs(dayKey) - kickoffMs) / DAY_MS);
    const y = layout.lanes[c.kind];
    if (bucketDays === 0) {
      buckets.set(c.id, { key: c.id, kind: c.kind, day: dayKey, dayEnd: dayKey, x: xOfMs(ms), y, r: markerRadius(c.kind, 1), count: 1, amountMinor: c.amountMinor, currency: c.currency, ids: [c.id], names: c.entityName ? [c.entityName] : [] });
      continue;
    }
    const b = Math.floor(dayIdx / bucketDays);
    const key = `${c.kind}:${b}`;
    const startDay = msToDay(kickoffMs + b * bucketDays * DAY_MS);
    const endDay = msToDay(kickoffMs + Math.min(totalDays - 1, (b + 1) * bucketDays - 1) * DAY_MS);
    let bucket = buckets.get(key);
    if (!bucket) {
      const x0 = xOfMs(kickoffMs + b * bucketDays * DAY_MS);
      bucket = { key, kind: c.kind, day: startDay, dayEnd: endDay < today ? endDay : today, x: x0 + (bucketDays * pxPerDay) / 2, y, r: 0, count: 0, amountMinor: 0, currency: c.currency, ids: [], names: [] };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.amountMinor += c.amountMinor;
    bucket.ids.push(c.id);
    if (c.entityName && bucket.names.length < 6) bucket.names.push(c.entityName);
  }
  const markers = Array.from(buckets.values());
  for (const m of markers) m.r = markerRadius(m.kind, m.count);
  markers.sort((a, b) => a.x - b.x);

  // Milestones on hairline stems; glyphs that would overlap step down a lane (up to three lanes).
  const sortedMilestones = [...input.milestones].sort((a, b) => a.achievedAt.localeCompare(b.achievedAt));
  const milestones: MilestoneGlyph[] = [];
  const laneLastX = [-Infinity, -Infinity, -Infinity];
  for (const m of sortedMilestones) {
    const ms = Date.parse(m.achievedAt);
    if (!Number.isFinite(ms)) continue;
    const dayKey = msToDay(ms);
    if (dayKey < kickoff || dayKey > horizon) continue;
    const x = xOfDay(dayKey);
    let lane = 0;
    while (lane < 2 && x - (laneLastX[lane] as number) < 16) lane += 1;
    laneLastX[lane] = x;
    const y = layout.revenueTop + 4 + lane * 14;
    milestones.push({ id: m.id ?? `${m.kind}:${m.achievedAt}`, kind: m.kind, glyph: MILESTONE_GLYPH[m.kind], label: m.label, day: dayKey, x, y, stemTo: layout.riverTop });
  }

  // Chapters along the top.
  const chapters: ChapterSpan[] = [];
  for (const ch of input.chapters) {
    if (ch.endsOn < kickoff || ch.startsOn > horizon) continue;
    const start = ch.startsOn < kickoff ? kickoff : ch.startsOn;
    const end = ch.endsOn > horizon ? horizon : ch.endsOn;
    chapters.push({ id: ch.id, x0: xOfDay(start) - pxPerDay / 2, x1: xOfDay(end) + pxPerDay / 2, label: ch.title ?? ch.provisionalTitle, status: ch.status, chapter: ch });
  }

  // Ghosted upcoming roadmap flags.
  const roadmap: RoadmapGlyph[] = (input.roadmap ?? [])
    .filter((f) => f.plannedOn > today && f.plannedOn <= horizon)
    .map((f) => ({ id: f.id, label: f.label, day: f.plannedOn, x: xOfDay(f.plannedOn), y: layout.revenueTop + 4 }));

  // Runway horizon: a 1 px line from Today to the runway-out date along the revenue baseline.
  let runway: RunwayGeometry | null = null;
  if (input.runwayMonths !== null && input.runwayMonths !== undefined && Number.isFinite(input.runwayMonths)) {
    const months = Math.max(0, input.runwayMonths);
    const endDay = addDaysKey(today, Math.round(months * MONTH_DAYS));
    const x = xOfDay(endDay);
    runway = { months, endDay, x, xDrawn: Math.min(x, totalWidth), y: layout.revenueBottom, tone: runwayToneFor(months), label: `Runway · ${months < 10 ? months.toFixed(1).replace(/\.0$/, "") : Math.round(months)} mo` };
  }

  // Axis ticks for the whole domain; the component culls to the visible window.
  const ticks: RibbonTick[] = [];
  const step = zoom === "week" ? 1 : zoom === "month" ? 7 : zoom === "quarter" ? 14 : 0;
  if (step > 0) {
    for (let i = 0; i < totalDays; i += step) {
      const day = msToDay(kickoffMs + i * DAY_MS);
      const d = new Date(dayToMs(day));
      ticks.push({ x: xOfDay(day), label: tickLabel(day, zoom), major: step === 1 ? d.getUTCDay() === 1 : d.getUTCDate() <= step, day });
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
      if (k % everyN === 0 || d.getUTCMonth() === 0) ticks.push({ x: xOfDay(day), label: tickLabel(day, zoom), major: d.getUTCMonth() === 0, day });
      d.setUTCMonth(d.getUTCMonth() + 1);
      k += 1;
    }
  }

  return { zoom, layout, pxPerDay, totalWidth, totalDays, kickoff, today, horizon, todayX, bands, revenue, markers, milestones, chapters, forecast, roadmap, runway, ticks, xOfDay, xOfMs, dayAt };
}

/* ---------- Scrolling helpers ---------- */

/** Clamp a scroll offset so the window stays inside the ribbon. */
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
