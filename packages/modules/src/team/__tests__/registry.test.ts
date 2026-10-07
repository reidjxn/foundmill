import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared";
import { getModule, getModuleScreen } from "../../registry";
import { teamScreens } from "../index";

describe("team module registration", () => {
  it("registers one screen per tab in MODULE_TABS.team, in order, with the shared slugs and titles", () => {
    const def = getModule("team");
    expect(def).toBeDefined();
    expect(def!.screens).toBe(teamScreens);
    expect(teamScreens.map((s) => [s.tabSlug, s.title])).toEqual(MODULE_TABS.team.map((t) => [t.slug, t.title]));
    expect(teamScreens.map((s) => s.tabSlug)).toEqual(["squad", "staff", "responsibilities", "health", "hierarchy", "recruitment"]);
    for (const tab of MODULE_TABS.team) {
      const screen = getModuleScreen("team", tab.slug);
      expect(screen?.moduleKey).toBe("team");
      expect(typeof screen?.Component).toBe("function");
      expect(screen?.subViews).toBeUndefined();
    }
  });
});
