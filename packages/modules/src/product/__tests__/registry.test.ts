import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared";
import { getModule, getModuleScreen } from "../../registry";
import { productScreens } from "../index";

describe("product module registration", () => {
  it("registers one screen per tab in MODULE_TABS.product, in order, with the shared slugs and titles, then the Site tab", () => {
    const def = getModule("product");
    expect(def).toBeDefined();
    expect(def!.screens).toBe(productScreens);
    // The Site tab is registered but is no default tab: a project gets it only once it has a site (WP-07).
    expect(productScreens.map((s) => [s.tabSlug, s.title])).toEqual([...MODULE_TABS.product.map((t) => [t.slug, t.title]), ["site", "Site"]]);
    expect(MODULE_TABS.product.some((t) => t.slug === "site")).toBe(false);
    expect(typeof getModuleScreen("product", "site")?.Component).toBe("function");
    for (const tab of MODULE_TABS.product) {
      const screen = getModuleScreen("product", tab.slug);
      expect(screen?.moduleKey).toBe("product");
      expect(typeof screen?.Component).toBe("function");
    }
  });

  it("gives the Roadmap tab its board and timeline sub-views and no other tab any", () => {
    expect(getModuleScreen("product", "roadmap")?.subViews?.map((v) => v.slug)).toEqual(["board", "timeline"]);
    for (const slug of ["vision", "specification", "public-page", "changes", "sources", "research"]) expect(getModuleScreen("product", slug)?.subViews).toBeUndefined();
  });
});
