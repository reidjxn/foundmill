/**
 * Pure helpers for the Roadmap tab (BUILD §11.5): grouping by horizon, the upsert payload for a move between columns,
 * dependency lookups and the timeline scale. Kept free of React so the tests pin the behaviour directly.
 */
import { ROADMAP_HORIZONS, type RoadmapHorizon } from "@foundmill/shared";
import type { RoadmapResponse, RoadmapRow } from "../types";
import { draftFrom, upsertInput } from "./ItemDialog";

export type Columns = Record<RoadmapHorizon, RoadmapRow[]>;

/** Items per horizon, in board order (position, then title). */
export function groupByHorizon(items: readonly RoadmapRow[]): Columns {
  const out: Columns = { now: [], next: [], later: [] };
  for (const it of items.slice().sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))) out[it.horizon].push(it);
  return out;
}

/** The `product.roadmap.upsert` input that moves an item to another column (status untouched: it is computed). */
export function moveInput(item: RoadmapRow, horizon: RoadmapHorizon, position: number): Record<string, unknown> {
  return { ...upsertInput(draftFrom(item)), horizon, position };
}

/** The horizon one step left or right of `h`, or null at the edge. */
export function adjacentHorizon(h: RoadmapHorizon, dir: -1 | 1): RoadmapHorizon | null {
  const i = ROADMAP_HORIZONS.indexOf(h);
  return ROADMAP_HORIZONS[i + dir] ?? null;
}

export interface DependencyIndex {
  /** Items this one depends on (must land first). */
  after: Map<string, string[]>;
  /** Items that depend on this one. */
  before: Map<string, string[]>;
}

/** Dependencies arrive as `{fromItem, toItem}` (repos.product) or `{fromId, toId}`; `from` must land before `to`. */
export function indexDependencies(deps: RoadmapResponse["dependencies"] | undefined): DependencyIndex {
  const after = new Map<string, string[]>();
  const before = new Map<string, string[]>();
  for (const d of deps ?? []) {
    const from = d.fromItem ?? d.fromId;
    const to = d.toItem ?? d.toId;
    if (!from || !to) continue;
    after.set(to, [...(after.get(to) ?? []), from]);
    before.set(from, [...(before.get(from) ?? []), to]);
  }
  return { after, before };
}

/* ---------- Timeline scale ---------- */

export const DAY_MS = 86_400_000;

export interface TimelineScale {
  /** Inclusive day range shown. */
  start: Date;
  end: Date;
  days: number;
  /** Month ticks as `{ at, label }` where `at` is 0..1 along the axis. */
  ticks: { at: number; label: string }[];
  /** 0..1 position of `today`, or null when outside the range. */
  today: number | null;
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The axis for the scheduled items: from the earliest start to the latest end, padded a week each side, never shorter than 8 weeks. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function timelineScale(items: readonly RoadmapRow[], today: Date = new Date()): TimelineScale {
  const starts = items.map((i) => parseDay(i.targetStart)).filter((d): d is Date => d !== null);
  const ends = items.map((i) => parseDay(i.targetEnd)).filter((d): d is Date => d !== null);
  const t = utcDay(today);
  let start = new Date(Math.min(t.getTime(), ...starts.map((d) => d.getTime()), ...ends.map((d) => d.getTime())));
  let end = new Date(Math.max(t.getTime(), ...starts.map((d) => d.getTime()), ...ends.map((d) => d.getTime())));
  start = new Date(start.getTime() - 7 * DAY_MS);
  end = new Date(end.getTime() + 7 * DAY_MS);
  if (end.getTime() - start.getTime() < 56 * DAY_MS) end = new Date(start.getTime() + 56 * DAY_MS);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  const ticks: TimelineScale["ticks"] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  while (cursor.getTime() <= end.getTime()) {
    // Fixed three-letter months ("Sep", never "Sept"): some ICU builds print a four-letter short month for September.
    const month = MONTHS[cursor.getUTCMonth()]!;
    ticks.push({ at: (cursor.getTime() - start.getTime()) / (days * DAY_MS), label: cursor.getUTCMonth() === 0 ? `${month} ${cursor.getUTCFullYear()}` : month });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const todayAt = (t.getTime() - start.getTime()) / (days * DAY_MS);
  return { start, end, days, ticks, today: todayAt >= 0 && todayAt <= 1 ? todayAt : null };
}

/** Left and width (0..1) of an item's bar; items with one date get a one-week bar; undated items return null. */
export function barSpan(item: Pick<RoadmapRow, "targetStart" | "targetEnd">, scale: TimelineScale): { left: number; width: number } | null {
  const s = parseDay(item.targetStart);
  const e = parseDay(item.targetEnd);
  if (!s && !e) return null;
  const from = s ?? new Date((e as Date).getTime() - 7 * DAY_MS);
  const to = e ?? new Date((s as Date).getTime() + 7 * DAY_MS);
  const total = scale.days * DAY_MS;
  const left = Math.max(0, (from.getTime() - scale.start.getTime()) / total);
  const right = Math.min(1, (to.getTime() + DAY_MS - scale.start.getTime()) / total);
  return { left, width: Math.max(0.005, right - left) };
}
