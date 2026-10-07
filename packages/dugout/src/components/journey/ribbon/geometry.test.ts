import { describe, expect, it } from "vitest";
import { generateJourneyFixture, RIBBON_DEPARTMENTS } from "../fixtures";
import { ZOOM_LEVELS } from "../types";
import {
  addDaysKey,
  buildRibbonGeometry,
  clampScroll,
  dayToMs,
  indexDailyRows,
  markerRadius,
  msToDay,
  runwayToneFor,
  scrollForToday,
  scrollKeepingDay,
  summariseDay,
  zoomSpanDays,
} from "./geometry";

const big = generateJourneyFixture({ days: 730 });
const small = generateJourneyFixture({ days: 60, seed: "small" });

describe("dates", () => {
  it("round-trips day keys in UTC", () => {
    expect(msToDay(dayToMs("2026-10-07"))).toBe("2026-10-07");
    expect(addDaysKey("2026-02-27", 3)).toBe("2026-03-02");
    expect(runwayToneFor(12)).toBe("neutral");
    expect(runwayToneFor(8.9)).toBe("warn");
    expect(runwayToneFor(5.9)).toBe("bad");
    expect(zoomSpanDays("week", 900)).toBe(7);
    expect(zoomSpanDays("all", 900)).toBe(900);
  });
});

