import { afterEach, describe, expect, it } from "vitest";
import { generateJourneyFixture } from "./fixtures";

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** The figures the landing page's example Journey shows, in one time zone. */
function figuresIn(tz: string) {
  process.env.TZ = tz;
  const data = generateJourneyFixture({ days: 60, today: "2026-10-07", seed: "tz-check" });
  const business = data.rows.filter((r) => r.departmentId === null);
  return { days: business.map((r) => r.day), revenue: business.map((r) => r.revenueMinor), hours: data.rows.map((r) => r.agentHours) };
}

describe("generateJourneyFixture", () => {
  it("shows every visitor the same example business, whatever their time zone (PAS-11)", () => {
    const utc = figuresIn("UTC");
    expect(figuresIn("Asia/Kolkata")).toEqual(utc);
    expect(figuresIn("America/Los_Angeles")).toEqual(utc);
    expect(figuresIn("Pacific/Kiritimati")).toEqual(utc);
  });

  it("dips at the weekend: Saturday and Sunday are the quiet days", () => {
    process.env.TZ = "Asia/Kolkata";
    const data = generateJourneyFixture({ days: 140, today: "2026-10-07", seed: "weekend" });
    const hoursByWeekday = new Map<number, number>();
    for (const r of data.rows) {
      const weekday = new Date(`${r.day}T12:00:00Z`).getUTCDay();
      hoursByWeekday.set(weekday, (hoursByWeekday.get(weekday) ?? 0) + r.agentHours);
    }
    const weekend = ((hoursByWeekday.get(0) ?? 0) + (hoursByWeekday.get(6) ?? 0)) / 2;
    const weekdays = [1, 2, 3, 4, 5].reduce((sum, d) => sum + (hoursByWeekday.get(d) ?? 0), 0) / 5;
    expect(weekend).toBeLessThan(weekdays * 0.8);
  });
});
