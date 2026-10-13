import { describe, expect, it } from "vitest";
import { ADMIN_ONLY_REASON, FULL_ACCESS, accessFor, canOpenDepartment, readOnlyReason, sectionOf } from "../access";
import { buildSidebarItems } from "../sidebar";

const BID = "00000000-0000-4000-8000-000000000001";
const membership = (role: string, sectionPermissions: Record<string, string> = {}) => ({ role, sectionPermissions }) as never;

describe("access (audit RUI-05: the app followed only isAdmin)", () => {
  it("owners, admins and members change things; viewers and advisors only read", () => {
    expect(accessFor(membership("owner")).canChange).toBe(true);
    expect(accessFor(membership("member")).canChange).toBe(true);
    expect(accessFor(membership("member")).isAdmin).toBe(false);
    expect(accessFor(membership("admin")).isAdmin).toBe(true);
    for (const role of ["viewer", "advisor"]) {
      const a = accessFor(membership(role));
      expect(a.canChange).toBe(false);
      expect(a.canWrite("finance")).toBe(false);
    }
  });

  it("follows the section map: 'none' hides a section, 'read' reads without writing", () => {
    const a = accessFor(membership("member", { finance: "none", crm: "read" }));
    expect(a.canRead("finance")).toBe(false);
    expect(a.canRead("crm")).toBe(true);
    expect(a.canWrite("crm")).toBe(false);
    expect(a.canWrite("product")).toBe(true);
  });

  it("allows everything before the membership has loaded", () => {
    expect(accessFor(null)).toBe(FULL_ACCESS);
    expect(FULL_ACCESS.canRead("finance")).toBe(true);
  });

  it("maps module keys to sections, and leaves custom modules open", () => {
    expect(sectionOf("finance")).toBe("finance");
    expect(sectionOf("my_custom_module")).toBeNull();
    const walled = accessFor(membership("member", { finance: "none", crm: "none" }));
    expect(canOpenDepartment(walled, { moduleKeys: ["finance"] })).toBe(false);
    expect(canOpenDepartment(walled, { moduleKeys: ["finance", "legal"] })).toBe(true);
    expect(canOpenDepartment(walled, { moduleKeys: ["finance", "my_custom_module"] })).toBe(true);
    expect(canOpenDepartment(walled, { moduleKeys: [] })).toBe(true);
  });

  it("says why a control is off in plain words", () => {
    expect(readOnlyReason(accessFor(membership("viewer")))).toBe("As a viewer you can follow the business; an owner, admin or member makes changes.");
    expect(readOnlyReason(accessFor(membership("advisor")))).toContain("an advisor");
    expect(ADMIN_ONLY_REASON).toBe("Only an owner or admin can do this.");
  });

  it("the sidebar lists neither a walled department nor a walled CRM", () => {
    const departments = [
      { id: "d1", name: "Finance", slug: "finance", icon: "wallet", colourToken: "dept-1", position: 1, moduleKeys: ["finance"], tabs: [{ slug: "overview", position: 1 }] },
      { id: "d2", name: "Product", slug: "product", icon: "box", colourToken: "dept-2", position: 2, moduleKeys: ["product"], tabs: [{ slug: "vision", position: 1 }] },
    ] as never;
    const labels = (access?: ReturnType<typeof accessFor>) => buildSidebarItems({ businessId: BID, departments, live: false, access }).map((i) => i.label);
    expect(labels()).toEqual(expect.arrayContaining(["Finance", "Product", "CRM"]));
    const member = accessFor(membership("member", { finance: "none", crm: "none" }));
    expect(labels(member)).toEqual(expect.arrayContaining(["Product"]));
    expect(labels(member)).not.toContain("Finance");
    expect(labels(member)).not.toContain("CRM");
  });
});
