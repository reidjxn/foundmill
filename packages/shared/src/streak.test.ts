import { describe, expect, it } from "vitest";
import { dailyStreak, streakWords, vacationDayKeys } from "./streak";
import { usSpelling } from "./us-spelling";

const facts = (visitDays: string[], vacationDays: string[] = [], today = "2026-11-12") => ({ today, visitDays, vacationDays });

describe("dailyStreak", () => {
  it("counts days in a row ending today", () => {
    const s = dailyStreak(facts(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-12"]));
    expect(s).toMatchObject({ current: 3, best: 3, visitedToday: true, atRisk: false, milestone: 3 });
  });
  it("keeps yesterday's streak alive this morning, at risk", () => {
    expect(dailyStreak(facts(["2026-11-10", "2026-11-11"]))).toMatchObject({ current: 2, visitedToday: false, atRisk: true, milestone: null });
  });
  it("breaks on a missed day, and remembers the best", () => {
    expect(dailyStreak(facts(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-10", "2026-11-12"]))).toMatchObject({ current: 1, best: 4 });
    expect(dailyStreak(facts([]))).toMatchObject({ current: 0, best: 0, atRisk: false });
  });
  it("freezes over vacation days: they neither break nor add", () => {
    expect(dailyStreak(facts(["2026-11-07", "2026-11-08", "2026-11-12"], ["2026-11-09", "2026-11-10", "2026-11-11"]))).toMatchObject({ current: 3, best: 3 });
  });
  it("draws the last seven days, oldest first", () => {
    const s = dailyStreak(facts(["2026-11-11"], ["2026-11-09"]));
    expect(s.week.map((d) => d.state)).toEqual(["missed", "missed", "missed", "vacation", "missed", "visited", "today"]);
    expect(s.week[0]!.day).toBe("2026-11-06");
  });
});

describe("streakWords", () => {
  it("says what to do, in US English", () => {
    const cases = [dailyStreak(facts([])), dailyStreak(facts(["2026-11-11"])), dailyStreak(facts(["2026-11-10", "2026-11-11", "2026-11-12"])), dailyStreak(facts(["2026-11-12"]))];
    expect(streakWords(cases[1]!)).toEqual({ headline: "1 day in a row", line: "Open your business today to make it 2 days." });
    expect(streakWords(cases[2]!).line).toBe("You reached 3 days today. Your best yet.");
    for (const c of cases) {
      const w = streakWords(c);
      expect(usSpelling(`${w.headline} ${w.line}`)).toBe(`${w.headline} ${w.line}`);
    }
  });
});

describe("vacationDayKeys", () => {
  it("lists every day of a vacation, an open one up to now", () => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date("2026-11-12T12:00:00Z");
    expect(vacationDayKeys([{ startedAt: new Date("2026-11-09T08:00:00Z"), endedAt: new Date("2026-11-10T20:00:00Z"), untilAt: null }], now, day)).toEqual(["2026-11-09", "2026-11-10"]);
    expect(vacationDayKeys([{ startedAt: new Date("2026-11-11T08:00:00Z"), endedAt: null, untilAt: null }], now, day)).toEqual(["2026-11-11", "2026-11-12"]);
  });
});
