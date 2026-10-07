import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared";
import { getModule, getModuleScreen } from "../../registry";
import { productScreens } from "../index";

describe("product module registration", () => {
  it("registers one screen per tab in MODULE_TABS.product, in order, with the shared slugs and titles", () => {
    const def = getModule("product");
    expect(def).toBeDefined();
    expect(def!.screens).toBe(productScreens);
    expect(productScreens.map((s) => [s.tabSlug, s.title])).toEqual(MODULE_TABS.product.map((t) => [t.slug, t.title]));
    for (const tab of MODULE_TABS.product) {
      const screen = getModuleScreen("product", tab.slug);
      expect(screen?.moduleKey).toBe("product");
      expect(typeof screen?.Component).toBe("function");
    }
  });

  it("gives the Roadmap tab its board and timeline sub-views and no other tab any", () => {
    expect(getModuleScreen("product", "roadmap")?.subViews?.map((v) => v.slug)).toEqual(["board", "timeline"]);
    for (const slug of ["vision", "specification", "changes", "sources", "research"]) expect(getModuleScreen("product", slug)?.subViews).toBeUndefined();
  });
});
