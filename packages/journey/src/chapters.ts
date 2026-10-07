/**
 * Chapters (BUILD §11.2 "Chapters: one per quarter, titled by Opus"). One chapter per calendar quarter from kick-off to
 * the current quarter, plus `horizonQuarters` future ones for the forecast horizon. Titles are null until the composer's
 * `/v1/chapter-title` fills them; `provisionalTitle` is a deterministic placeholder from the quarter's facts.
 */
import { dayKeyUtc, daysBetween, quarterEnd, quarterOf, quarterStart } from "./time";
import { Chapter, type ChapterStatus, type ChapterSummary, type DayKey, type JourneyDailyRow, type Milestone } from "./types";

export interface BuildChaptersInput {
  /** Kick-off day. */
  startDay: DayKey;
  /** The current day (Today line). */
  today: DayKey;
  /** Future quarters to include for the forecast horizon (default 2). */
  horizonQuarters?: number;
  daily?: readonly JourneyDailyRow[];
  milestones?: readonly Milestone[];
  /** Opus titles by chapter id ("2025-Q3"). */
  titles?: Record<string, string>;
}

export const chapterIdFor = (day: DayKey): string => {
  const { year, quarter } = quarterOf(day);
  return `${year}-Q${quarter}`;
};

export function buildChapters(input: BuildChaptersInput): Chapter[] {
  const horizon = input.horizonQuarters ?? 2;
  const start = quarterOf(input.startDay);
  const now = quarterOf(input.today);
  const summaries = summariseByQuarter(input.daily ?? [], input.milestones ?? []);
  const chapters: Chapter[] = [];
  let year = start.year;
  let quarter: number = start.quarter;
  let index = 0;
  let future = 0;
  // Walk quarters from kick-off to the current one, then `horizon` more.
  for (;;) {
    const id = `${year}-Q${quarter}`;
    const isPast = year < now.year || (year === now.year && quarter < now.quarter);
    const isCurrent = year === now.year && quarter === now.quarter;
    const status: ChapterStatus = isPast ? "past" : isCurrent ? "current" : "future";
    if (status === "future") future += 1;
    const summary = summaries.get(id) ?? emptySummary();
    const startsOn = quarterStart(year, quarter);
    const endsOn = quarterEnd(year, quarter);
    summary.days = status === "future" ? 0 : Math.max(0, daysBetween(startsOn, status === "current" ? input.today : endsOn) + 1);
    const previous = chapters[chapters.length - 1];
    chapters.push(
      Chapter.parse({
        id, index, year, quarter, startsOn, endsOn, status,
        title: input.titles?.[id] ?? null,
        provisionalTitle: provisionalChapterTitle({ index, status, summary, previous: previous?.summary ?? null }),
        summary,
      }),
    );
    // Stop once the current quarter is in and `horizon` future ones follow it (horizon 0 ends on the current quarter).
    if (status !== "past" && future >= horizon) break;
    index += 1;
    quarter += 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
    if (index > 400) throw new RangeError("buildChapters: more than 100 years of chapters");
  }
  return chapters;
}

function emptySummary(): ChapterSummary {
  return { days: 0, agentHours: 0, tasksDone: 0, spendMinor: 0, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0, milestoneLabels: [] };
}

function summariseByQuarter(daily: readonly JourneyDailyRow[], milestones: readonly Milestone[]): Map<string, ChapterSummary> {
  const out = new Map<string, ChapterSummary>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = emptySummary()));
    return s;
  };
  for (const r of daily) {
    const s = get(chapterIdFor(r.day));
    s.agentHours += r.agentHours;
    s.tasksDone += r.tasksDone;
    s.spendMinor += r.spendMinor;
    s.revenueMinor += r.revenueMinor;
    s.signups += r.signups;
    s.activations += r.activations;
    s.payments += r.payments;
    s.decisions += r.decisions;
  }
  for (const m of [...milestones].sort((a, b) => Date.parse(a.achievedAt) - Date.parse(b.achievedAt) || a.label.localeCompare(b.label))) {
    get(chapterIdFor(dayKeyUtc(m.achievedAt))).milestoneLabels.push(m.label);
  }
  for (const s of out.values()) s.agentHours = Math.round(s.agentHours * 1000) / 1000;
  return out;
}

/** A deterministic placeholder title from the quarter's facts; the Opus title replaces it. */
export function provisionalChapterTitle(input: { index: number; status: ChapterStatus; summary: ChapterSummary; previous: ChapterSummary | null }): string {
  const { index, status, summary: s, previous: p } = input;
  if (status === "future") return "Next season";
  if (index === 0) return "Kick-off";
  if (s.payments > 0 && (p === null || p.payments === 0)) return "First paying customers";
  if (s.milestoneLabels.some((l) => /customer/i.test(l))) return "Milestones";
  if (p && p.revenueMinor > 0 && s.revenueMinor >= p.revenueMinor * 1.5) return "Growth";
  if (p && p.revenueMinor > 0 && s.revenueMinor < p.revenueMinor * 0.85) return "A tough quarter";
  if (s.signups > 0 && (p === null || s.signups >= p.signups * 1.3)) return "Building momentum";
  if (status === "current") return "This season";
  return "Steady season";
}
