import { describe, expect, it } from "vitest";
import { countableBrowser, pageVisitsLine, summarizePageVisits } from "./page-visits";

const today = new Date("2026-11-25T12:00:00Z");

describe("page visits", () => {
  it("sums the window: the last 7 days, the whole 28, by source; older rows are left out", () => {
    const s = summarizePageVisits(
      [
        { day: "2026-11-25", source: "search", visits: 3 },
        { day: "2026-11-19", source: "post", visits: 1 },
        { day: "2026-11-18", source: "search", visits: 2 },
        { day: "2026-10-29", source: "direct", visits: 0 },
        { day: "2026-10-28", source: "direct", visits: 4 },
        { day: "2026-10-27", source: "direct", visits: 9 },
      ],
      today,
    );
    expect(s).toMatchObject({ last7: 4, total: 6, bySource: [{ source: "search", visits: 5 }, { source: "post", visits: 1 }] });
    expect(s.daily).toHaveLength(28);
    expect(s.daily[0]).toEqual({ day: "2026-10-29", visits: 0 });
    expect(s.daily[27]).toEqual({ day: "2026-11-25", visits: 3 });
  });

  it("writes the team's line, labeled an estimate", () => {
    expect(pageVisitsLine(summarizePageVisits([], today))).toMatch(/Estimate.*: none in the last 28 days\.$/);
    expect(pageVisitsLine(summarizePageVisits([{ day: "2026-11-25", source: "ai", visits: 2 }], today))).toMatch(/: 2 in the last 7 days, 2 in the last 28 days; by source: AI assistants 2\.$/);
  });

  it("does not count automated browsers or known bots", () => {
    expect(countableBrowser({ userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15" })).toBe(true);
    expect(countableBrowser({ userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15", webdriver: true })).toBe(false);
    for (const ua of ["Googlebot/2.1", "Mozilla/5.0 HeadlessChrome/120", "facebookexternalhit/1.1 Preview", "curl/8.0"]) expect(countableBrowser({ userAgent: ua }), ua).toBe(false);
  });
});
