/** Pure helpers behind the widgets. */
import { describe, expect, it } from "vitest";
import { readWidgetEvent } from "../data";
import { addDays, dailySeries, daysUntil, lastDays, weekKey } from "../shared/time";
import { agentRating20, agentRows, pickAgent, starsFromRating20 } from "../widgets/agent-of-the-week";
import { buildFormRows, formCells } from "../widgets/channel-form-guide";
import { forecastSeries, runwayTileProps, runwayTone } from "../widgets/cash-runway";
import { pickCommunity, postPreview, postsToTimeline } from "../widgets/community-feed";
import { funnelStages } from "../widgets/funnel";
import { previewLine } from "../widgets/inbox-preview";
import { forecastCone, journeyHref, rippleFor, roadmapFlags } from "../widgets/journey-ribbon";
import { pickBoard, windowRows } from "../widgets/league-table";
import { describeEvent } from "../widgets/live-feed";
import { customersPerWeek, monthLabel, revenueBars, weekLines, weeksFrom } from "../widgets/revenue-customers";
import { formatDate } from "@foundmill/dugout";
import { groupByHorizon, roadmapStatus, taskProgress } from "../widgets/roadmap-timeline";
import { dayHourIn } from "@foundmill/shared/time-zone";
import { sessionsToPulseCells, type SessionRow } from "../widgets/squad-pulse";
import { PLAIN_LINES, boardWords, runwayTile, squadHealth, statusTiles, teamHealthCaption } from "../widgets/status-strip";
import { METRIC_PLAIN, headlineMetric } from "../widgets/department-card";
import { teamHealth, teamHealthCounts, teamHealthSummary } from "../shared/health";
import { milestoneKey, trophyCards } from "../widgets/trophy-cabinet";
import { monthRevenueMinor } from "../shared/cash";
import { humanSender, NETWORK_SENDER } from "../shared/note-tags";
import { moduleHref, moduleTabLabel } from "../shared/departments";
import { routes } from "../shared/routes";
import { BID, TODAY, channelMetrics, channels, departments, finance, leaderboardEntries, leaderboards, ribbon, roadmap, sessions, team } from "./fixtures";

describe("readWidgetEvent", () => {
  it("accepts the envelope, the { ch, e } frame and the relay triple; rejects noise", () => {
    expect(readWidgetEvent({ type: "task.started", payload: { taskId: "t" } })).toMatchObject({ type: "task.started", payload: { taskId: "t" } });
    expect(readWidgetEvent({ ch: "ev:x", e: { type: "task.started", payload: {} } })?.type).toBe("task.started");
    expect(readWidgetEvent({ id: "1-0", type: "payment.received", json: JSON.stringify({ type: "payment.received", payload: { amount: { amountMinor: 1 } } }) })?.payload).toEqual({ amount: { amountMinor: 1 } });
    expect(readWidgetEvent({ t: "pong" })).toBeNull();
    expect(readWidgetEvent({ kind: "stdout" })).toBeNull();
    expect(readWidgetEvent("x")).toBeNull();
    expect(readWidgetEvent({ type: "task.started", occurredAt: new Date("2026-10-07T00:00:00Z") })?.occurredAt).toBe("2026-10-07T00:00:00.000Z");
  });
});

describe("time helpers", () => {
  it("builds day keys, week keys and dense series", () => {
    expect(lastDays(3, "2026-10-07")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekKey("2026-01-01")).toBe("2026-W01");
    expect(weekKey("2027-01-01")).toBe("2026-W53");
    expect(dailySeries([{ day: "2026-10-06", v: 2 }, { day: "2026-10-06", v: 3 }], ["2026-10-05", "2026-10-06"], (r) => r.v)).toEqual([0, 5]);
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(new Date(Date.now() + 2.5 * 86_400_000).toISOString())).toBe(3);
  });
});

describe("journey ribbon helpers", () => {
  it("maps live events to ripples", () => {
    expect(rippleFor({ type: "payment.received", payload: { amount: { amountMinor: 4900 } } })).toEqual({ kind: "payment", amountMinor: 4900 });
    expect(rippleFor({ type: "signup.created", payload: {} })).toEqual({ kind: "signup" });
    expect(rippleFor({ type: "task.completed", payload: { title: "X" } })).toEqual({ kind: "task", label: "X" });
    expect(rippleFor({ type: "customer.converted", payload: {} })).toBeNull();
  });
  it("folds forecasts into a non-inverting cone past today and ghosts future roadmap flags", () => {
    const cone = forecastCone(finance.forecasts, TODAY);
    expect(cone.length).toBe(6);
    for (const p of cone) {
      expect(p.day > TODAY).toBe(true);
      expect(p.upsideMinor).toBeGreaterThanOrEqual(p.baseMinor);
      expect(p.downsideMinor).toBeLessThanOrEqual(p.baseMinor);
    }
    expect(forecastCone({ base: { ...finance.forecasts.base!, series: [{ month: "2099-01", revenueMinor: 3100 }] } }, TODAY)).toEqual([{ day: "2099-01-15", baseMinor: 100, upsideMinor: 100, downsideMinor: 100 }]);
    // A daily point is already revenue per day.
    expect(forecastCone({ base: { ...finance.forecasts.base!, series: [{ day: "2099-01-03", revenueMinor: 70 }] } }, TODAY)).toEqual([{ day: "2099-01-03", baseMinor: 70, upsideMinor: 70, downsideMinor: 70 }]);
    expect(forecastCone(undefined, TODAY)).toEqual([]);
    const flags = roadmapFlags(roadmap.items, TODAY);
    expect(flags.map((f) => f.label)).toEqual(["Usage-based billing", "Team seats", "Annual plans"]);
  });
});

