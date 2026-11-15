import { describe, expect, it } from "vitest";
import { ADMIN_ONLY_REASON, EXAMPLE_READ_ONLY_REASON, FULL_ACCESS, accessFor, canOpenDepartment, isExampleViewer, readOnlyReason, sectionOf } from "../access";
import { buildSidebarItems } from "../sidebar";

const BID = "00000000-0000-4000-8000-000000000001";
const membership = (role: string, sectionPermissions: Record<string, string> = {}, source = "invite") => ({ role, sectionPermissions, source }) as never;

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
    expect(readOnlyReason(accessFor(membership("viewer")))).toBe("As a viewer you can follow the business; the founders and the people who work on it make changes.");
    expect(readOnlyReason(accessFor(membership("advisor")))).toContain("an advisor");
    expect(ADMIN_ONLY_REASON).toBe("Only an owner, a cofounder or an admin can do this.");
  });

  it("an example viewer (0065) is a viewer with the example reason; a demo's own members and an invited viewer are not", () => {
    const demo = { isDemo: true };
    const example = accessFor(membership("viewer", {}, "example"), demo);
    expect(example).toMatchObject({ role: "viewer", isExample: true, canChange: false, isAdmin: false });
    expect(example.canRead("finance")).toBe(true);
    expect(example.canWrite("finance")).toBe(false);
    expect(readOnlyReason(example)).toBe(EXAMPLE_READ_ONLY_REASON);
    expect(EXAMPLE_READ_ONLY_REASON).toBe("This is an example business: look around, then start your own.");
    // The viewer role and the example source make an example; a business that is known not to be a demo never does.
    expect(isExampleViewer({ role: "viewer", sectionPermissions: {}, source: "example" }, demo)).toBe(true);
    expect(isExampleViewer({ role: "viewer", sectionPermissions: {}, source: "example" })).toBe(true);
    expect(isExampleViewer({ role: "viewer", sectionPermissions: {}, source: "example" }, { isDemo: false })).toBe(false);
    expect(isExampleViewer({ role: "viewer", sectionPermissions: {}, source: "invite" }, demo)).toBe(false);
    expect(isExampleViewer({ role: "owner", sectionPermissions: {}, source: "founder" }, demo)).toBe(false);
    expect(isExampleViewer(null, demo)).toBe(false);
    expect(accessFor(membership("viewer"), demo).isExample).toBe(false);
    expect(accessFor(membership("owner", {}, "founder"), demo).isExample).toBe(false);
    // The business context reads the membership alone (0065 holds every example row to the viewer role of a demo).
    expect(accessFor(membership("viewer", {}, "example")).isExample).toBe(true);
    expect(FULL_ACCESS.isExample).toBe(false);
  });

  it("the sidebar lists neither a walled department nor a walled CRM", () => {
    const departments = [
      { id: "d1", name: "Finance", slug: "finance", icon: "wallet", colourToken: "dept-1", position: 1, moduleKeys: ["finance"], tabs: [{ slug: "overview", position: 1 }] },
      { id: "d2", name: "Product", slug: "product", icon: "box", colourToken: "dept-2", position: 2, moduleKeys: ["product"], tabs: [{ slug: "vision", position: 1 }] },
    ] as never;
    const labels = (access?: ReturnType<typeof accessFor>) => buildSidebarItems({ businessId: BID, departments, live: false, access }).map((i) => i.label);
    // Areas are listed by what the person may open: Money over Finance, Customers over the CRM (Contacts, a Customers tab).
    // The wall is still the `crm` section.
    expect(labels()).toEqual(expect.arrayContaining(["Money", "Product", "Customers", "Plan"]));
    const member = accessFor(membership("member", { finance: "none", crm: "none" }));
    expect(labels(member)).toEqual(expect.arrayContaining(["Product"]));
    expect(labels(member)).not.toContain("Money");
    expect(labels(member)).not.toContain("Customers");
  });
});
