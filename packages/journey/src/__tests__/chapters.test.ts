import { describe, expect, it } from "vitest";
import { buildChapters, chapterIdFor, provisionalChapterTitle } from "../chapters";
import { emptyDailyRow } from "../daily";
import { Chapter, type JourneyDailyRow, type Milestone } from "../types";

const row = (day: string, over: Partial<JourneyDailyRow>): JourneyDailyRow => ({ ...emptyDailyRow(day, null), ...over });

describe("chapters — one per quarter", () => {
  it("walks from the kick-off quarter to the current one plus the forecast horizon", () => {
    const chapters = buildChapters({ startDay: "2024-01-15", today: "2025-10-06" });
    expect(chapters.map((c) => c.id)).toEqual(["2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"]);
    expect(chapters.map((c) => c.status)).toEqual(["past", "past", "past", "past", "past", "past", "past", "current", "future", "future"]);
    expect(chapters.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(chapters[0]).toMatchObject({ year: 2024, quarter: 1, startsOn: "2024-01-01", endsOn: "2024-03-31", title: null, provisionalTitle: "Kick-off" });
    expect(chapters[0]!.summary.days).toBe(91);
    expect(chapters[7]!.summary.days).toBe(6); // 1–6 October inclusive
    expect(chapters[8]!.summary.days).toBe(0);
    expect(chapters[9]!.provisionalTitle).toBe("Next season");
    expect(chapters[3]).toMatchObject({ startsOn: "2024-10-01", endsOn: "2024-12-31" });
    for (const c of chapters) expect(Chapter.parse(c)).toEqual(c);
  });

  it("respects the horizon and a same-quarter start", () => {
    expect(buildChapters({ startDay: "2025-10-01", today: "2025-10-06", horizonQuarters: 0 }).map((c) => c.id)).toEqual(["2025-Q4"]);
    expect(buildChapters({ startDay: "2025-10-01", today: "2025-10-06", horizonQuarters: 3 }).map((c) => c.id)).toEqual(["2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"]);
  });

  it("summarises daily rows and milestones per quarter and takes Opus titles when given", () => {
    const daily = [
      row("2025-01-10", { agentHours: 4.5, tasksDone: 2, spendMinor: 100, signups: 3 }),
      row("2025-03-31", { agentHours: 1.25, revenueMinor: 5_000, payments: 1, decisions: 2 }),
      row("2025-04-01", { agentHours: 2, signups: 5, activations: 2 }),
    ];
    const milestones: Milestone[] = [
      { kind: "customer", label: "First customer", achievedAt: "2025-03-31T12:00:00.000Z", ref: null, visibility: "private", trophyKey: "customer_1" },
      { kind: "launch", label: "Public launch", achievedAt: "2025-02-01T12:00:00.000Z", ref: null, visibility: "private", trophyKey: null },
      { kind: "release", label: "Release 1.1", achievedAt: "2025-05-01T12:00:00.000Z", ref: null, visibility: "private", trophyKey: null },
    ];
    const chapters = buildChapters({ startDay: "2024-10-01", today: "2025-05-15", daily, milestones, titles: { "2025-Q1": "The first goal" }, horizonQuarters: 0 });
    expect(chapters.map((c) => c.id)).toEqual(["2024-Q4", "2025-Q1", "2025-Q2"]);
    expect(chapters[0]!.summary.days).toBe(92);
    expect(chapters[0]!.provisionalTitle).toBe("Kick-off");
    expect(chapters[1]!.title).toBe("The first goal");
    expect(chapters[1]!.summary).toEqual({ days: 90, agentHours: 5.75, tasksDone: 2, spendMinor: 100, revenueMinor: 5_000, signups: 3, activations: 0, payments: 1, decisions: 2, milestoneLabels: ["Public launch", "First customer"] });
    expect(chapters[1]!.provisionalTitle).toBe("First paying customers");
    expect(chapters[2]!.title).toBeNull();
    expect(chapters[2]!.status).toBe("current");
    expect(chapters[2]!.summary).toMatchObject({ days: 45, agentHours: 2, signups: 5, activations: 2, milestoneLabels: ["Release 1.1"] });
  });

  it("provisional titles follow the quarter's facts", () => {
    const s = (over: Partial<Chapter["summary"]>): Chapter["summary"] => ({ days: 90, agentHours: 0, tasksDone: 0, spendMinor: 0, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0, milestoneLabels: [], ...over });
    expect(provisionalChapterTitle({ index: 0, status: "past", summary: s({}), previous: null })).toBe("Kick-off");
    expect(provisionalChapterTitle({ index: 1, status: "past", summary: s({ payments: 2 }), previous: s({}) })).toBe("First paying customers");
    expect(provisionalChapterTitle({ index: 2, status: "past", summary: s({ payments: 2, milestoneLabels: ["100th customer"] }), previous: s({ payments: 1 }) })).toBe("Milestones");
    expect(provisionalChapterTitle({ index: 2, status: "past", summary: s({ payments: 2, revenueMinor: 200 }), previous: s({ payments: 1, revenueMinor: 100 }) })).toBe("Growth");
    expect(provisionalChapterTitle({ index: 2, status: "past", summary: s({ payments: 2, revenueMinor: 50 }), previous: s({ payments: 1, revenueMinor: 100 }) })).toBe("A tough quarter");
    expect(provisionalChapterTitle({ index: 2, status: "past", summary: s({ signups: 20 }), previous: s({ signups: 10 }) })).toBe("Building momentum");
    expect(provisionalChapterTitle({ index: 2, status: "current", summary: s({ signups: 10 }), previous: s({ signups: 10 }) })).toBe("This season");
    expect(provisionalChapterTitle({ index: 2, status: "past", summary: s({ signups: 10 }), previous: s({ signups: 10 }) })).toBe("Steady season");
    expect(provisionalChapterTitle({ index: 5, status: "future", summary: s({}), previous: null })).toBe("Next season");
  });

  it("chapterIdFor maps a day to its quarter", () => {
    expect(chapterIdFor("2025-01-01")).toBe("2025-Q1");
    expect(chapterIdFor("2025-03-31")).toBe("2025-Q1");
    expect(chapterIdFor("2025-04-01")).toBe("2025-Q2");
    expect(chapterIdFor("2025-12-31")).toBe("2025-Q4");
  });
});