describe("team pulse", () => {
  it("spreads sessions across hour cells per department and clips to the window", () => {
    const days = lastDays(7, TODAY);
    const cells = sessionsToPulseCells(sessions.items, departments, days, new Date(`${TODAY}T12:00:00.000Z`));
    const dev = cells.filter((c) => c.departmentId === departments[0]!.id);
    expect(dev.reduce((s, c) => s + c.agentHours, 0)).toBeCloseTo(1.75 + 1, 5);
    const sevenToEight = dev.find((c) => c.dayIndex === 6 && c.hour === 7)!;
    expect(sevenToEight.agentHours).toBeCloseTo(0.5, 5);
    expect(cells.filter((c) => c.departmentId === departments[1]!.id).reduce((s, c) => s + c.agentHours, 0)).toBeCloseTo(0.5, 5);
    const old = sessionsToPulseCells([{ id: "x", agentId: sessions.items[0]!.agentId, startedAt: `${addDays(TODAY, -30)}T00:00:00Z`, endedAt: `${addDays(TODAY, -30)}T04:00:00Z` }], departments, days);
    expect(old).toEqual([]);
  });

  it("places hours on the business's clock: a 21:00–22:00 UTC session is 6 AM the next day in Tokyo", () => {
    const agentId = departments[0]!.squad[0]!.id;
    const days = ["2026-10-11", "2026-10-12"];
    const session = [{ id: "s", agentId, startedAt: "2026-10-11T21:00:00Z", endedAt: "2026-10-11T22:00:00Z" }];
    const at = new Date("2026-10-12T00:00:00Z");
    expect(sessionsToPulseCells(session, departments, days, at, "Asia/Tokyo")).toEqual([{ departmentId: departments[0]!.id, dayIndex: 1, hour: 6, agentHours: 1 }]);
    expect(sessionsToPulseCells(session, departments, days, at)).toEqual([{ departmentId: departments[0]!.id, dayIndex: 0, hour: 21, agentHours: 1 }]);
    // Half an hour off UTC: each half lands in its own local hour.
    const india = sessionsToPulseCells(session, departments, days, at, "Asia/Kolkata");
    expect(india.map((c) => [c.dayIndex, c.hour, c.agentHours])).toEqual([[1, 2, 0.5], [1, 3, 0.5]]);
  });

  it("computes 200 sessions over 30 days several times faster than walking every half hour, with the same cells", () => {
    // The walk before audit C1: every half-hour step from each session's start, kept only when it lands on a day shown.
    const walkEveryStep = (rows: readonly SessionRow[], days: readonly string[], now: Date, zone: string | null) => {
      const deptOf = new Map(departments.flatMap((d) => d.squad.map((a) => [a.id, d.id] as const)));
      const cells = new Map<string, { departmentId: string; dayIndex: number; hour: number; agentHours: number }>();
      for (const r of rows) {
        const departmentId = deptOf.get(r.agentId)!;
        const start = Date.parse(r.startedAt);
        const end = r.endedAt ? Date.parse(r.endedAt) : now.getTime();
        if (end <= start) continue;
        for (let cursor = Math.floor(start / 1_800_000) * 1_800_000; cursor < end; cursor += 1_800_000) {
          const overlap = Math.min(end, cursor + 1_800_000) - Math.max(start, cursor);
          const { day, hour } = dayHourIn(cursor, zone);
          const di = days.indexOf(day);
          if (di < 0 || overlap <= 0) continue;
          const key = `${departmentId}:${di}:${hour}`;
          const cell = cells.get(key) ?? { departmentId, dayIndex: di, hour, agentHours: 0 };
          cell.agentHours += overlap / 3_600_000;
          cells.set(key, cell);
        }
      }
      return [...cells.values()];
    };
    const agents = departments.flatMap((d) => d.squad.map((a) => a.id));
    const at = new Date(`${TODAY}T12:00:00.000Z`);
    const many: SessionRow[] = Array.from({ length: 200 }, (_, i) => {
      const startedAt = at.getTime() - (i / 200) * 30 * 86_400_000 - (i % 7) * 600_000;
      // Every tenth session is still open, so it runs until now: the case that walked up to 30 days of steps.
      const endedAt = i % 10 === 0 ? null : new Date(startedAt + (1 + (i % 6)) * 3_600_000).toISOString();
      return { id: `s${i}`, agentId: agents[i % agents.length]!, startedAt: new Date(startedAt).toISOString(), endedAt };
    });
    const days = lastDays(7, TODAY);
    // UTC, a zone half an hour off and one 45 minutes off UTC (its days do not start on a half-hour step).
    // Timed against the walk it replaced, on the same machine, rather than against a fixed number of milliseconds: a
    // shared CI runner under load ran the fast path in 52-55 ms against a 50 ms limit (Oct 22-23, 2026), while the walk
    // takes many times longer wherever it runs. The ceiling still catches a slip back to stepping through every half hour.
    const bestOf = (fn: () => unknown) => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    for (const zone of [null, "Asia/Kolkata", "Asia/Kathmandu"]) {
      const cells = sessionsToPulseCells(many, departments, days, at, zone);
      const fast = bestOf(() => sessionsToPulseCells(many, departments, days, at, zone));
      const walk = bestOf(() => walkEveryStep(many, days, at, zone));
      expect(fast, `fast path ${fast.toFixed(1)} ms, step walk ${walk.toFixed(1)} ms`).toBeLessThan(walk / 3);
      expect(fast).toBeLessThan(250);
      expect(cells.length).toBeGreaterThan(0);
      expect(cells).toEqual(walkEveryStep(many, days, at, zone));
    }
  });
});

