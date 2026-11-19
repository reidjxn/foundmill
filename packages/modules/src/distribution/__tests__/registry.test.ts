import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared";
import { getModule, getModuleScreen } from "../../registry";
import { distributionScreens } from "../index";

describe("distribution module registration", () => {
  it("registers one screen per tab in MODULE_TABS.distribution, in order, with the shared slugs and titles", () => {
    const def = getModule("distribution");
    expect(def).toBeDefined();
    expect(def!.screens).toBe(distributionScreens);
    expect(distributionScreens.map((s) => [s.tabSlug, s.title])).toEqual(MODULE_TABS.distribution.map((t) => [t.slug, t.title]));
    expect(distributionScreens.map((s) => s.tabSlug)).toEqual(["first-ten", "formation", "channels", "leads", "campaigns", "creative", "attribution"]);
    for (const tab of MODULE_TABS.distribution) {
      const screen = getModuleScreen("distribution", tab.slug);
      expect(screen?.moduleKey).toBe("distribution");
      expect(typeof screen?.Component).toBe("function");
      expect(screen?.subViews).toBeUndefined();
    }
  });
});
