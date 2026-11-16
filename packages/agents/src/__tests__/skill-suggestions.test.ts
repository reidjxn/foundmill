/**
 * The skill picker's suggestions (WP-06 T7): the library skills whose `roles` hold the agent's template, those that fit
 * the project's stage first. Chosen locally from the catalog, never by a model call.
 */
import { describe, expect, it } from "vitest";
import { SKILL_LIBRARY, suggestFor } from "../skill-library";

describe("suggestFor", () => {
  it("suggests exactly the skills whose roles hold the template", () => {
    const keys = suggestFor("product_lead", "building");
    expect(keys).toContain("project_page_copy");
    expect(new Set(keys)).toEqual(new Set(SKILL_LIBRARY.filter((s) => s.roles.includes("product_lead")).map((s) => s.key)));
  });

  it("puts the skills that fit the stage first, in catalog order within each part", () => {
    const keys = suggestFor("product_lead", "drafting");
    const fits = (k: string) => SKILL_LIBRARY.find((s) => s.key === k)!.stages.includes("drafting");
    const firstMiss = keys.findIndex((k) => !fits(k));
    expect(firstMiss).toBeGreaterThan(0);
    expect(keys.slice(firstMiss).every((k) => !fits(k))).toBe(true);
    // project_page_copy fits building and selling, not drafting: it comes after every skill that fits drafting.
    expect(fits("project_page_copy")).toBe(false);
    expect(keys.indexOf("project_page_copy")).toBeGreaterThanOrEqual(firstMiss);
  });

  it("suggests nothing for a template no skill lists", () => {
    expect(suggestFor("no_such_template", "building")).toEqual([]);
  });
});
