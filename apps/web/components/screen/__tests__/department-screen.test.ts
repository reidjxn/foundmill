import { describe, expect, it } from "vitest";
import "@foundmill/modules";
import { moduleKeyFor, moduleScreenFor, parseModuleWidgetKey, relocatedModuleHref } from "../DepartmentScreen";

describe("department screen layouts", () => {
  it("parses module widget keys", () => {
    expect(parseModuleWidgetKey("module:finance/overview")).toEqual({ moduleKey: "finance", tabSlug: "overview" });
    expect(parseModuleWidgetKey("module:nope/overview")).toBeNull();
    expect(parseModuleWidgetKey("journey_ribbon")).toBeNull();
    expect(parseModuleWidgetKey("module:finance")).toBeNull();
  });

  it("renders a module full-screen only when it is the layout's single widget", () => {
    expect(moduleScreenFor({ widgets: [{ key: "module:finance/overview" }] })?.tabSlug).toBe("overview");
    expect(moduleScreenFor({ widgets: [{ key: "module:development/training-ground" }] })?.moduleKey).toBe("development");
    expect(moduleScreenFor({ widgets: [{ key: "module:finance/overview" }, { key: "status_strip" }] })).toBeNull();
    expect(moduleScreenFor({ widgets: [{ key: "module:finance/not-a-tab" }] })).toBeNull();
    expect(moduleScreenFor(null)).toBeNull();
  });

  it("follows a module to the department that holds it after a merge (an old /d/legal/entity link)", () => {
    const finance = { id: "f", name: "Finance", slug: "finance", colourToken: "dept-4" as const, position: 0, moduleKeys: ["finance", "legal"], lead: null, squad: [], tabs: [{ id: "t1", slug: "overview", title: "Overview", position: 0 }, { id: "t2", slug: "entity", title: "Entity", position: 5 }] };
    expect(relocatedModuleHref("b1", [finance], "legal", "entity")).toBe("/b/b1/d/finance/entity");
    // A tab the holder does not have lands on its first tab rather than nowhere.
    expect(relocatedModuleHref("b1", [finance], "legal", "nope")).toBe("/b/b1/d/finance/overview");
    // Not a module key, or nobody holds the module: no redirect ("No such department").
    expect(relocatedModuleHref("b1", [finance], "growth", "entity")).toBeNull();
    expect(relocatedModuleHref("b1", [finance], "team", "squad")).toBeNull();
  });

  it("names the module pack a layout needs before that pack has loaded", () => {
    expect(moduleKeyFor({ widgets: [{ key: "module:legal/entity" }] })).toBe("legal");
    expect(moduleKeyFor({ widgets: [{ key: "module:finance/not-a-tab" }] })).toBe("finance");
    expect(moduleKeyFor({ widgets: [{ key: "module:finance/overview" }, { key: "status_strip" }] })).toBeNull();
    expect(moduleKeyFor({ widgets: [{ key: "journey_ribbon" }] })).toBeNull();
    expect(moduleKeyFor(undefined)).toBeNull();
  });
});
