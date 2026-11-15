/**
 * The founder areas in apps/web (docs/DESIGN.md §8–§9): area tab bars on department routes, /crm and /milestones,
 * breadcrumbs, the "<area> › <tab>" copy, search rows and Settings › Departments' placement lines.
 */
import { describe, expect, it } from "vitest";
import { MODULE_TABS, type ModuleKey } from "@foundmill/shared/constants";
import { accessFor } from "../access";
import { areaBreadcrumbs, areaHref, areaNav, areaOfRoute, areaOpeningOf, areaTabId, areaTabItems, areaTabLabel } from "../areas";
import { filterLocal, localPaletteItems } from "../search";
import { tabPlacementLines } from "@/components/settings/DepartmentsTab";

const BID = "b1";

function dept(id: string, name: string, slug: string, position: number, moduleKeys: ModuleKey[], tabSlugs?: string[]) {
  const all = moduleKeys.flatMap((k) => MODULE_TABS[k]);
  const tabs = (tabSlugs ? tabSlugs.map((s) => all.find((t) => t.slug === s)!) : all).map((t, i) => ({ slug: t.slug, title: t.title, position: i }));
  return { id, name, slug, colourToken: "dept-1" as const, position, hidden: false, moduleKeys, tabs };
}

const NORTHWIND = [
  dept("d-prod", "Product", "product", 0, ["product"]),
  dept("d-dev", "Development", "development", 1, ["development"]),
  dept("d-ops", "Formulation Lab", "operations", 2, ["development"], ["specialists", "plan"]),
  dept("d-retail", "Retail Partnerships", "distribution", 3, ["distribution"]),
  dept("d-fin", "Finance", "finance", 4, ["finance"]),
  dept("d-team", "Team", "team", 5, ["team"]),
  dept("d-legal", "Legal", "legal", 6, ["legal"]),
];

describe("area tab bars", () => {
  it("Northwind's Product bar spans three departments; ids are dept/tab and each links to its own department", () => {
    const product = areaNav({ businessId: BID, departments: NORTHWIND }).get("product")!;
    const items = areaTabItems(BID, product);
    expect(items.filter((t) => t.tier === "default").map((t) => t.label)).toEqual(["Specification", "Public page", "What changed", "Live product", "Specialists · Formulation Lab"]);
    expect(items.find((t) => t.id === areaTabId("operations", "specialists"))).toMatchObject({ href: "/b/b1/d/operations/specialists", tier: "default" });
    expect(items.find((t) => t.id === "development/specialists")).toMatchObject({ label: "Specialists · Development", tier: "detail" });
    // Builder view: every tab inline, Code included.
    const builder = areaTabItems(BID, areaNav({ businessId: BID, departments: NORTHWIND, builder: true }).get("product")!);
    expect(builder.every((t) => t.tier === "default")).toBe(true);
    expect(builder.some((t) => t.id === "development/code")).toBe(true);
  });

  it("Plan holds Roadmap and Milestones, Customers holds Contacts; a walled CRM drops Contacts", () => {
    const nav = areaNav({ businessId: BID, departments: NORTHWIND });
    expect(areaTabItems(BID, nav.get("plan")!).map((t) => [t.label, t.href])).toEqual([
      ["Roadmap", "/b/b1/d/product/roadmap"],
      ["Milestones", "/b/b1/milestones"],
    ]);
    expect(areaTabItems(BID, nav.get("customers")!).filter((t) => t.tier === "default").map((t) => t.label)).toEqual(["Leads", "Campaigns", "Contacts"]);
    const walled = areaNav({ businessId: BID, departments: NORTHWIND, access: accessFor({ role: "member", sectionPermissions: { crm: "none", distribution: "none" } } as never) });
    expect(walled.has("customers")).toBe(false);
    expect(areaHref(BID, nav.get("money")!)).toBe("/b/b1/d/finance/overview");
  });

  it("breadcrumbs read Product › Formulation Lab; the route's area follows the tab's module", () => {
    const ops = NORTHWIND[2]!;
    expect(areaOfRoute(ops, "specialists")).toBe("product");
    expect(areaOfRoute(NORTHWIND[0], "roadmap")).toBe("plan");
    expect(areaOfRoute(NORTHWIND[6], "entity")).toBe("money");
    expect(areaOfRoute({ moduleKeys: [] }, "notes")).toBeNull();
    const product = areaNav({ businessId: BID, departments: NORTHWIND }).get("product")!;
    expect(areaBreadcrumbs(BID, "product", product, ops.name)).toEqual([{ label: "Product", href: "/b/b1/d/product/specification" }, { label: "Formulation Lab" }]);
    expect(areaTabLabel({ area: "customers", title: "Leads" })).toBe("Customers › Leads");
  });
});

