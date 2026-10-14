/** Links between module screens follow the department that holds the module (audit #192). */
import { describe, expect, it } from "vitest";
import { moduleTabHref } from "../shared/departments";
import { BID, departments } from "./fixtures";

describe("moduleTabHref", () => {
  const finance = departments.find((d) => d.slug === "finance")!;

  it("goes to the department that holds the module now, never to a fixed slug", () => {
    // Legal was merged into Finance: the old /d/legal slug is gone, the link follows the module.
    const merged = departments.filter((d) => d.slug !== "legal").map((d) => (d.id === finance.id ? { ...d, moduleKeys: [...d.moduleKeys, "legal" as const], tabs: [...d.tabs, { id: "t-entity", slug: "entity", title: "Entity", position: 9 }] } : d));
    expect(moduleTabHref(BID, merged, "legal", "entity")).toBe(`/b/${BID}/d/finance/entity`);
  });

  it("lands on the holder's first tab when it has no tab of that name", () => {
    const first = finance.tabs.slice().sort((a, b) => a.position - b.position)[0]!;
    const merged = departments.filter((d) => d.slug !== "legal").map((d) => (d.id === finance.id ? { ...d, moduleKeys: [...d.moduleKeys, "legal" as const] } : d));
    expect(moduleTabHref(BID, merged, "legal", "nope")).toBe(`/b/${BID}/d/finance/${first.slug}`);
  });

  it("uses the module's own key before the departments load, which the department screen forwards", () => {
    expect(moduleTabHref(BID, undefined, "legal", "entity")).toBe(`/b/${BID}/d/legal/entity`);
  });
});
