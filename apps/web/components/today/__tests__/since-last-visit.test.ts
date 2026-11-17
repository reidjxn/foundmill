import { describe, expect, it } from "vitest";
import { sinceLastVisitLines, streakStripProps } from "../today-view";

const money = (m: { amountMinor: number; currency: string }) => `$${(m.amountMinor / 100).toFixed(2)}`;

describe("sinceLastVisitLines", () => {
  it("says what happened in plain lines, with links and Estimate on spend", () => {
    const lines = sinceLastVisitLines({ since: "2026-11-10T18:42:00Z", rounds: 3, tasksDone: 7, wins: 1, newDecisions: 2, milestones: ["First customer"], spend: { amountMinor: 42, currency: "USD" } }, "b1", money);
    expect(lines.map((l) => l.text)).toEqual(["3 rounds of work, 7 tasks done.", "1 customer won.", "2 new decisions need you.", "Milestone: First customer.", "Team spend $0.42 (Estimate)."]);
    expect(lines.find((l) => l.id === "decisions")?.link?.href).toBe("/b/b1/inbox?tab=respond");
  });

  it("leaves out what did not happen", () => {
    const lines = sinceLastVisitLines({ since: "x", rounds: 0, tasksDone: 0, wins: 0, newDecisions: 1, milestones: [], spend: null }, "b1", money);
    expect(lines.map((l) => l.text)).toEqual(["1 new decision needs you."]);
  });
});

describe("streakStripProps", () => {
  it("labels each dot with its weekday and keeps the shared words", () => {
    const week = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((day, i) => ({ day, state: (i === 6 ? "today" : "visited") as "visited" | "today" }));
    const p = streakStripProps({ current: 6, best: 6, visitedToday: false, atRisk: true, milestone: null, week });
    expect(p).toMatchObject({ headline: "6 days in a row", line: "Open your business today to make it 7 days.", atRisk: true, milestone: false });
    expect(p.week.map((d) => d.label)).toEqual(["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"]);
  });

  it("says how many arrived through the page, in the singular and the plural, and nothing at 0 (WP-12 T3)", () => {
    const base = { since: "x", rounds: 0, tasksDone: 0, wins: 0, newDecisions: 0, milestones: [], spend: null };
    expect(sinceLastVisitLines({ ...base, arrived: 1 }, "b1", money)).toEqual([{ id: "arrived", text: "1 person arrived through your page." }]);
    expect(sinceLastVisitLines({ ...base, arrived: 3 }, "b1", money)).toEqual([{ id: "arrived", text: "3 people arrived through your page." }]);
    expect(sinceLastVisitLines({ ...base, arrived: 0 }, "b1", money)).toEqual([]);
    expect(sinceLastVisitLines(base, "b1", money)).toEqual([]);
    // Never a link, never a name.
    expect(JSON.stringify(sinceLastVisitLines({ ...base, arrived: 2 }, "b1", money))).not.toMatch(/link|href/);
  });
});
