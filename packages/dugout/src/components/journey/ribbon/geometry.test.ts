import { describe, expect, it } from "vitest";
import { generateJourneyFixture, RIBBON_DEPARTMENTS } from "../fixtures";
import { ZOOM_LEVELS } from "../types";
import {
  pinChipWidth,
  pinLaneY,
  placePinChips,
  addDaysKey,
  buildRibbonGeometry,
  chapterName,
  clampScroll,
  dayToMs,
  forecastAt,
  indexDailyRows,
  msToDay,
  niceTicks,
  NO_DEPARTMENT_ID,
  monthYear,
  revealWidth,
  ribbonTickLabel,
  runwayToneFor,
  scrollForToday,
  scrollKeepingDay,
  summariseDay,
  windowTotals,
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

describe("labels in the signed-in person's date format", () => {
  it("axis ticks and the runway month follow the choice (US without one)", () => {
    const dayFirst = { date: "day_first", time: "24h" } as const;
    const iso = { date: "iso", time: "24h" } as const;
    expect(["month", "quarter"].map((z) => ribbonTickLabel("2026-10-07", z as "month"))).toEqual(["Oct 7", "Oct 7"]);
    expect(ribbonTickLabel("2026-10-07", "month", dayFirst)).toBe("7 Oct");
    expect(ribbonTickLabel("2026-10-07", "quarter", iso)).toBe("10-07");
    // Week zoom names no month, so it reads the same in every format.
    expect([undefined, dayFirst, iso].map((p) => ribbonTickLabel("2026-10-07", "week", p))).toEqual(["Wed 7", "Wed 7", "Wed 7"]);
    expect([undefined, dayFirst, iso].map((p) => ribbonTickLabel("2026-10-01", "all", p))).toEqual(["Oct ’26", "Oct ’26", "2026-10"]);
    expect(ribbonTickLabel("2027-01-01", "all", iso)).toBe("2027");
    expect([monthYear("2027-03-14"), monthYear("2027-03-14", iso)]).toEqual(["Mar 2027", "2027-03"]);
  });
  it("buildRibbonGeometry passes the choice to every tick and the runway label", () => {
    const idx = indexDailyRows(small.rows, RIBBON_DEPARTMENTS);
    const input = { index: idx, departments: RIBBON_DEPARTMENTS, conversions: [], milestones: [], chapters: [], runwayMonths: 2, today: small.today, zoom: "month" as const, width: 900, height: 300 };
    const us = buildRibbonGeometry(input);
    const iso = buildRibbonGeometry({ ...input, datePrefs: { date: "iso", time: "24h" } });
    expect(us.ticks.length).toBe(iso.ticks.length);
    expect(us.ticks.every((t) => /^[A-Z][a-z]{2} \d{1,2}$/.test(t.label))).toBe(true);
    expect(iso.ticks.every((t) => /^\d{2}-\d{2}$/.test(t.label))).toBe(true);
    expect(iso.runway?.label).toMatch(/^Cash runs out ~\d{4}-\d{2}$/);
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

  it("reads the API's wire format: the nil uuid is the business row and numeric strings are numbers", () => {
    const wire = [
      { day: "2026-01-01", departmentId: "a", agentHours: "2.500", tasksDone: 1, spendMinor: "100", revenueMinor: "0", signups: 0, activations: 0, payments: 0, decisions: 0 },
      { day: "2026-01-01", departmentId: "a", agentHours: "1.250", tasksDone: 0, spendMinor: "0", revenueMinor: "0", signups: 0, activations: 0, payments: 0, decisions: 0 },
      { day: "2026-01-01", departmentId: NO_DEPARTMENT_ID, agentHours: "0", tasksDone: 0, spendMinor: "0", revenueMinor: "4200", signups: 3, activations: 1, payments: 1, decisions: 0 },
    ] as unknown as Parameters<typeof indexDailyRows>[0];
    const idx = indexDailyRows(wire, [{ id: "a", name: "A", dept: "dept-1" }]);
    expect(idx.points[0]?.hours.a).toBeCloseTo(3.75);
    expect(idx.points[0]?.totalHours).toBeCloseTo(3.75);
    expect(idx.maxHours).toBeCloseTo(3.75);
    expect(idx.points[0]?.revenueMinor).toBe(4200);
    expect(idx.points[0]?.payments).toBe(1);
  });

  it("totals the last 7 days and compares revenue with the 7 before", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ day: addDaysKey("2026-01-01", i), departmentId: null, agentHours: 0, tasksDone: 0, spendMinor: 0, revenueMinor: i < 7 ? 100 : 150, signups: 1, activations: 0, payments: i % 2, decisions: 0 }));
    const idx = indexDailyRows(rows, []);
    const t = windowTotals(idx, "2026-01-14");
    expect(t.revenuePerDay).toBe(150);
    expect(t.revenueChange).toBeCloseTo(0.5);
    expect(t.signups).toBe(7);
    expect(t.payments).toBe(4); // days 7–13, odd ones
    expect(windowTotals(idx, "2026-01-07").revenueChange).toBeNull();
  });
});

