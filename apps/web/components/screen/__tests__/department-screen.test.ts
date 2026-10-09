import { describe, expect, it } from "vitest";
import "@foundmill/modules";
import { moduleKeyFor, moduleScreenFor, parseModuleWidgetKey } from "../DepartmentScreen";

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

  it("names the module pack a layout needs before that pack has loaded", () => {
    expect(moduleKeyFor({ widgets: [{ key: "module:legal/entity" }] })).toBe("legal");
    expect(moduleKeyFor({ widgets: [{ key: "module:finance/not-a-tab" }] })).toBe("finance");
    expect(moduleKeyFor({ widgets: [{ key: "module:finance/overview" }, { key: "status_strip" }] })).toBeNull();
    expect(moduleKeyFor({ widgets: [{ key: "journey_ribbon" }] })).toBeNull();
    expect(moduleKeyFor(undefined)).toBeNull();
  });
});