describe("status strip", () => {
  it("builds five tiles in Personal mode and six in LIVE, with Estimate on runway", () => {
    const base = { finance, ribbon: ribbon(14), departments, today: TODAY, currency: "EUR", loading: { finance: false, ribbon: false, departments: false, positions: false }, open: () => {} };
    const personal = statusTiles({ ...base, live: false });
    expect(personal.map((t) => t.label)).toEqual(["Cash", "Runway", "Revenue this month", "Customers this week", "Team health"]);
    expect(personal[1]).toMatchObject({ value: "8.7", unit: "mo", estimate: "estimate" });
    expect(personal[3]!.value).toBe(2);
    // Captions in words (UX plan B9, B10); the formula and the accounting basis sit in the provenance tooltip.
    expect(personal[0]!.caption).toBe(`In the bank · ${finance.cash.accounts} accounts`);
    expect(statusTiles({ ...base, live: false, finance: { ...finance, cash: { ...finance.cash, accounts: 1 } } })[0]!.caption).toBe("In the bank · 1 account");
    expect(personal[1]!.caption).toBe(finance.runway.blocksContinue ? "Under 3 months of cash left: holds Continue" : finance.runway.months! < 9 ? "Under 9 months of cash left" : "Months of cash left at today's spending");
    expect(personal[1]!.provenance?.source).toContain("Cash ÷ net burn");
    expect(personal[2]!.caption).toBe("Money in this month");
    expect(personal[2]!.provenance).toMatchObject({ note: finance.revenue.label });
    expect(personal[3]!.caption).toBe("Paying customers, last 7 days");
    expect(personal[4]!.caption).toBe("5 of 6 agents healthy");
    for (const t of personal) expect(String(t.caption ?? "")).not.toMatch(/÷|Cash basis|Business health/);
    // One agent, none, and a team that all needs the founder.
    expect(teamHealthCaption(teamHealthCounts(["healthy"]))).toBe("1 of 1 agent healthy");
    expect(teamHealthCaption(teamHealthCounts([]))).toBe("No agents hired yet");
    expect(teamHealthCaption(teamHealthCounts(["failing", "injured"]))).toBe("0 of 2 agents healthy");
    expect(statusTiles({ ...base, live: false, departments: [] })[4]).toMatchObject({ label: "Team health", value: "—", caption: "No agents hired yet" });
    // Work, not only liveness (Nov 1, 2026): nothing finished this week and many blocked tasks reads Stalled, whatever the agents say.
    expect(statusTiles({ ...base, live: false, tasks: { blocked: 9, doneLast7Days: 0 } })[4]).toMatchObject({ label: "Team health", value: "Stalled", caption: "0 finished this week · 9 blocked" });
    expect(statusTiles({ ...base, live: false, tasks: { blocked: 2, doneLast7Days: 3 } })[4]).toMatchObject({ value: 5 / 6, caption: "5 of 6 agents healthy · 3 finished this week · 2 blocked" });
    expect(statusTiles({ ...base, live: false, tasks: { blocked: 0, doneLast7Days: 3 } })[4]!.caption).toBe("5 of 6 agents healthy");
    const live = statusTiles({ ...base, live: true, positions: [{ ...leaderboardEntries[7]!, board: leaderboards[0]! }] });
    expect(live.length).toBe(6);
    expect(live[5]).toMatchObject({ label: "Leaderboard position", value: "#8" });
    expect(squadHealth(departments)).toBeCloseTo(5 / 6, 5);
    expect(squadHealth([])).toBeNull();
  });

  it("gives every tile its plain-words line and the defined labels their term (UX plan §7.8)", () => {
    const base = { finance, ribbon: ribbon(14), departments, today: TODAY, currency: "EUR", loading: { finance: false, ribbon: false, departments: false, positions: false }, open: () => {} };
    const tiles = statusTiles({ ...base, live: true, positions: [{ ...leaderboardEntries[7]!, board: leaderboards[0]! }] });
    // The definitions map's line where it has one; the strip's own words for the rest.
    expect(tiles.map((t) => t.metricId ?? t.plain)).toEqual([PLAIN_LINES.cash, "runway", PLAIN_LINES.revenue, PLAIN_LINES.customers, "team_health", "leaderboard"]);
    expect(tiles.map((t) => t.termId)).toEqual([undefined, "runway", "revenue", undefined, undefined, undefined]);
    // No runway figure yet: the tile still defines the word.
    expect(runwayTile({ ...finance, runway: { ...finance.runway, months: null } }, false, () => {})).toMatchObject({ termId: "runway", metricId: "runway" });
    // A failed Finance read keeps the term on the label and says nothing in plain words under "No access".
    const forbidden = Object.assign(new Error("no"), { data: { code: "FORBIDDEN" } });
    const failed = statusTiles({ ...base, live: false, finance: undefined, errors: { finance: forbidden } });
    expect(failed[1]).toMatchObject({ termId: "runway" });
    expect(failed[1]!.metricId).toBeUndefined();
    expect(failed[1]!.plain).toBeUndefined();
  });

  it("names the metric of every department card in plain words, or its definition", () => {
    expect(METRIC_PLAIN.runway).toEqual({ metricId: "runway" });
    expect(METRIC_PLAIN.squad_health).toEqual({ metricId: "team_health" });
    expect(METRIC_PLAIN.blended_cpa).toEqual({ metricId: "acquisition_cost" });
    for (const key of ["auto", "tasks_done", "roadmap_on_track", "next_filing"] as const) expect("plain" in METRIC_PLAIN[key] && METRIC_PLAIN[key].plain.length > 0).toBe(true);
  });

  it("never counts a raise as revenue: Revenue this month and its spark read operating inflows (BUILD §11.8)", () => {
    const monthly = finance.revenue.monthly.map((m, i, all) => (i === all.length - 1 ? { ...m, inflowMinor: m.inflowMinor + 40_000_000, operatingInflowMinor: m.inflowMinor } : m));
    const withSafe = { ...finance, revenue: { ...finance.revenue, monthly } };
    const base = { finance: withSafe, ribbon: ribbon(14), departments, today: TODAY, currency: "EUR", loading: { finance: false, ribbon: false, departments: false, positions: false }, open: () => {}, live: false };
    const revenue = statusTiles(base)[2]!;
    expect(revenue.value).toEqual({ amountMinor: finance.revenue.monthly.at(-1)!.inflowMinor, currency: "EUR" });
    expect(revenue.spark).toEqual(finance.revenue.monthly.map((m) => m.inflowMinor));
    expect(revenueBars(withSafe, 6).map((b) => b.value)).toEqual(finance.revenue.monthly.map((m) => m.inflowMinor));
    expect(monthRevenueMinor({ inflowMinor: 500 })).toBe(500); // older responses without the split
  });

  it("uses one team-health definition: a day-one team of idle agents is 100%, on the strip and on the Team card", () => {
    const idle = departments.map((d) => ({ ...d, squad: d.squad.map((a) => ({ ...a, status: "idle" as const })) }));
    expect(squadHealth(idle)).toBe(1);
    const squad = idle[0]!.squad.map((a) => ({ id: a.id, name: a.name, seed: a.avatarSeed, status: a.status, role: a.role, model: String(a.modelKey) }));
    expect(headlineMetric({ key: "squad_health", rows: [], days: [], squad, currency: "EUR", today: TODAY }).value).toBe("100%");
    // Paused (a choice) is healthy too; failing, down and degraded need the founder.
    expect(teamHealth(["healthy", "paused", "failing", "injured", "degraded", "idle"])).toBe(0.5);
    expect(teamHealthSummary(teamHealthCounts(["idle", "idle", "healthy"]))).toEqual({ tone: "good", text: "Nobody needs you", detail: "1 working · 2 idle" });
    expect(teamHealthSummary(teamHealthCounts(["healthy", "healthy"]))).toEqual({ tone: "good", text: "Everyone is working" });
    expect(teamHealthSummary(teamHealthCounts(["healthy", "injured"]))).toEqual({ tone: "warn", text: "1 agent needs you" });
  });

  it("speaks plain words: a board kind is never a stored key, a missing runway says why", () => {
    expect(boardWords("customers_won")).toBe("Customers won");
    expect(boardWords("mrr_growth")).toBe("MRR growth");
    const base = { finance, ribbon: ribbon(14), departments, today: TODAY, currency: "EUR", loading: { finance: false, ribbon: false, departments: false, positions: false }, open: () => {} };
    const untitled = statusTiles({ ...base, live: true, positions: [{ ...leaderboardEntries[7]!, board: { ...leaderboards[0]!, title: null as never, boardKind: "customers_won" } }] });
    expect(untitled[5]!.caption).toBe("Customers won");
    expect(statusTiles({ ...base, live: true, positions: [] })[5]).toMatchObject({ value: "Not ranked" });
    const none = runwayTile({ ...finance, runway: { ...finance.runway, months: null } }, false, () => {});
    // One wording everywhere (shared/runway.ts): cash-flow positive is "No limit", otherwise "Not known yet" with the reason.
    expect(none).toMatchObject({ label: "Runway", value: finance.burn.netBurnMinor <= 0 ? "No limit" : "Not known yet" });
    expect(none.estimate).toBeUndefined();
    const positive = runwayTile({ ...finance, cash: { ...finance.cash, accounts: 1 }, burn: { ...finance.burn, netBurnMinor: -500 }, runway: { ...finance.runway, months: null } }, false, () => {});
    expect(positive).toMatchObject({ value: "No limit", caption: "Cash-flow positive, so no limit yet" });
    const noBank = runwayTile({ ...finance, cash: { ...finance.cash, accounts: 0 }, runway: { ...finance.runway, months: null } }, false, () => {});
    expect(noBank).toMatchObject({ value: "Not known yet", caption: "Connect a bank to estimate it" });
  });
});

