/** Pure helpers behind the widgets. */
import { describe, expect, it } from "vitest";
import { readWidgetEvent } from "../data";
import { addDays, dailySeries, daysUntil, lastDays, weekKey } from "../shared/time";
import { agentRows, pickAgent } from "../widgets/agent-of-the-week";
import { buildFormRows, formCells } from "../widgets/channel-form-guide";
import { forecastSeries, runwayTone } from "../widgets/cash-runway";
import { pickCommunity, postPreview } from "../widgets/community-feed";
import { funnelStages } from "../widgets/funnel";
import { previewLine } from "../widgets/inbox-preview";
import { forecastCone, journeyHref, rippleFor, roadmapFlags } from "../widgets/journey-ribbon";
import { pickBoard, windowRows } from "../widgets/league-table";
import { describeEvent } from "../widgets/live-feed";
import { customersPerWeek } from "../widgets/revenue-customers";
import { groupByHorizon, roadmapStatus, taskProgress } from "../widgets/roadmap-timeline";
import { sessionsToPulseCells } from "../widgets/squad-pulse";
import { boardWords, runwayTile, squadHealth, statusTiles } from "../widgets/status-strip";
import { milestoneKey, trophyCards } from "../widgets/trophy-cabinet";
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
});

describe("status strip", () => {
  it("builds five tiles in Personal mode and six in LIVE, with Estimate on runway", () => {
    const base = { finance, ribbon: ribbon(14), departments, today: TODAY, currency: "EUR", loading: { finance: false, ribbon: false, departments: false, positions: false }, open: () => {} };
    const personal = statusTiles({ ...base, live: false });
    expect(personal.map((t) => t.label)).toEqual(["Cash", "Runway", "Revenue this month", "Customers this week", "Business health"]);
    expect(personal[1]).toMatchObject({ value: "8.7", unit: "mo", estimate: "estimate" });
    expect(personal[3]!.value).toBe(2);
    const live = statusTiles({ ...base, live: true, positions: [{ ...leaderboardEntries[7]!, board: leaderboards[0]! }] });
    expect(live.length).toBe(6);
    expect(live[5]).toMatchObject({ label: "Leaderboard position", value: "#8" });
    expect(squadHealth(departments)).toBeCloseTo(5 / 6, 5);
    expect(squadHealth([])).toBeNull();
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
  it("tones runway by the 9 / 6 month thresholds and draws dashed forecast series", () => {
    expect(runwayTone(null)).toBe("neutral");
    expect(runwayTone(12)).toBe("good");
    expect(runwayTone(8)).toBe("warn");
    expect(runwayTone(5)).toBe("bad");
    const s = forecastSeries(finance.forecasts);
    expect(s.map((x) => x.id)).toEqual(["downside", "base", "upside"]);
    expect(s.every((x) => x.dashed)).toBe(true);
    expect(s[1]!.data[0]!.y).toBe(180_000);
  });
});

describe("revenue and customers", () => {
  it("groups business-wide payments and signups by ISO week", () => {
    const weeks = customersPerWeek(ribbon(28));
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    expect(weeks.reduce((s, w) => s + w.customers, 0)).toBe(7);
    expect(weeks.every((w) => /^\d{4}-W\d{2}$/.test(w.week))).toBe(true);
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
  it("writes previews and event lines in plain words", () => {
    expect(previewLine("Atlas needs a yes. The migration touches [[ent:x|Nordic]] data.")).toBe("Atlas needs a yes.");
    expect(previewLine("**No full stop here**")).toBe("No full stop here");
    expect(postPreview("# Hello  *world*", 5)).toBe("Hell…");
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
    expect(describeEvent({ type: "something.odd", payload: {} }).title).toBe("something odd");
    // Another member archived a note or confirmed its plan (audit RUI-09): plain words, not the raw event type.
    expect(describeEvent({ type: "inbox.item_updated", payload: { change: "archived" } })).toMatchObject({ title: "Inbox note archived", tone: "neutral" });
    expect(describeEvent({ type: "inbox.item_updated", payload: { change: "plan_confirmed" } })).toMatchObject({ title: "Plan confirmed", statusWord: "Confirmed", tone: "good" });
    // What a member walled from Finance or the CRM receives: the note without its subject; staff changes in words.
    expect(describeEvent({ type: "inbox.item_created", payload: { inboxItemId: "x", blocksContinue: false } }).title).toBe("New inbox note");
    expect(describeEvent({ type: "membership.changed", payload: { userId: "u", change: "updated" } }).title).toBe("Staff access changed");
    expect(describeEvent({ type: "membership.changed", payload: { userId: "u", change: "removed" } }).title).toBe("Staff member removed");
  });
});
