import { describe, expect, it } from "vitest";
import { DASHBOARD_PRESET_IDS } from "@foundmill/widgets";
import { dashboardTabs, editedElsewhere, ghostedMilestones, gridPresets, isDayOne, nextDashboardName, pickDashboardId, resetPresetFor, shareHref, versionConflict, type DashboardSummary } from "../dashboards";

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

  it("picks the route id, else the active dashboard, else the first", () => {
    const list = [d("a", "Home"), d("b", "Seller", { isActive: true })];
    expect(pickDashboardId("z", list)).toBe("z");
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
    expect(cards).toHaveLength(8);
    expect(cards.every((c) => c.achievedAt === null)).toBe(true);
    expect(cards.find((c) => c.key === "customer_1")?.label).toBe("First customer");
    expect(cards.find((c) => c.key === "mrr_1k")?.label).toContain("MRR");
  });
});