describe("cash and runway", () => {
  it("says runway in the words the status strip uses, with no Estimate chip on a missing figure", () => {
    const positive = runwayTileProps({ ...finance, burn: { ...finance.burn, netBurnMinor: -2_296_294 }, runway: { ...finance.runway, months: null } });
    expect(positive).toMatchObject({ value: "No limit", caption: "Cash-flow positive, so no limit yet" });
    expect(positive.estimate).toBeUndefined();
    // The same words as the status strip's tile for the same answer.
    const strip = runwayTile({ ...finance, burn: { ...finance.burn, netBurnMinor: -2_296_294 }, runway: { ...finance.runway, months: null } }, false, () => {});
    expect([positive.value, positive.caption]).toEqual([strip.value, strip.caption]);
    expect(runwayTileProps(finance)).toMatchObject({ value: "8.7", unit: "mo", estimate: "estimate" });
  });

  it("tones runway by the 9 / 6 month thresholds and draws dashed forecast series", () => {
    expect(runwayTone(null)).toBe("neutral");
    expect(runwayTone(12)).toBe("good");
    expect(runwayTone(8)).toBe("warn");
    expect(runwayTone(5)).toBe("bad");
    const s = forecastSeries(finance.forecasts);
    expect(s.map((x) => x.id)).toEqual(["downside", "base", "upside"]);
    expect(s.every((x) => x.dashed)).toBe(true);
    expect(s[1]!.data[0]!.y).toBe(180_000);
    // The chart reads the currency's own decimals: the same minor amount is 100 times more yen, 10 times less dinars (JM-14).
    expect(forecastSeries(finance.forecasts, "JPY")[1]!.data[0]!.y).toBe(18_000_000);
    expect(forecastSeries(finance.forecasts, "KWD")[1]!.data[0]!.y).toBe(18_000);
  });
});

