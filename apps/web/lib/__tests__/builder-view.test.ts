/**
 * Builder view in the shell's own wiring (docs/DESIGN.md "Builder view"): department links never land on a Builder
 * view tab while it is off, search and the palette offer only the tabs a person sees (engine tabs under the founder's
 * names), the checklist names no cycle number, and the connection chip says only "Updates may be late".
 */
import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared/constants";
import { buildSidebarItems, departmentHref, type SidebarDepartment } from "../sidebar";
import { localPaletteItems } from "../search";
import { LATE_NOTICE_MS, CONNECTION_GRACE_MS } from "../stream-status";
import { generatePaletteItems } from "@/components/conversation/palette";
import { nextStepFacts } from "@/components/home/dashboards";
import { shellConnection } from "@/components/shell/BusinessShell";
import { builderViewTabTitles } from "@/components/settings/DepartmentsTab";

const BID = "b1";
const devTabs = MODULE_TABS.development.map((t, i) => ({ ...t, position: i }));
const teamTabs = MODULE_TABS.team.map((t, i) => ({ ...t, position: i }));
// Code first: a founder who reordered tabs must still never land on it while Builder view is off.
const codeFirst = devTabs.map((t) => (t.slug === "code" ? { ...t, position: -1 } : t));
const dev: SidebarDepartment & { tabs: typeof devTabs } = { id: "d-dev", name: "Development", slug: "development", colourToken: "dept-2", position: 0, moduleKeys: ["development"], tabs: codeFirst };
const team: SidebarDepartment & { tabs: typeof teamTabs } = { id: "d-team", name: "Team", slug: "team", colourToken: "dept-6", position: 1, moduleKeys: ["team"], tabs: teamTabs };

describe("department links", () => {
  it("skip a Builder view tab while off, and keep it first while on", () => {
    expect(departmentHref(BID, dev)).toBe(`/b/${BID}/d/development/training-ground`);
    expect(departmentHref(BID, dev, true)).toBe(`/b/${BID}/d/development/code`);
    const items = buildSidebarItems({ businessId: BID, departments: [dev, team], live: false });
    // The Product area opens on its first inline tab (What changed), never on Code while off; with Builder view on every tab is inline, Code first.
    expect(items.find((i) => i.id === "area-product")?.href).toBe(`/b/${BID}/d/development/pull-requests`);
    expect(buildSidebarItems({ businessId: BID, departments: [dev, team], live: false, builder: true }).find((i) => i.id === "area-product")?.href).toBe(`/b/${BID}/d/development/code`);
  });
});

describe("search and the palette", () => {
  it("off: no Code, Health or Hierarchy row, and the engine tabs carry the founder's names", () => {
    const items = localPaletteItems({ businessId: BID, departments: [dev, team], live: false });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Product · Working now");
    expect(labels).toContain("Product · What changed");
    expect(labels).toContain("Product · Live product");
    for (const l of ["Product · Code", "Team · Health", "Team · Hierarchy", "Product · Live sessions", "Product · Pull requests"]) expect(labels).not.toContain(l);
    expect(items.some((i) => /\/(code|health|hierarchy)$/.test(i.href ?? ""))).toBe(false);
    expect(items.find((i) => i.id === "department:d-dev")?.href).toBe(`/b/${BID}/d/development/training-ground`);
  });

  it("on: every tab under its stored title", () => {
    const labels = localPaletteItems({ businessId: BID, departments: [dev, team], live: false, builder: true }).map((i) => i.label);
    for (const l of ["Product · Code", "Team · Health", "Team · Hierarchy", "Product · Live sessions", "Product · Pull requests"]) expect(labels).toContain(l);
  });

  it("the Generate rows name the department's tab as the person reads it", () => {
    const deps = [{ ...dev, moduleKeys: ["development"], squad: [], lead: null }];
    expect(generatePaletteItems(BID, deps).find((r) => r.id === "generate:task-graph")?.description).toContain("Product › Work list");
  });
});

describe("the first-week checklist", () => {
  it("off: no round of work number in the facts", () => {
    const cycle = { running: true, cycleNumber: 3, activeAgentIds: ["a"], completedCount: 2 };
    expect(nextStepFacts({ foundationsStatus: "ready", blocking: 0, unread: 0, cycle, distributionStartedAt: null, builder: false }).cycleNumber).toBeNull();
    expect(nextStepFacts({ foundationsStatus: "ready", blocking: 0, unread: 0, cycle, distributionStartedAt: null, builder: true }).cycleNumber).toBe(3);
  });
});

describe("the connection chip", () => {
  it("off: either trouble reads 'Updates may be late', and only after a long outage", () => {
    expect(shellConnection(null, false)).toBeNull();
    expect(shellConnection("reconnecting", false)?.state).toBe("late");
    expect(shellConnection("paused", false)?.state).toBe("late");
    expect(shellConnection("reconnecting", true)?.state).toBe("reconnecting");
    expect(shellConnection("paused", true)?.state).toBe("paused");
    expect(LATE_NOTICE_MS).toBe(30_000);
    expect(LATE_NOTICE_MS).toBeGreaterThan(CONNECTION_GRACE_MS);
  });
});

describe("Settings › Departments", () => {
  it("names the tabs only Builder view shows", () => {
    expect(builderViewTabTitles(dev)).toEqual(["Code"]);
    expect(builderViewTabTitles(team)).toEqual(["Health", "Hierarchy"]);
    expect(builderViewTabTitles({ moduleKeys: ["finance"], tabs: [{ slug: "overview", title: "Overview", position: 0 }] as never })).toEqual([]);
  });
});
