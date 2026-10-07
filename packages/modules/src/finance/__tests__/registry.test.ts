import { describe, expect, it } from "vitest";
import { MODULE_TABS } from "@foundmill/shared";
import { getModule, getModuleScreen } from "../../registry";
import { financeScreens } from "../index";

describe("finance module registration", () => {
  it("registers one screen per tab in MODULE_TABS.finance, in order, with the shared slugs and titles", () => {
    const def = getModule("finance");
    expect(def).toBeDefined();
    expect(def!.screens).toBe(financeScreens);
    expect(financeScreens.map((s) => [s.tabSlug, s.title])).toEqual(MODULE_TABS.finance.map((t) => [t.slug, t.title]));
    expect(financeScreens.map((s) => s.tabSlug)).toEqual(["overview", "pnl", "cash", "runway", "wage-bill", "cap-table"]);
    for (const tab of MODULE_TABS.finance) {
      const screen = getModuleScreen("finance", tab.slug);
      expect(screen?.moduleKey).toBe("finance");
      expect(typeof screen?.Component).toBe("function");
      expect(screen?.subViews).toBeUndefined();
    }
  });
});
