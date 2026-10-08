import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared";
import { getModule, getModuleScreen } from "../../registry";
import { developmentScreens } from "../index";

describe("development module registration", () => {
  it("registers one screen per MODULE_TABS.development tab, in order, with the shared slugs and titles", () => {
    const def = getModule("development");
    expect(def).toBeDefined();
    expect(def?.screens).toBe(developmentScreens);
    expect(developmentScreens.map((s) => s.tabSlug)).toEqual(MODULE_TABS.development.map((t) => t.slug));
    expect(developmentScreens.map((s) => s.title)).toEqual(MODULE_TABS.development.map((t) => t.title));
    for (const s of developmentScreens) {
      expect(s.moduleKey).toBe("development");
      expect(typeof s.Component).toBe("function");
    }
  });

  it("looks up every tab through getModuleScreen", () => {
    for (const tab of MODULE_TABS.development) expect(getModuleScreen("development", tab.slug)?.title).toBe(tab.title);
    expect(getModuleScreen("development", "match-day")).toBeUndefined();
  });

  it("gives the Live sessions its Tiles / Formation sub-views", () => {
    expect(getModuleScreen("development", "training-ground")?.subViews?.map((v) => v.slug)).toEqual(["tiles", "formation"]);
    expect(getModuleScreen("development", "plan")?.subViews).toBeUndefined();
  });

  it("uses no pitch-only vocabulary in titles", () => {
    for (const s of developmentScreens) expect(s.title).not.toMatch(/match day|kick-off|pitch|trophy|season|league table/i);
  });
});
