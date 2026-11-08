/** Builder view's tab registry (founder, 2026-11-08): which tabs it gates and the founder titles shown while it is off. */
import { describe, expect, it } from "vitest";
import { BUILDER_ONLY_TABS, FOUNDER_TAB_TITLES, MODULE_TABS, firstVisibleTab, isBuilderOnlyTab, tabTitleFor, visibleTabs } from "./constants";

const development = { moduleKeys: ["development"], tabs: MODULE_TABS.development.map((t, i) => ({ ...t, position: i })) };
const team = { moduleKeys: ["team"], tabs: MODULE_TABS.team.map((t, i) => ({ ...t, position: i })) };

describe("Builder view tabs", () => {
  it("gates Code, Health and Hierarchy, and every gated or renamed slug is a real module tab", () => {
    expect(BUILDER_ONLY_TABS).toEqual({ development: ["code"], team: ["health", "hierarchy"] });
    for (const [mod, slugs] of Object.entries(BUILDER_ONLY_TABS)) for (const s of slugs ?? []) expect(MODULE_TABS[mod as keyof typeof MODULE_TABS].some((t) => t.slug === s)).toBe(true);
    for (const [mod, map] of Object.entries(FOUNDER_TAB_TITLES)) for (const s of Object.keys(map ?? {})) expect(MODULE_TABS[mod as keyof typeof MODULE_TABS].some((t) => t.slug === s)).toBe(true);
    expect(isBuilderOnlyTab(["development"], "code")).toBe(true);
    expect(isBuilderOnlyTab(["team"], "hierarchy")).toBe(true);
    // A slug is gated only in a department over the module that gates it; without module keys every module is read.
    expect(isBuilderOnlyTab(["finance"], "code")).toBe(false);
    expect(isBuilderOnlyTab(undefined, "health")).toBe(true);
    expect(isBuilderOnlyTab(["development"], "plan")).toBe(false);
  });

  it("off: Development reads Working now · Plan · What changed · Live product · Specialists; Team drops Health and Hierarchy", () => {
    expect(visibleTabs(development, false).map((t) => t.title)).toEqual(["Working now", "Plan", "What changed", "Live product", "Specialists"]);
    expect(visibleTabs(team, false).map((t) => t.slug)).toEqual(["squad", "staff", "responsibilities", "recruitment"]);
  });

  it("on: every tab, with its stored title", () => {
    expect(visibleTabs(development, true).map((t) => t.title)).toEqual(MODULE_TABS.development.map((t) => t.title));
    expect(visibleTabs(team, true)).toHaveLength(MODULE_TABS.team.length);
  });

  it("a founder title applies only while the stored title is still the default, so a rename is kept", () => {
    expect(tabTitleFor(["development"], "training-ground", "Live sessions", false)).toBe("Working now");
    expect(tabTitleFor(["development"], "training-ground", "Build room", false)).toBe("Build room");
    expect(tabTitleFor(["development"], "training-ground", "Live sessions", true)).toBe("Live sessions");
    expect(tabTitleFor(["development"], "plan", "Plan", false)).toBe("Plan");
  });

  it("sorts by position and the first visible tab skips a gated one", () => {
    const codeFirst = { moduleKeys: ["development"], tabs: [{ slug: "plan", title: "Plan", position: 2 }, { slug: "code", title: "Code", position: 0 }, { slug: "pull-requests", title: "Pull requests", position: 1 }] };
    expect(firstVisibleTab(codeFirst, false)).toEqual({ slug: "pull-requests", title: "What changed", position: 1 });
    expect(firstVisibleTab(codeFirst, true)?.slug).toBe("code");
    // Tabs without titles (the sidebar's) are filtered and kept as they are.
    expect(visibleTabs({ tabs: [{ slug: "health", position: 0 }, { slug: "squad", position: 1 }] }, false)).toEqual([{ slug: "squad", position: 1 }]);
    expect(firstVisibleTab({ moduleKeys: ["team"], tabs: [{ slug: "health" }] }, false)).toBeUndefined();
  });
});