describe("search and the palette", () => {
  it("offers each area with its chord and every tab under its area, More detail and the department name included", () => {
    const items = localPaletteItems({ businessId: BID, departments: NORTHWIND, live: false });
    expect(items.filter((i) => i.id.startsWith("area:")).map((i) => `${i.label} ${i.shortcut?.join(" ")}`)).toEqual(["Plan G P", "Customers G C", "Money G M", "Product G R", "Team G T"]);
    expect(items.find((i) => i.id === "screen:d-ops:specialists")).toMatchObject({ label: "Product · Specialists · Formulation Lab", description: "Formulation Lab", href: "/b/b1/d/operations/specialists" });
    expect(items.find((i) => i.id === "screen:d-retail:attribution")?.label).toBe("Customers · Attribution");
    expect(items.find((i) => i.id === "screen:d-legal:entity")?.label).toBe("Money · Company");
    // The department's own name still finds its tabs.
    expect(filterLocal(items, "retail partnerships").some((i) => i.id === "screen:d-retail:leads")).toBe(true);
  });
});

describe("Settings › Departments", () => {
  it("says where each department's tabs show: their area, inline or More detail", () => {
    expect(tabPlacementLines(NORTHWIND[0]!)).toEqual(["Plan: Roadmap", "Product: Specification, Public page · More detail: Vision, Changes, Sources, Research"]);
    expect(tabPlacementLines(NORTHWIND[2]!)).toEqual(["Product: Specialists · More detail: Work list"]);
    expect(tabPlacementLines(NORTHWIND[6]!)).toEqual(["Money: Company, Compliance · More detail: Incorporate, Contracts, IP, Policies, Regulatory"]);
    expect(tabPlacementLines({ id: "x", name: "Studio", slug: "studio", position: 0, moduleKeys: [], tabs: [] })).toEqual(["Its own sidebar item"]);
  });
});

describe("the opening line on department routes", () => {
  it("reads the area, the department for the kind line and the Company section", () => {
    const [product, , lab, retail, , , legal] = NORTHWIND;
    expect(areaOpeningOf(lab, "specialists", "product", true)).toEqual({ area: "product", departmentName: "Formulation Lab", section: null });
    expect(areaOpeningOf(retail, "leads", "customers", true)).toEqual({ area: "customers", departmentName: "Retail Partnerships", section: null });
    expect(areaOpeningOf(legal, "entity", "money", true)).toEqual({ area: "money", departmentName: "Legal", section: "company" });
    expect(areaOpeningOf(product, "roadmap", areaOfRoute(product, "roadmap"), true)).toEqual({ area: "plan", departmentName: "Product", section: null });
  });

  it("has none for a department the area does not list (no modules, hidden, unknown)", () => {
    expect(areaOpeningOf({ name: "Studio", moduleKeys: [] }, "notes", null, false)).toBeNull();
    expect(areaOpeningOf(NORTHWIND[0], "vision", "product", false)).toBeNull();
    expect(areaOpeningOf(undefined, "vision", "product", true)).toBeNull();
  });
});