describe("revenue and customers", () => {
  it("groups business-wide payments and signups by ISO week", () => {
    const weeks = customersPerWeek(ribbon(28));
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    expect(weeks.reduce((s, w) => s + w.customers, 0)).toBe(7);
    expect(weeks.every((w) => /^\d{4}-W\d{2}$/.test(w.week))).toBe(true);
  });

  it("names weeks by their Monday, fills empty weeks with zero, and never starts on a partial week", () => {
    const from = weeksFrom("2026-10-12", 6);
    expect(from).toBe("2026-04-13"); // the Monday of the week holding Apr 15
    const rows = [{ ...ribbon(1).rows.find((r) => r.departmentId === null)!, day: "2026-10-07", payments: 2, signups: 3 }];
    const weeks = customersPerWeek({ ...ribbon(1), rows }, { from: "2026-09-21", to: "2026-10-12" });
    expect(weeks.map((w) => [w.start, w.customers])).toEqual([["2026-09-21", 0], ["2026-09-28", 0], ["2026-10-05", 2], ["2026-10-12", 0]]);
    const [customers] = weekLines(weeks);
    expect(customers!.data[2]!.x).toBeInstanceOf(Date);
    expect(formatDate(customers!.data[2]!.x as Date, "dayMonth")).toBe("Oct 5");
  });

  it("labels revenue months in US words and keeps the amounts in minor units for money formatting", () => {
    const bars = revenueBars({ ...finance, revenue: { ...finance.revenue, monthly: [{ month: "2026-05", inflowMinor: 124_101, outflowMinor: 0, netMinor: 124_101, count: 1 }, { month: "2026-10", inflowMinor: 99, outflowMinor: 0, netMinor: 99, count: 1 }] } }, 6);
    expect(bars).toEqual([{ label: "May", value: 124_101 }, { label: "Oct", value: 99 }]);
    expect(monthLabel("2026-01")).toBe("Jan");
  });
});

describe("funnel", () => {
  it("builds five stages, dropping impressions when asked or absent", () => {
    expect(funnelStages(channels.blended).map((s) => s.label)).toEqual(["Impressions", "Leads", "Signups", "Activations", "Customers"]);
    expect(funnelStages(channels.blended, true)[0]!.label).toBe("Leads");
    expect(funnelStages({ ...channels.blended, impressions: 0 })[0]!.label).toBe("Leads");
    expect(funnelStages(null)).toEqual([]);
  });
});