describe("indexDailyRows", () => {
  it("folds department and business rows into one point per day, filling gaps", () => {
    const rows = [
      { day: "2026-01-01", departmentId: "a", agentHours: 2, tasksDone: 1, spendMinor: 100, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0 },
      { day: "2026-01-01", departmentId: null, agentHours: 2, tasksDone: 1, spendMinor: 100, revenueMinor: 500, signups: 3, activations: 1, payments: 1, decisions: 0 },
      { day: "2026-01-03", departmentId: "b", agentHours: 4, tasksDone: 2, spendMinor: 50, revenueMinor: 700, signups: 2, activations: 0, payments: 0, decisions: 1 },
    ];
    const idx = indexDailyRows(rows, [
      { id: "a", name: "A", dept: "dept-1" },
      { id: "b", name: "B", dept: "dept-2" },
    ]);
    expect(idx.points.map((p) => p.day)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(idx.points[0]?.hours).toEqual({ a: 2, b: 0 });
    expect(idx.points[0]?.signups).toBe(3);
    // No business row on the 3rd: department rows are summed instead.
    expect(idx.points[2]?.revenueMinor).toBe(700);
    expect(idx.points[2]?.decisions).toBe(1);
    expect(idx.points[1]?.totalHours).toBe(0);
    expect(idx.maxHours).toBe(4);
    expect(idx.points[2]?.revenue7).toBeCloseTo((500 + 0 + 700) / 3);
  });
});

describe("buildRibbonGeometry", () => {
  const index = indexDailyRows(big.rows, RIBBON_DEPARTMENTS, { last: big.today });
  const base = { index, departments: RIBBON_DEPARTMENTS, conversions: big.conversions, milestones: big.milestones, chapters: big.chapters, forecast: big.forecast, roadmap: big.roadmap, runwayMonths: 7.5, today: big.today, width: 1200, height: 300 } as const;

  it("builds one band per department and a revenue path, and places Today inside the ribbon", () => {
    const g = buildRibbonGeometry({ ...base, zoom: "quarter" });
    expect(g.bands.map((b) => b.departmentId)).toEqual(expect.arrayContaining(RIBBON_DEPARTMENTS.map((d) => d.id)));
    expect(g.bands.every((b) => b.path.startsWith("M"))).toBe(true);
    expect(g.revenue.path.startsWith("M")).toBe(true);
    expect(g.todayX).toBeGreaterThan(0);
    expect(g.todayX).toBeLessThan(g.totalWidth);
    // 730 days of history span 729 day-steps, plus the 6-month horizon, plus the horizon day itself.
    expect(g.totalDays).toBe(729 + Math.round(6 * 30.44) + 1);
    expect(g.pxPerDay).toBeCloseTo(1200 / 91);
    expect(g.dayAt(g.todayX)).toBe(big.today);
    expect(g.xOfDay(big.kickoff)).toBeCloseTo(g.pxPerDay / 2);
  });

  it("keeps individual markers at the week zoom and buckets them when days get narrow", () => {
    const week = buildRibbonGeometry({ ...base, zoom: "week" });
    expect(week.markers.every((m) => m.count === 1)).toBe(true);
    expect(week.markers.length).toBe(big.conversions.length);
    const all = buildRibbonGeometry({ ...base, zoom: "all" });
    expect(all.markers.length).toBeLessThan(big.conversions.length / 3);
    expect(all.markers.some((m) => m.count > 1)).toBe(true);
    const totalCount = all.markers.reduce((s, m) => s + m.count, 0);
    expect(totalCount).toBe(big.conversions.length);
    const paid = all.markers.filter((m) => m.kind === "payment");
    expect(paid.reduce((s, m) => s + m.amountMinor, 0)).toBe(big.conversions.filter((c) => c.kind === "payment").reduce((s, c) => s + c.amountMinor, 0));
    expect(markerRadius("payment", 1)).toBe(5);
    expect(markerRadius("signup", 1)).toBe(2);
    expect(markerRadius("signup", 64)).toBeGreaterThan(2);
    expect(markerRadius("signup", 1e6)).toBeLessThanOrEqual(2 * 1.9);
  });

  it("maps milestone kinds to glyphs, staggers overlapping glyphs and ghosts future roadmap flags", () => {
    const g = buildRibbonGeometry({ ...base, zoom: "all" });
    const kinds = new Set(g.milestones.map((m) => m.glyph));
    expect(kinds).toEqual(new Set(["trophy", "flag", "diamond", "banner"]));
    const lanes = new Set(g.milestones.map((m) => m.y));
    expect(lanes.size).toBeGreaterThan(1);
    for (let i = 1; i < g.milestones.length; i++) {
      const a = g.milestones[i - 1]!;
      const b = g.milestones[i]!;
      if (b.x - a.x < 16) expect(b.y).not.toBe(a.y);
    }
    expect(g.roadmap.length).toBe(3);
    expect(g.roadmap.every((r) => r.x > g.todayX)).toBe(true);
  });

  it("builds the forecast cone past Today, the runway horizon and chapter spans", () => {
    const g = buildRibbonGeometry({ ...base, zoom: "quarter" });
    expect(g.forecast?.conePath.startsWith("M")).toBe(true);
    expect(g.forecast?.x1).toBeCloseTo(g.xOfDay(g.horizon));
    expect(g.runway?.tone).toBe("warn");
    expect(g.runway?.x).toBeGreaterThan(g.todayX);
    expect(g.runway?.label).toBe("Runway · 7.5 mo");
    expect(buildRibbonGeometry({ ...base, zoom: "quarter", runwayMonths: 4 }).runway?.tone).toBe("bad");
    expect(buildRibbonGeometry({ ...base, zoom: "quarter", runwayMonths: null }).runway).toBeNull();
    expect(g.chapters.length).toBe(big.chapters.length);
    expect(g.chapters[0]?.x0).toBeCloseTo(0);
    const current = g.chapters.find((c) => c.status === "current")!;
    expect(current.x0).toBeLessThanOrEqual(g.todayX);
    expect(current.x1).toBeGreaterThanOrEqual(g.todayX);
  });

  it("emits ticks for the whole domain at every zoom", () => {
    expect(buildRibbonGeometry({ ...base, zoom: "week" }).ticks.length).toBe(buildRibbonGeometry({ ...base, zoom: "week" }).totalDays);
    expect(buildRibbonGeometry({ ...base, zoom: "month" }).ticks[0]?.label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
    const all = buildRibbonGeometry({ ...base, zoom: "all" });
    expect(all.ticks.length).toBeGreaterThan(10);
    expect(all.ticks.some((t) => t.major)).toBe(true);
  });

  it("scroll helpers clamp and keep the anchored day", () => {
    const q = buildRibbonGeometry({ ...base, zoom: "quarter" });
    expect(clampScroll(-10, q.totalWidth, 1200)).toBe(0);
    expect(clampScroll(1e9, q.totalWidth, 1200)).toBeCloseTo(q.totalWidth - 1200);
    const s = scrollForToday(q, 1200);
    expect(q.todayX - s).toBeCloseTo(1200 * 0.7);
    const m = buildRibbonGeometry({ ...base, zoom: "month" });
    const centre = q.dayAt(s + 600);
    const s2 = scrollKeepingDay(centre, 0.5, m, 1200);
    expect(m.dayAt(s2 + 600)).toBe(centre);
  });

  it("summarises a day for the hover card", () => {
    const g = buildRibbonGeometry({ ...base, zoom: "quarter" });
    const s = summariseDay(big.today, { index, departments: RIBBON_DEPARTMENTS, conversions: big.conversions, milestones: big.milestones, chapters: big.chapters, today: big.today });
    expect(s.isToday).toBe(true);
    expect(s.chapter?.status).toBe("current");
    expect(s.departments[0]!.hours).toBeGreaterThanOrEqual(s.departments[1]!.hours);
    const future = summariseDay(g.horizon, { index, departments: RIBBON_DEPARTMENTS, conversions: big.conversions, milestones: big.milestones, chapters: big.chapters, today: big.today });
    expect(future.isFuture).toBe(true);
    expect(future.point).toBeNull();
  });

  it("works with a short history (no chapters, no forecast)", () => {
    const idx = indexDailyRows(small.rows, RIBBON_DEPARTMENTS);
    const g = buildRibbonGeometry({ index: idx, departments: RIBBON_DEPARTMENTS, conversions: small.conversions, milestones: small.milestones, chapters: [], today: small.today, zoom: "week", width: 800, height: 240 });
    expect(g.bands.length).toBe(RIBBON_DEPARTMENTS.length);
    expect(g.forecast).toBeNull();
    expect(g.chapters).toEqual([]);
    expect(g.layout.height).toBe(240);
    expect(g.layout.riverBottom).toBeLessThan(240);
  });
});

describe("performance (AC-11.2.1)", () => {
  it("indexes and builds geometry for 730 days × 6 departments at all four zooms in under 2 s", () => {
    expect(big.rows.length).toBe(730 * (RIBBON_DEPARTMENTS.length + 1));
    const t0 = performance.now();
    const index = indexDailyRows(big.rows, RIBBON_DEPARTMENTS, { last: big.today });
    let paths = 0;
    for (const zoom of ZOOM_LEVELS) {
      const g = buildRibbonGeometry({ index, departments: RIBBON_DEPARTMENTS, conversions: big.conversions, milestones: big.milestones, chapters: big.chapters, forecast: big.forecast, roadmap: big.roadmap, runwayMonths: 11, today: big.today, zoom, width: 1440, height: 300 });
      paths += g.bands.length + 1 + g.markers.length;
    }
    const elapsed = performance.now() - t0;
    expect(paths).toBeGreaterThan(RIBBON_DEPARTMENTS.length * 4);
    expect(elapsed).toBeLessThan(2000);
  });
});
