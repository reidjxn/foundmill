import { describe, expect, it } from "vitest";
import { DASHBOARD_PRESET_IDS } from "@foundmill/widgets";
import { dashboardActions, dashboardTabs, editedElsewhere, foundationsForNextStep, ghostedMilestones, gridPresets, isDayOne, isOwnDashboard, nextDashboardName, nextStepFacts, pickDashboardId, resetPresetFor, sameLayout, shareHref, unreadNotes, versionConflict, withContinueAction, type DashboardSummary } from "../dashboards";

const d = (id: string, name: string, extra: Partial<DashboardSummary> = {}): DashboardSummary => ({ id, name, preset: "founder", version: 1, isActive: false, userId: "u1", ...extra });

describe("dashboard tabs", () => {
  it("one tab per own dashboard, hrefs under /home/<id>, and a trailing tab for a co-founder's dashboard", () => {
    const list = [d("a", "Home", { isActive: true }), d("b", "Seller")];
    const tabs = dashboardTabs(list, "biz", d("c", "Investor update", { userId: "u2" }));
    expect(tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(tabs[0]!.href).toBe("/b/biz/home/a");
    expect(tabs[2]!.label).toBe("Shared: Investor update");
    expect(dashboardTabs(list, "biz", list[1]).map((t) => t.label)).toEqual(["Home", "Seller"]);
  });

  it("the unsaved Founder's view of a read-only role is plain Home, not a Shared tab", () => {
    const unsaved = d("00000000-0000-0000-0000-000000000000", "Home", { stored: false });
    const tabs = dashboardTabs([], "biz", unsaved);
    expect(tabs).toEqual([expect.objectContaining({ label: "Home", href: "/b/biz/home" })]);
  });

  it("only a role that writes edits its own dashboard, starts new ones or copies a shared one", () => {
    const own = { stored: true, editable: true };
    expect(dashboardActions(own, { canWrite: true, mine: true })).toEqual({ edit: true, create: true, copy: false });
    // A co-founder's shared dashboard: read-only, and a role that writes can copy it.
    expect(dashboardActions({ stored: true, editable: false }, { canWrite: true, mine: false })).toEqual({ edit: false, create: true, copy: true });
    // Viewers and advisors: no edit, no New, no copy, on their unsaved Home or a shared one.
    expect(dashboardActions({ stored: false, editable: false }, { canWrite: false, mine: false })).toEqual({ edit: false, create: false, copy: false });
    expect(dashboardActions({ stored: true, editable: false }, { canWrite: false, mine: false })).toEqual({ edit: false, create: false, copy: false });
    expect(dashboardActions(null, { canWrite: true, mine: false })).toEqual({ edit: false, create: true, copy: false });
  });

  it("picks the route id, else the active dashboard, else the first", () => {
    const list = [d("a", "Home"), d("b", "Seller", { isActive: true })];
    const shared = "5f2b8c1e-9a4d-4c3b-8e7f-1a2b3c4d5e6f";
    expect(pickDashboardId(shared, list)).toBe(shared);
    expect(pickDashboardId(undefined, list)).toBe("b");
    expect(pickDashboardId(undefined, [d("a", "Home")])).toBe("a");
    expect(pickDashboardId(undefined, [])).toBeUndefined();
  });

  it("names new dashboards without clashing", () => {
    expect(nextDashboardName([], "Builder")).toBe("Builder");
    expect(nextDashboardName(["builder"], "Builder")).toBe("Builder 2");
    expect(nextDashboardName(["Builder", "Builder 2", "Builder 3"], "Builder")).toBe("Builder 4");
  });

  it("builds the share link from the origin", () => {
    expect(shareHref("https://app.example/", "biz", "dash")).toBe("https://app.example/b/biz/home/dash");
  });
});

describe("layout versions (AC-11.2.4)", () => {
  it("a save that returns known + 1 is ours; anything further ahead is a conflict", () => {
    expect(versionConflict(3, 4)).toBe(false);
    expect(versionConflict(3, 5)).toBe(true);
    expect(versionConflict(3, 3)).toBe(false);
  });

  it("a refetch newer than the known version while idle means edited elsewhere", () => {
    expect(editedElsewhere(3, 4, false)).toBe(true);
    expect(editedElsewhere(3, 4, true)).toBe(false);
    expect(editedElsewhere(3, 3, false)).toBe(false);
  });

  it("resets to the dashboard's own preset, else the Founder's view", () => {
    expect(resetPresetFor("seller")).toBe("seller");
    expect(resetPresetFor("made-up")).toBe("founder");
    expect(resetPresetFor(null)).toBe("founder");
  });

  it("exposes every preset to the grid with WidgetGrid-shaped layouts", () => {
    const presets = gridPresets();
    expect(presets.map((p) => p.id)).toEqual([...DASHBOARD_PRESET_IDS]);
    // The Founder's view has a department card for each of the business's departments (a seven-department business too).
    const cards = (n?: number) => gridPresets(n).find((p) => p.id === "founder")!.layout.filter((it) => it.widget === "department_card").length;
    expect([cards(), cards(7), cards(3)]).toEqual([6, 7, 3]);
    for (const p of presets) for (const it of p.layout) expect(it).toMatchObject({ i: expect.any(String), widget: expect.any(String), x: expect.any(Number), y: expect.any(Number) });
  });
});

describe("day one", () => {
  it("is day one only when nothing has converted and no milestone exists", () => {
    expect(isDayOne({ conversions: 0, milestones: 0 })).toBe(true);
    expect(isDayOne({ conversions: 1, milestones: 0 })).toBe(false);
    expect(isDayOne({ conversions: 0, milestones: 2 })).toBe(false);
  });

  it("ghosts every milestone in the business currency", () => {
    const cards = ghostedMilestones("GBP");
    expect(cards).toHaveLength(10);
    // The two early ones lead, each with its own line.
    expect(cards.slice(0, 2).map((c) => [c.key, c.label, c.description])).toEqual([
      ["page_live", "Page live", "Your project's public page went live."],
      ["first_follower", "First follower", "The first person confirmed that they follow your project."],
    ]);
    expect(cards.every((c) => c.achievedAt === null)).toBe(true);
    expect(cards.find((c) => c.key === "customer_1")?.label).toBe("First customer");
    expect(cards.find((c) => c.key === "mrr_1k")?.label).toContain("MRR");
  });

  it("names the day-one milestones in the business's words", () => {
    const cards = ghostedMilestones("GBP", { customer: "client" });
    expect(cards.find((c) => c.key === "customer_1")?.label).toBe("First client");
    expect(cards.find((c) => c.key === "customer_1")?.description).toBe("The first paying client.");
  });
});

describe("day one after commit (audit FR-19, IAE-19, OL-23)", () => {
  it("ends with the first finished round of work, even before any customer", () => {
    expect(isDayOne({ conversions: 0, milestones: 0, cyclesCompleted: 0 })).toBe(true);
    expect(isDayOne({ conversions: 0, milestones: 0, cyclesCompleted: 1 })).toBe(false);
  });

});

describe("the next-step strip's facts (UX plan §6.2 NextStep, §7.8)", () => {
  const cycle = { running: false, paused: false, cycleNumber: null, nextCycleNumber: 1, activeAgentIds: [], completedCount: 0 };

  it("reads the first draft's status as the strip does: pending and drafting are one wait, none is nothing to read", () => {
    expect(foundationsForNextStep("pending")).toBe("drafting");
    expect(foundationsForNextStep("drafting")).toBe("drafting");
    expect(foundationsForNextStep("ready")).toBe("ready");
    expect(foundationsForNextStep("failed")).toBe("failed");
    expect(foundationsForNextStep("none")).toBe("none");
    expect(foundationsForNextStep(undefined)).toBeNull();
    expect(foundationsForNextStep("whatever")).toBeNull();
  });

  it("counts only the team's unopened notes", () => {
    expect(unreadNotes(undefined)).toBe(0);
    expect(unreadNotes([{ state: "unread", fromAgentId: "a" }, { state: "read", fromAgentId: "a" }, { state: "unread", fromAgentId: null }, { state: "unread" }])).toBe(1);
  });

  it("turns the shell's reads into facts: day one, then a running round of work with its agents, then after the first round of work", () => {
    expect(nextStepFacts({ foundationsStatus: "ready", blocking: 2, unread: 2, cycle, distributionStartedAt: null })).toEqual({ foundationsStatus: "ready", blockingNotes: 2, unreadNotes: 2, cycleRunning: false, cycleNumber: 1, agentsWorking: 0, distributionStarted: false, firstCycleDone: false });
    const running = nextStepFacts({ foundationsStatus: "ready", blocking: 0, unread: 0, cycle: { ...cycle, running: true, cycleNumber: 3, activeAgentIds: ["a", "b", "c", "d"], completedCount: 2 }, distributionStartedAt: "2026-10-01T00:00:00.000Z" });
    expect(running).toMatchObject({ cycleRunning: true, cycleNumber: 3, agentsWorking: 4, distributionStarted: true, firstCycleDone: true });
    // A paused cycle is not running for the founder (Continue resumes it): no agents at work, the next number shown.
    expect(nextStepFacts({ foundationsStatus: "ready", blocking: 0, unread: 0, cycle: { ...cycle, running: true, paused: true, cycleNumber: 3, nextCycleNumber: 4, activeAgentIds: ["a"], completedCount: 2 }, distributionStartedAt: null })).toMatchObject({ cycleRunning: false, cycleNumber: 4, agentsWorking: 0 });
    // No cycle read yet: nothing is running and nothing is done.
    expect(nextStepFacts({ foundationsStatus: "ready", blocking: -1, unread: 0, cycle: undefined, distributionStartedAt: null })).toMatchObject({ blockingNotes: 0, cycleRunning: false, cycleNumber: 1, firstCycleDone: false });
  });

  it("gives Press Continue its action and leaves every other row as it is", () => {
    const onGo = () => {};
    const steps = withContinueAction([{ id: "read-draft", label: "Read", href: "/v" }, { id: "press-continue", label: "Press Continue" }, { id: "press-continue", label: "Round of work 1 is running", done: true }], onGo);
    expect(steps[0]).toEqual({ id: "read-draft", label: "Read", href: "/v" });
    expect(steps[1]).toEqual({ id: "press-continue", label: "Press Continue", onGo });
    expect(steps[2]!.onGo).toBeUndefined();
  });
});

describe("own dashboards (audit RUI-12: a first Home created on read)", () => {
  it("is the viewer's own by owner even when the cached list does not hold it yet", () => {
    const created = d("new", "Home", { userId: "me" });
    expect(isOwnDashboard(created, [], "me")).toBe(true);
    expect(isOwnDashboard(created, [], "someone-else")).toBe(false);
    expect(isOwnDashboard(created, [], null)).toBe(false);
    expect(isOwnDashboard(created, [created], null)).toBe(true);
  });

  it("labels it Home, not 'Shared: Home'", () => {
    const created = d("new", "Home", { userId: "me" });
    expect(dashboardTabs([], "biz", created, "me").map((t) => t.label)).toEqual(["Home"]);
    expect(dashboardTabs([], "biz", d("c", "Investor update", { userId: "u2" }), "me").map((t) => t.label)).toEqual(["Shared: Investor update"]);
  });
});

describe("route ids (audit WEB-14)", () => {
  it("ignores an address segment that is not an id, so it never reaches the API", () => {
    const list = [d("a", "Home", { isActive: true })];
    expect(pickDashboardId("not-a-uuid", list)).toBe("a");
    expect(pickDashboardId("00000000-0000-4000-8000-000000000000", list)).toBe("00000000-0000-4000-8000-000000000000");
  });
});

describe("layout saves (audit WEB-09)", () => {
  it("treats the same widgets in the same places as nothing to save, whatever the order", () => {
    const a = [
      { i: "w1", widget: "journey_ribbon", x: 0, y: 0, w: 12, h: 3, settings: {} },
      { i: "w2", widget: "team_pulse", x: 0, y: 3, w: 6, h: 3, settings: {} },
    ];
    expect(sameLayout(a, [...a].reverse())).toBe(true);
    expect(sameLayout(a, a.slice(1))).toBe(false);
    expect(sameLayout(a, [{ ...a[0]!, y: 1 }, a[1]!])).toBe(false);
  });
});