describe("channel form guide", () => {
  it("scores weekly CPA against the channel's own median", () => {
    expect(formCells([{ spendMinor: 100, customers: 1 }, { spendMinor: 200, customers: 1 }, { spendMinor: 100, customers: 1 }, { spendMinor: 100, customers: 1 }, { spendMinor: 50, customers: 1 }])).toEqual(["warn", "bad", "warn", "warn", "good"]);
    expect(formCells([{ spendMinor: 0, customers: 0 }, { spendMinor: 10, customers: 0 }])).toEqual(["none", "bad"]);
  });
  it("lists enabled channels by fit with five form cells each", () => {
    const rows = buildFormRows(channels.channels, channelMetrics, TODAY, { includeDisabled: false, max: 8 });
    expect(rows.map((r) => r.label)).toEqual(["SEO", "Paid advertising"]);
    expect(rows[0]!.form.length).toBe(5);
    expect(rows[1]!.customers).toBeGreaterThan(0);
    expect(buildFormRows(channels.channels, channelMetrics, TODAY, { includeDisabled: true, max: 8 }).length).toBe(3);
  });
});

describe("roadmap", () => {
  it("groups by horizon in position order, maps status words and task progress", () => {
    const g = groupByHorizon(roadmap.items, { horizons: ["now", "next", "later"], max: 6, hideDone: false });
    expect(g.now.map((i) => i.title)).toEqual(["Usage-based billing", "Team seats", "Onboarding checklist"]);
    expect(groupByHorizon(roadmap.items, { horizons: ["now"], max: 6, hideDone: true }).now.length).toBe(2);
    expect(roadmapStatus("done").word).toBe("Done");
    expect(roadmapStatus("blocked").tone).toBe("bad");
    expect(roadmapStatus("whatever").word).toBe("Planned");
    expect(taskProgress(roadmap.items[0]!)).toEqual({ done: 1, total: 2, progress: 0.7 });
  });
});

describe("agent of the week", () => {
  it("picks by rating, form or value and respects the department filter", () => {
    expect(pickAgent(team, { by: "rating", departmentId: null })!.name).toBe("Ember");
    expect(pickAgent(team, { by: "form", departmentId: null })!.name).toBe("Ember");
    expect(pickAgent(team, { by: "value", departmentId: null })!.name).toBe("Ember");
    expect(pickAgent(team, { by: "rating", departmentId: departments[0]!.id })!.name).toBe("Atlas");
    expect(pickAgent([], { by: "rating", departmentId: null })).toBeNull();
  });
  it("rates on the one /20 scale: the mean of the skills, else the /10 rating doubled, and the stars from it (founder decision 2026-10-20)", () => {
    // Atlas: skills 16 and 14 → 15; Ember: 18.
    expect(agentRating20(team[0]!)).toBe(15);
    expect(agentRating20(team[2]!)).toBe(18);
    expect(agentRating20({ skills: [], rating: 7.5 })).toBe(15);
    expect(agentRating20({ skills: [], rating: null })).toBeNull();
    expect(agentRating20({ skills: [{ displayed: 0 }], rating: null })).toBeNull();
    // team.agents.list's own /20 figure comes first; a missing or zero one falls through to the skills, then the /10.
    expect(agentRating20({ skills: [{ displayed: 10 }], rating: 4, rating20: 16.5 })).toBe(16.5);
    expect(agentRating20({ skills: [{ displayed: 10 }], rating: 4, rating20: 0 })).toBe(10);
    expect(agentRating20({ skills: [], rating: 4, rating20: null })).toBe(8);
    expect(starsFromRating20(18)).toBe(4.5);
    expect(starsFromRating20(15)).toBe(4);
    expect(starsFromRating20(20)).toBe(5);
    expect(starsFromRating20(1)).toBe(0.5);
  });

  it("reads team.agents.list as the API's { agents, templates } envelope or a bare array", () => {
    expect(agentRows(undefined)).toEqual([]);
    expect(agentRows(team)).toBe(team);
    expect(agentRows({ agents: team, templates: ["generalist"] })).toBe(team);
    expect(agentRows({ agents: undefined as unknown as typeof team })).toEqual([]);
    expect(pickAgent(agentRows({ agents: team }), { by: "rating", departmentId: null })!.name).toBe("Ember");
  });
});

describe("milestones", () => {
  it("marks reached milestones from stored rows, shows the customer only with permission and shares only in LIVE", () => {
    const cards = trophyCards(ribbon().milestones, "EUR", false);
    expect(cards.length).toBe(8);
    expect(cards.find((c) => c.key === "customer_1")).toMatchObject({ achievedAt: expect.any(String), customerName: "Nordic Beauty AB", shareable: false });
    expect(cards.find((c) => c.key === "mrr_1k")!.customerName).toBeNull();
    expect(cards.find((c) => c.key === "mrr_10k")!.achievedAt).toBeNull();
    expect(trophyCards(ribbon().milestones, "EUR", true).find((c) => c.key === "customer_1")!.shareable).toBe(true);
  });
  it("matches seeded rows that keep the key in ref.trophyKey (milestones has no trophy_key column)", () => {
    const seeded = ribbon().milestones.map((m) => ({ ...m, trophyKey: undefined as unknown as string, ref: { ...(m.ref as object), trophyKey: m.trophyKey } }));
    expect(milestoneKey(seeded[0]!)).toBe("customer_1");
    expect(milestoneKey({ trophyKey: undefined as unknown as string, ref: {} })).toBeNull();
    const cards = trophyCards(seeded, "EUR", false);
    expect(cards.find((c) => c.key === "customer_1")).toMatchObject({ achievedAt: expect.any(String), customerName: "Nordic Beauty AB" });
    expect(cards.find((c) => c.key === "mrr_1k")!.achievedAt).toEqual(expect.any(String));
    expect(cards.filter((c) => c.achievedAt).length).toBe(2);
  });
  it("falls back to kind + label only for rows without any key, so a keyed row never claims another milestone", () => {
    const rows = [{ ...ribbon().milestones[0]!, trophyKey: "customer_10", label: "First customer" }];
    const cards = trophyCards(rows, "EUR", false);
    expect(cards.find((c) => c.key === "customer_1")!.achievedAt).toBeNull();
    expect(cards.find((c) => c.key === "customer_10")!.achievedAt).toEqual(expect.any(String));
  });
});

