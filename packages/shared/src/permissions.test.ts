import { describe, expect, it } from "vitest";
import { effectivePermission, hasSectionAccess, planActionSection, planSectionWalls } from "./permissions";

describe("section permissions (BUILD §11.9)", () => {
  it("owners are never restricted; an explicit entry wins for everyone else; the role sets the default", () => {
    expect(effectivePermission({ role: "owner", sectionPermissions: { finance: "none" } }, "finance")).toBe("write");
    expect(effectivePermission({ role: "member", sectionPermissions: { finance: "none" } }, "finance")).toBe("none");
    expect(effectivePermission({ role: "member", sectionPermissions: {} }, "product")).toBe("write");
    expect(effectivePermission({ role: "viewer", sectionPermissions: {} }, "product")).toBe("read");
  });
  it("writing also needs a write role: an explicit write never lets a viewer or an advisor change anything", () => {
    expect(hasSectionAccess({ role: "viewer", sectionPermissions: { product: "write" } }, "product", "write")).toBe(false);
    expect(hasSectionAccess({ role: "advisor", sectionPermissions: {} }, "product", "read")).toBe(true);
    expect(hasSectionAccess({ role: "member", sectionPermissions: { product: "read" } }, "product", "write")).toBe(false);
    expect(hasSectionAccess({ role: "member", sectionPermissions: { product: "none" } }, "product", "read")).toBe(false);
    expect(hasSectionAccess({ role: "admin", sectionPermissions: {} }, "crm", "write")).toBe(true);
  });
  it("a plan action changes the section its own screen writes; a reply or a founder task needs none", () => {
    expect(planActionSection({ type: "set_budget", params: { channel: "paid_ads" } })).toBe("distribution");
    expect(planActionSection({ type: "set_budget", params: { scope: "department", department: "growth" } })).toBe("finance");
    expect(planActionSection({ type: "create_task", params: { kind: "code" } })).toBe("development");
    expect(planActionSection({ type: "create_task", params: { kind: "ops" } })).toBeNull();
    expect(planActionSection({ type: "request_human_action" })).toBeNull();
    const admin = { role: "admin" as const, sectionPermissions: { distribution: "read" as const } };
    expect(planSectionWalls(admin, [{ type: "enable_channel", params: { channel: "seo" } }, { type: "set_budget", params: { channel: "seo" } }, { type: "reply_only" }])).toEqual([{ section: "distribution", actionTypes: ["enable_channel", "set_budget"] }]);
    expect(planSectionWalls({ role: "owner", sectionPermissions: { distribution: "none" } }, [{ type: "enable_channel", params: { channel: "seo" } }])).toEqual([]);
  });
});
