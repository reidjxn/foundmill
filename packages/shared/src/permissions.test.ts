import { describe, expect, it } from "vitest";
import { effectivePermission, hasSectionAccess } from "./permissions";

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
});