describe("routes", () => {
  it("builds the milestones and journey hrefs the host serves (CLAUDE.md vocabulary: no /trophies)", () => {
    expect(routes.milestones(BID)).toBe(`/b/${BID}/milestones`);
    expect(routes.milestones(BID, "customer_1")).toBe(`/b/${BID}/milestones?share=customer_1`);
    expect(routes.journey(BID, "j1")).toBe(`/b/${BID}/journey/j1`);
    expect(Object.keys(routes)).not.toContain("trophies");
  });
  it("opens a Ribbon marker by journey id when the conversion row carries one, else by conversion id", () => {
    const [first] = ribbon().conversions;
    expect(journeyHref(BID, ribbon().conversions, first!.id)).toBe(`/b/${BID}/journey/${first!.id}`);
    expect(journeyHref(BID, [{ ...first!, journeyId: "journey-9" }], first!.id)).toBe(`/b/${BID}/journey/journey-9`);
    expect(journeyHref(BID, undefined, "conv-x")).toBe(`/b/${BID}/journey/conv-x`);
  });
});

describe("leaderboard", () => {
  it("picks the board and windows the rows around this club", () => {
    expect(pickBoard(leaderboards, "nope")!.id).toBe(leaderboards[0]!.id);
    expect(pickBoard([], null)).toBeUndefined();
    expect(windowRows(leaderboardEntries, BID, 10).length).toBe(10);
    const w = windowRows(leaderboardEntries, BID, 5);
    expect(w.map((r) => r.position)).toEqual([1, 2, 7, 8, 9]);
    expect(windowRows(leaderboardEntries, "nobody", 5).map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("text helpers", () => {
  it("names a human message after its sender: the founder's own note, or another founder's words from Network (audit #65)", () => {
    expect(humanSender("u-me", "u-me")).toBe("self");
    expect(humanSender("u-ana", "u-me")).toBe("other");
    expect(humanSender(null, "u-me")).toBeNull();
    expect(NETWORK_SENDER).toBe("Network");
  });

  it("writes previews and event lines in plain words", () => {
    expect(previewLine("Atlas needs a yes. The migration touches [[ent:x|Nordic]] data.")).toBe("Atlas needs a yes.");
    expect(previewLine("**No full stop here**")).toBe("No full stop here");
    expect(previewLine("**Vision.** Month-end close software for small finance teams. More.")).toBe("Month-end close software for small finance teams.");
    expect(postPreview("# Hello  *world*", 5)).toBe("Hell…");
    // The founder's own post that moderation holds says so; a visible one carries no pill.
    const [held, shown] = postsToTimeline([
      { id: "p1", communityId: "c", authorUserId: "u", authorName: "Ana", bodyMd: "Mail me", createdAt: `${TODAY}T09:00:00.000Z`, status: "pending_review" },
      { id: "p2", communityId: "c", authorUserId: "u", authorName: "Ana", bodyMd: "Hello", createdAt: `${TODAY}T10:00:00.000Z`, status: "visible" },
    ]);
    expect(held).toMatchObject({ tone: "warn", statusWord: "Held for review" });
    expect(shown).toMatchObject({ tone: "neutral" });
    expect(shown).not.toHaveProperty("statusWord");
    // The feed is for members: the chosen community if joined, else the first joined one, never one the founder is not in.
    const communities = [{ id: "a", name: "A", role: null }, { id: "b", name: "B", role: "member" }, { id: "c", name: "C", role: "owner" }];
    expect(pickCommunity(communities, null)?.id).toBe("b");
    expect(pickCommunity(communities, "c")?.id).toBe("c");
    expect(pickCommunity(communities, "a")?.id).toBe("b");
    expect(pickCommunity([{ id: "a", name: "A", role: null }], null)).toBeUndefined();
    expect(pickCommunity([{ id: "x", name: "X" }], null)?.id).toBe("x"); // an answer without roles shows the first
    expect(pickCommunity(undefined, null)).toBeUndefined();
    expect(describeEvent({ type: "task.completed", payload: { title: "X", outcome: "partial" } })).toMatchObject({ title: "Done: X", statusWord: "Partial", tone: "warn" });
    expect(describeEvent({ type: "payment.received", payload: { amount: { amountMinor: 4900, currency: "EUR" }, firstPayment: true } }).title).toBe("Payment received · €49.00");
    // An unknown type gets a generic label, never its raw key.
    expect(describeEvent({ type: "something.odd", payload: {} }).title).toBe("Business update");
    // Another member archived a note or confirmed its plan (audit RUI-09): plain words, not the raw event type.
    expect(describeEvent({ type: "inbox.item_updated", payload: { change: "archived" } })).toMatchObject({ title: "Inbox note archived", tone: "neutral" });
    expect(describeEvent({ type: "inbox.item_updated", payload: { change: "plan_confirmed" } })).toMatchObject({ title: "Plan confirmed", statusWord: "Confirmed", tone: "good" });
    // What a member walled from Finance or the CRM receives: the note without its subject; staff changes in words.
    expect(describeEvent({ type: "inbox.item_created", payload: { inboxItemId: "x", blocksContinue: false } }).title).toBe("New inbox note");
    expect(describeEvent({ type: "membership.changed", payload: { userId: "u", change: "updated" } }).title).toBe("Staff access changed");
    expect(describeEvent({ type: "membership.changed", payload: { userId: "u", change: "removed" } }).title).toBe("Staff member removed");
  });

  it("the live feed reads events in product words, never enum keys (Down, Vacation, a signup is not a customer)", () => {
    expect(describeEvent({ type: "agent.health_changed", payload: { to: "injured", reason: "Loop detected" } })).toMatchObject({ title: "Agent down", statusWord: "Down", tone: "bad" });
    expect(describeEvent({ type: "agent.health_changed", payload: { to: "healthy" } })).toMatchObject({ title: "Agent healthy again", statusWord: "Healthy", tone: "good" });
    expect(describeEvent({ type: "holiday.started", payload: {} }).title).toBe("Vacation started");
    expect(describeEvent({ type: "holiday.ended", payload: {} }).title).toBe("Vacation ended");
    expect(describeEvent({ type: "customer.converted", payload: { kind: "signup" } })).toMatchObject({ title: "New signup", statusWord: undefined });
    expect(describeEvent({ type: "customer.converted", payload: { kind: "payment", amount: { amountMinor: 4900, currency: "USD" } } })).toMatchObject({ title: "New paying customer", description: "$49.00", statusWord: "Win" });
    expect(describeEvent({ type: "approval.resolved", payload: { outcome: "approved" } })).toMatchObject({ title: "Approved", statusWord: "Approved", tone: "good" });
    expect(describeEvent({ type: "approval.resolved", payload: { outcome: "expired" } }).title).toBe("Approval expired");
    expect(describeEvent({ type: "cycle.completed", payload: { cycleNumber: 3, outcome: "time_box", tasksCompleted: 1 } })).toMatchObject({ title: "Cycle 3 reached its time limit", description: "1 task done" });
    expect(describeEvent({ type: "task.progressed", payload: { phase: "implementing", progress: 0.45 } }).title).toBe("Implementing: 45%");
    expect(describeEvent({ type: "mode.changed", payload: { scope: "business" } }).title).toBe("Business mode changed");
    expect(describeEvent({ type: "constructor", payload: {} }).title).toBe("Business update");
    for (const type of ["agent.health_changed", "holiday.started", "customer.converted", "approval.resolved", "mode.changed", "cycle.completed"]) {
      const d = describeEvent({ type, payload: { to: "injured", kind: "signup", outcome: "approved", scope: "business" } });
      expect(`${d.title} ${d.statusWord ?? ""}`, type).not.toMatch(/injured|holiday|Customer won|Approval approved|_|\./);
    }
  });
});

describe("moduleTabLabel", () => {
  it("names a screen by the department that owns the module and the tab's own title, never a hard-coded name", () => {
    const tabs = [{ id: "t1", slug: "plan", title: "Plan", position: 0 }];
    const dept = (name: string, moduleKeys: string[], hidden = false) => ({ id: name, name, slug: name.toLowerCase(), colourToken: "dept-1", position: 0, moduleKeys, hidden, tabs }) as never;
    expect(moduleTabLabel([dept("Formulation Lab", ["development"])], "development", "plan")).toBe("Formulation Lab › Plan");
    // A tab the department does not list falls back to the module's default title.
    expect(moduleTabLabel([dept("Editorial", ["product"])], "product", "changes")).toBe("Editorial › Changes");
    expect(moduleTabLabel([dept("Hidden", ["team"], true)], "team", "recruitment")).toBeNull();
    expect(moduleTabLabel(undefined, "team", "recruitment")).toBeNull();
  });
});

describe("moduleHref", () => {
  it("links a tab to the first department over the module that shows it (Operations shows only Specialists and Plan)", () => {
    const dev = departments[0]!;
    const ops = { ...dev, id: "ops", slug: "operations", name: "Formulation Lab", position: -1, tabs: [{ id: "s", slug: "specialists", title: "Specialists", position: 0 }, { id: "p", slug: "plan", title: "Plan", position: 1 }] };
    const rows = [ops, dev];
    expect(moduleHref(BID, rows, "development", "training-ground")).toBe(routes.department(BID, dev.slug, "training-ground"));
    expect(moduleHref(BID, rows, "development", "specialists")).toBe(routes.department(BID, "operations", "specialists"));
    // Without a tab, the first department over the module and its first tab.
    expect(moduleHref(BID, rows, "development")).toBe(routes.department(BID, "operations", "specialists"));
  });
});
