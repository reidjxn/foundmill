import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared";
import { getModule, getModuleScreen } from "../../registry";
import { legalScreens } from "../index";

describe("legal module registration", () => {
  it("registers one screen per tab in MODULE_TABS.legal, in order, with the shared slugs and titles", () => {
    const def = getModule("legal");
    expect(def).toBeDefined();
    expect(def!.screens).toBe(legalScreens);
    expect(legalScreens.map((s) => [s.tabSlug, s.title])).toEqual(MODULE_TABS.legal.map((t) => [t.slug, t.title]));
    expect(legalScreens.map((s) => s.tabSlug)).toEqual(["entity", "incorporate", "compliance", "contracts", "ip", "policies", "regulatory"]);
    for (const tab of MODULE_TABS.legal) {
      const screen = getModuleScreen("legal", tab.slug);
      expect(screen?.moduleKey).toBe("legal");
      expect(typeof screen?.Component).toBe("function");
    }
    expect(getModuleScreen("legal", "compliance")?.subViews?.map((v) => v.slug)).toEqual(["list", "calendar"]);
    expect(getModuleScreen("legal", "entity")?.subViews).toBeUndefined();
  });
});