describe("labels and scales", () => {
  it("names chapters, picks round gridlines and interpolates the forecast", () => {
    expect(chapterName("2026-Q3")).toBe("Q3 2026");
    expect(chapterName("custom")).toBe("custom");
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(2_870_000)).toEqual([0, 1_000_000, 2_000_000, 3_000_000]);
    expect(niceTicks(4_500)).toEqual([0, 2_000, 4_000, 6_000]);
    const f = [
      { day: "2026-11-15", baseMinor: 100, upsideMinor: 150, downsideMinor: 50 },
      { day: "2026-12-15", baseMinor: 400, upsideMinor: 450, downsideMinor: 350 },
    ];
    expect(forecastAt(f, "2026-11-15")).toEqual(f[0]);
    expect(forecastAt(f, "2026-11-30")).toEqual({ day: "2026-11-30", baseMinor: 250, upsideMinor: 300, downsideMinor: 200 });
    expect(forecastAt(f, "2026-11-01")).toBeNull();
    expect(forecastAt(f, "2027-01-01")).toBeNull();
    expect(forecastAt(undefined, "2026-11-30")).toBeNull();
  });
});

describe("buildRibbonGeometry", () => {
  const index = indexDailyRows(big.rows, RIBBON_DEPARTMENTS, { last: big.today });
  const base = { index, departments: RIBBON_DEPARTMENTS, conversions: big.conversions, milestones: big.milestones, chapters: big.chapters, forecast: big.forecast, roadmap: big.roadmap, runwayMonths: 7.5, today: big.today, width: 1200, height: 300 } as const;

  it("has no revenue scale without revenue, and whole-unit gridlines for a first cent (audit OL-31)", () => {
    const quiet = indexDailyRows(small.rows.map((r) => ({ ...r, revenueMinor: 0, spendMinor: 0 })), RIBBON_DEPARTMENTS);
    const g = buildRibbonGeometry({ ...base, index: quiet, forecast: undefined, zoom: "month" });
    expect(g.revenue.ticks).toEqual([0]);
    expect(g.revenue.max).toBe(1);
    const cent = indexDailyRows(small.rows.map((r, i) => ({ ...r, revenueMinor: i === small.rows.length - 1 ? 1 : 0 })), RIBBON_DEPARTMENTS);
    const c = buildRibbonGeometry({ ...base, index: cent, forecast: undefined, zoom: "month" });
    expect(c.revenue.ticks.every((t) => Number.isInteger(t))).toBe(true);
    expect(new Set(c.revenue.ticks).size).toBe(c.revenue.ticks.length);
  });

  it("builds the revenue line and area on a round scale, the three bar rows, and places Today inside the ribbon", () => {
    const g = buildRibbonGeometry({ ...base, zoom: "quarter" });
    expect(g.revenue.linePath.startsWith("M")).toBe(true);
    expect(g.revenue.areaPath.startsWith("M")).toBe(true);
    expect(g.revenue.ticks[0]).toBe(0);
    expect(g.revenue.max).toBe(g.revenue.ticks[g.revenue.ticks.length - 1]);
    expect(g.revenue.max).toBeGreaterThanOrEqual(index.maxRevenue7);
    expect(g.revenue.y(0)).toBe(g.layout.revenueBottom);
    expect(g.revenue.y(g.revenue.max)).toBe(g.layout.revenueTop);
    for (const kind of ["signups", "payments", "hours"] as const) {
      const t = g.tracks[kind];
      expect(t.bars.length).toBeGreaterThan(0);
      expect(t.bars.every((b) => b.y >= t.top - 0.01 && b.y + b.h <= t.bottom + 0.01)).toBe(true);
      expect(t.bars.every((b) => b.day <= big.today)).toBe(true);
    }
    // The rows stack without overlapping: revenue, signups, paying customers, agent hours, axis.
    const L = g.layout;
    expect(L.revenueBottom).toBeLessThan(L.tracks.signups.top);
    expect(L.tracks.signups.bottom).toBeLessThan(L.tracks.payments.top);
    expect(L.tracks.payments.bottom).toBeLessThan(L.tracks.hours.top);
    expect(L.tracks.hours.bottom).toBeLessThanOrEqual(L.axisTop);
    expect(g.todayX).toBeGreaterThan(0);
    expect(g.todayX).toBeLessThan(g.totalWidth);
    // 730 days of history span 729 day-steps, plus the 6-month horizon, plus the horizon day itself.
    expect(g.totalDays).toBe(729 + Math.round(6 * 30.44) + 1);
    expect(g.pxPerDay).toBeCloseTo(1200 / 91);
    expect(g.dayAt(g.todayX)).toBe(big.today);
    expect(g.xOfDay(big.kickoff)).toBeCloseTo(g.pxPerDay / 2);
  });

  it("draws one bar per day while days are wide enough and one per week when they get narrow, keeping the totals", () => {
    const sum = (kind: "signups" | "payments" | "hours", zoom: "week" | "all") => buildRibbonGeometry({ ...base, zoom }).tracks[kind].bars.reduce((s, b) => s + b.value, 0);
    const history = index.points.filter((p) => p.day <= big.today);
    const week = buildRibbonGeometry({ ...base, zoom: "week" });
    expect(week.tracks.signups.bucketDays).toBe(1);
    expect(week.tracks.signups.bars.every((b) => b.day === b.dayEnd)).toBe(true);
    // Bars are centred on their day, like the axis ticks.
    const bar = week.tracks.signups.bars[week.tracks.signups.bars.length - 1]!;
    expect(bar.x + bar.w / 2).toBeCloseTo(week.xOfDay(bar.day));
    expect(bar.w).toBeLessThanOrEqual(36);
    const all = buildRibbonGeometry({ ...base, zoom: "all" });
    expect(all.tracks.payments.bucketDays).toBe(7);
    expect(all.tracks.payments.bars.length).toBeLessThan(history.length / 5);
    expect(sum("signups", "all")).toBe(history.reduce((s, p) => s + p.signups, 0));
    expect(sum("payments", "week")).toBe(history.reduce((s, p) => s + p.payments, 0));
    expect(sum("hours", "all")).toBeCloseTo(history.reduce((s, p) => s + p.totalHours, 0));
    // Payment bars carry the ids of the payments the API sent for those days.
    const withIds = week.tracks.payments.bars.filter((b) => b.ids.length > 0);
    expect(withIds.length).toBeGreaterThan(0);
    for (const b of withIds) for (const id of b.ids) expect(big.conversions.find((c) => c.id === id)?.occurredAt.slice(0, 10)).toBe(b.day);
  });

  it("maps milestone kinds to glyphs and packs milestones and planned items into rows where no label overlaps", () => {
    for (const zoom of ["quarter", "all"] as const) {
      const g = buildRibbonGeometry({ ...base, zoom });
      if (zoom === "all") expect(new Set(g.milestones.map((m) => m.glyph))).toEqual(new Set(["trophy", "flag", "diamond", "banner"]));
      const pins = [...g.milestones.map((m) => ({ x: m.x, y: m.y, label: m.label, showLabel: m.showLabel })), ...g.roadmap.map((r) => ({ x: r.x, y: r.y, label: r.label, showLabel: r.showLabel }))].sort((a, b) => a.x - b.x);
      expect(new Set(pins.map((p) => p.y)).size).toBeLessThanOrEqual(3);
      for (const a of pins) {
        if (!a.showLabel) continue;
        const end = a.x + 18 + Math.min(a.label.length, 28) * 6.1;
        const blocker = pins.find((b) => b !== a && b.y === a.y && b.x >= a.x && b.x - 6 < end);
        expect(blocker, `${a.label} overlaps a pin in its row`).toBeUndefined();
      }
    }
    const g = buildRibbonGeometry({ ...base, zoom: "quarter" });
    expect(g.milestones.some((m) => m.showLabel)).toBe(true);
    expect(g.roadmap.length).toBe(3);
    expect(g.roadmap.every((r) => r.x > g.todayX)).toBe(true);
  });

  it("builds the forecast cone past Today, the runway horizon and chapter spans", () => {
    const g = buildRibbonGeometry({ ...base, zoom: "quarter" });
    expect(g.forecast?.conePath.startsWith("M")).toBe(true);
    expect(g.forecast?.x1).toBeCloseTo(g.xOfDay(g.horizon));
    expect(g.runway?.tone).toBe("warn");
    expect(g.runway?.x).toBeGreaterThan(g.todayX);
    // 7.5 months is past the 6-month horizon: said in months, not drawn as a date.
    expect(g.runway?.inRange).toBe(false);
    expect(g.runway?.label).toBe("Cash lasts 7.5 months");
    const soon = buildRibbonGeometry({ ...base, zoom: "quarter", runwayMonths: 4 }).runway;
    expect(soon?.inRange).toBe(true);
    expect(soon?.label).toMatch(/^Cash runs out ~[A-Z][a-z]{2} \d{4}$/);
    expect(buildRibbonGeometry({ ...base, zoom: "quarter", runwayMonths: 4 }).runway?.tone).toBe("bad");
    expect(buildRibbonGeometry({ ...base, zoom: "quarter", runwayMonths: null }).runway).toBeNull();
    expect(g.chapters.length).toBe(big.chapters.length);
    expect(g.chapters[0]?.x0).toBeCloseTo(0);
    expect(g.chapters[0]?.name).toMatch(/^Q[1-4] \d{4}$/);
    const current = g.chapters.find((c) => c.status === "current")!;
    expect(current.x0).toBeLessThanOrEqual(g.todayX);
    expect(current.x1).toBeGreaterThanOrEqual(g.todayX);
  });

  it("emits ticks for the whole domain at every zoom", () => {
    expect(buildRibbonGeometry({ ...base, zoom: "week" }).ticks.length).toBe(buildRibbonGeometry({ ...base, zoom: "week" }).totalDays);
    expect(buildRibbonGeometry({ ...base, zoom: "month" }).ticks[0]?.label).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
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
    expect(g.tracks.hours.bars.length).toBeGreaterThan(0);
    expect(g.forecast).toBeNull();
    expect(g.chapters).toEqual([]);
    expect(g.layout.height).toBe(240);
    expect(g.layout.axisTop).toBeLessThan(240);
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
      paths += 2 + g.tracks.signups.bars.length + g.tracks.payments.bars.length + g.tracks.hours.bars.length;
    }
    const elapsed = performance.now() - t0;
    expect(paths).toBeGreaterThan(4 * 100);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("revealWidth", () => {
  it("eases from 0 to the plot width and never goes negative when a frame predates the start", () => {
    expect(revealWidth(1000, 1000, 1200, 800)).toBe(0);
    // requestAnimationFrame hands over the frame's start, which can be before the animation began.
    for (const early of [1, 7, 25, 400]) expect(revealWidth(1000 - early, 1000, 1200, 800)).toBe(0);
    expect(revealWidth(1600, 1000, 1200, 800)).toBe(700);
    expect(revealWidth(2200, 1000, 1200, 800)).toBe(800);
    expect(revealWidth(9000, 1000, 1200, 800)).toBe(800);
    expect(revealWidth(1600, 1000, 1200, -5)).toBe(0);
  });
});

describe("placePinChips", () => {
  const overlaps = (a: { left: number; right: number; y: number }, b: { left: number; right: number; y: number }) => a.y === b.y && a.left < b.right && a.right > b.left;

  it("keeps every chip clear of the Today tag and of each other, flipping, changing lane or dropping the label", () => {
    const plotW = 900;
    // Today's tag sits at 760–880 in lane 0; two planned items just right of it would be flipped back over it.
    const avoid = { left: 760, right: 880, y: pinLaneY(0) };
    const pins = [
      { id: "a", x: 860, y: pinLaneY(0), label: "Workflow (email approvals)" },
      { id: "b", x: 880, y: pinLaneY(1), label: "Xero sync v2 (journals and…" },
      { id: "c", x: 300, y: pinLaneY(0), label: "Release 2.6" },
      { id: "d", x: 310, y: pinLaneY(0), label: "Release 2.7" },
    ];
    const placed = placePinChips(pins, { scrollX: 0, plotW, avoid });
    const rects = [...placed.values()];
    expect(rects).toHaveLength(4);
    for (const r of rects) {
      expect(overlaps(r, avoid)).toBe(false);
      expect(r.right).toBeLessThanOrEqual(plotW);
      for (const o of rects) if (o !== r) expect(overlaps(r, o)).toBe(false);
    }
    // Near the right edge a chip ends at its day instead of crossing the edge.
    expect(placed.get("b")?.anchor).toBe("end");
    // An undisturbed chip keeps its lane, its label and its side.
    expect(placed.get("c")).toMatchObject({ y: pinLaneY(0), label: "Release 2.6", anchor: "start" });
    expect(placed.get("c")?.right).toBeCloseTo(300 - 9 + pinChipWidth("Release 2.6"));
  });

  it("works in window pixels: the same pins scrolled", () => {
    const placed = placePinChips([{ id: "a", x: 1300, y: pinLaneY(0), label: "Launch" }], { scrollX: 1000, plotW: 900 });
    expect(placed.get("a")?.left).toBe(300 - 9);
  });
});
