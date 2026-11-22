/** Founder areas (docs/DESIGN.md §8–§9): a mapping over module tabs, tiers, the promotion rule and Builder view. */
import { describe, expect, it } from "vitest";
import { AREA_KEYS, AREA_LETTERS, MODULE_AREA, TAB_REVEAL, TEAM_CALL_REVEAL, areaLanding, areaOfTab, areaTabs, areaTabsByArea, departmentArea, moduleLessDepartments, sectionOfTab, tabRevealed, type AreaDepartment, type StageFacts } from "./areas";
import { DEFAULT_TABS, MODULE_KEYS, MODULE_TABS, tabTier, type ModuleKey } from "./constants";
import { SHELL_RESERVED_LETTERS, departmentLetters } from "./shortcuts";

/** A department as the archetype seeds build it: every tab of each module, or its own subset (Operations). */
function dept(slug: string, name: string, position: number, moduleKeys: ModuleKey[], tabSlugs?: string[]): AreaDepartment {
  const all = moduleKeys.flatMap((k) => MODULE_TABS[k]);
  const tabs = (tabSlugs ? tabSlugs.map((s) => all.find((t) => t.slug === s)!) : all).map((t, i) => ({ slug: t.slug, title: t.title, position: i }));
  return { id: slug, slug, name, position, moduleKeys, tabs };
}

const LEDGERLY: AreaDepartment[] = [
  dept("product", "Product", 0, ["product"]),
  dept("development", "Development", 1, ["development"]),
  dept("distribution", "Distribution", 2, ["distribution"]),
  dept("finance", "Finance", 3, ["finance"]),
  dept("team", "Team", 4, ["team"]),
  dept("legal", "Legal", 5, ["legal"]),
];

// Northwind (dtc_physical): Operations renamed "Formulation Lab" and Distribution "Retail Partnerships" by the seed.
const NORTHWIND: AreaDepartment[] = [
  dept("product", "Product", 0, ["product"]),
  dept("development", "Development", 1, ["development"]),
  dept("operations", "Formulation Lab", 2, ["development"], ["specialists", "plan"]),
  dept("distribution", "Retail Partnerships", 3, ["distribution"]),
  dept("finance", "Finance", 4, ["finance"]),
  dept("team", "Team", 5, ["team"]),
  dept("legal", "Legal", 6, ["legal"]),
];

const labels = (area: (typeof AREA_KEYS)[number], departments: AreaDepartment[], builder = false) => areaTabs(area, departments, { builder }).map((t) => (t.tier === "detail" ? `(${t.label})` : t.label));
const defaultCount = (departments: AreaDepartment[], builder = false) => [...areaTabsByArea(departments, { builder }).values()].flat().filter((t) => t.tier === "default").length;

describe("area registry", () => {
  it("tab slugs are unique across modules, so a slug alone names its module", () => {
    const slugs = MODULE_KEYS.flatMap((k) => MODULE_TABS[k].map((t) => t.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const k of MODULE_KEYS) for (const s of DEFAULT_TABS[k]) expect(MODULE_TABS[k].some((t) => t.slug === s)).toBe(true);
    expect(Object.keys(MODULE_AREA).sort()).toEqual([...MODULE_KEYS].sort());
    expect(new Set(Object.values(AREA_LETTERS)).size).toBe(AREA_KEYS.length);
  });

  it("maps tabs by module, never by department name; roadmap is Plan's and the legal module is Money's Company section", () => {
    expect(areaOfTab(["product"], "roadmap")).toBe("plan");
    expect(areaOfTab(["product"], "vision")).toBe("product");
    expect(areaOfTab(["development"], "plan")).toBe("product");
    expect(areaOfTab(["legal"], "entity")).toBe("money");
    expect(sectionOfTab(["legal"], "compliance")).toBe("company");
    expect(sectionOfTab(["finance"], "runway")).toBeNull();
    // A founder's own tab goes with the department's first module; a department with no modules is no area's.
    expect(areaOfTab(["distribution", "product"], "my-board")).toBe("customers");
    expect(areaOfTab([], "notes")).toBeNull();
    expect(departmentArea(["finance", "legal"])).toBe("money");
  });

  it("Ledgerly: 15 inline tabs across the five areas", () => {
    expect(labels("plan", LEDGERLY)).toEqual(["Roadmap", "Milestones"]);
    expect(labels("customers", LEDGERLY)).toEqual(["First ten", "(Board)", "(Channels)", "(Leads)", "(Campaigns)", "Creative", "(Attribution)", "Contacts"]);
    expect(labels("money", LEDGERLY)).toEqual(["Overview", "(Profit and loss)", "(Cash)", "Runway", "(Payroll)", "(Cap table)", "Company", "(Incorporate)", "Compliance", "(Contracts)", "(IP)", "(Policies)", "(Regulatory)"]);
    expect(labels("product", LEDGERLY)).toEqual(["(Vision)", "Specification", "Public page", "(Changes)", "(Sources)", "(Research)", "(Working now)", "(Work list)", "What changed", "Live product", "(Specialists)"]);
    expect(labels("team", LEDGERLY)).toEqual(["Agents", "(Staff)", "(Responsibilities)", "Recruitment"]);
    expect(defaultCount(LEDGERLY)).toBe(15);
  });

  it("Northwind: Formulation Lab lands in Product with its first tab promoted, Retail Partnerships in Customers; 16 inline", () => {
    const product = areaTabs("product", NORTHWIND, { builder: false });
    expect(product.filter((t) => t.department?.name === "Formulation Lab").map((t) => [t.label, t.tier])).toEqual([
      ["Specialists · Formulation Lab", "default"],
      ["Work list · Formulation Lab", "detail"],
    ]);
    expect(product.find((t) => t.id === "development/specialists")).toMatchObject({ label: "Specialists · Development", tier: "detail" });
    expect(areaTabs("customers", NORTHWIND, { builder: false }).filter((t) => t.department).every((t) => t.department!.name === "Retail Partnerships")).toBe(true);
    expect(defaultCount(NORTHWIND)).toBe(16);
  });

  it("a merged department splits its tabs across areas; a department with no modules keeps its own item", () => {
    const growth = dept("growth", "Growth", 0, ["product", "distribution"]);
    const notes: AreaDepartment = { id: "notes", slug: "notes", name: "Notes", position: 9, moduleKeys: [], tabs: [{ slug: "board", title: "Board", position: 0 }] };
    const rows = [growth, notes];
    const map = areaTabsByArea(rows, { builder: false });
    expect(map.get("product")?.map((t) => t.id)).toEqual(["growth/vision", "growth/specification", "growth/public-page", "growth/changes", "growth/sources", "growth/research"]);
    expect(map.get("plan")?.map((t) => t.id)).toEqual(["growth/roadmap", "milestones"]);
    expect(map.get("customers")?.some((t) => t.id === "growth/leads")).toBe(true);
    // Money and Team have no department here and no fixed surface, so they are left out.
    expect(map.has("money")).toBe(false);
    expect(map.has("team")).toBe(false);
    expect([...map.values()].flat().some((t) => t.department?.id === "notes")).toBe(false);
    expect(moduleLessDepartments(rows).map((d) => d.id)).toEqual(["notes"]);
    // Its letter is chosen around Today, Needs you and the area letters.
    expect(departmentLetters([{ id: "notes", name: "Team notes" }], SHELL_RESERVED_LETTERS).get("notes")).toBe("N");
  });

  it("promotes the first tab of a department with no default tab; walled departments and fixed surfaces can be left out", () => {
    const ops = dept("ops", "Ops", 0, ["development"], ["plan", "specialists"]);
    expect(areaTabs("product", [ops], { builder: false }).map((t) => [t.title, t.tier])).toEqual([
      ["Work list", "default"],
      ["Specialists", "detail"],
    ]);
    const walled = areaTabsByArea(LEDGERLY, { builder: false, canOpen: (d) => d.slug !== "distribution", fixed: { crm: false } });
    expect(walled.has("customers")).toBe(false);
    expect(areaLanding(areaTabs("money", LEDGERLY, { builder: false }))?.id).toBe("finance/overview");
    expect(areaLanding(areaTabs("team", LEDGERLY, { builder: false }))?.id).toBe("team/squad");
  });

  it("tiers: defaults inline, the rest More detail, Builder view's tabs only in Builder view; Builder view on flattens", () => {
    expect(tabTier(["development"], "code")).toBe("builder");
    expect(tabTier(["team"], "health")).toBe("builder");
    expect(tabTier(["distribution"], "first-ten")).toBe("default");
    expect(tabTier(["distribution"], "leads")).toBe("detail");
    expect(tabTier(["distribution"], "my-own")).toBe("default");
    expect(labels("product", LEDGERLY).includes("Code")).toBe(false);
    const on = areaTabsByArea(LEDGERLY, { builder: true });
    expect([...on.values()].flat().every((t) => t.tier === "default")).toBe(true);
    // Builder view shows the stored titles and its own tabs.
    expect(areaTabs("product", LEDGERLY, { builder: true }).map((t) => t.label)).toContain("Code");
    expect(areaTabs("money", LEDGERLY, { builder: true }).map((t) => t.label)).toContain("Entity");
    expect(defaultCount(LEDGERLY, true)).toBe(41);
  });
});

describe("tabs by stage (WP-10 T1)", () => {
  const FRESH: StageFacts = { pageLive: false, distributionStarted: false, roundCompleted: false, bankConnected: false, firstPayment: false, entityExists: false, people: 1 };
  const ids = (departments: AreaDepartment[], stage?: StageFacts, builder = false) => [...areaTabsByArea(departments, { builder, stage }).values()].flat().map((t) => t.id);
  const inline = (departments: AreaDepartment[], stage?: StageFacts, builder = false) => [...areaTabsByArea(departments, { builder, stage }).values()].flat().filter((t) => t.tier === "default").length;

  it("a fresh project's stage leaves Money, Company and Development tabs out", () => {
    const map = areaTabsByArea(LEDGERLY, { builder: false, stage: FRESH });
    expect(map.has("money")).toBe(false);
    expect(map.get("product")?.some((t) => t.moduleKey === "development")).toBe(false);
    expect(map.get("customers")?.map((t) => t.id)).toEqual(["crm"]);
    expect(inline(LEDGERLY, FRESH)).toBeLessThanOrEqual(8);
    expect([...map.values()].flat().length - inline(LEDGERLY, FRESH)).toBe(6);
  });

  it("one finished round adds Payroll and Development's tabs", () => {
    const stage = { ...FRESH, roundCompleted: true };
    const map = areaTabsByArea(LEDGERLY, { builder: false, stage });
    expect(map.get("money")?.map((t) => [t.id, t.tier])).toEqual([["finance/wage-bill", "default"]]);
    expect(map.get("product")?.filter((t) => t.moduleKey === "development").map((t) => t.slug)).toEqual(["training-ground", "plan", "pull-requests", "environments", "specialists"]);
    expect(TEAM_CALL_REVEAL(stage)).toBe(true);
    expect(TEAM_CALL_REVEAL(FRESH)).toBe(false);
  });

  it("a payment adds Overview, Runway, Cap table and Incorporate; an entity adds Company's tabs", () => {
    const paid = ids(LEDGERLY, { ...FRESH, firstPayment: true });
    for (const id of ["finance/overview", "finance/runway", "finance/cap-table", "legal/incorporate"]) expect(paid).toContain(id);
    expect(paid).not.toContain("legal/compliance");
    expect(ids(LEDGERLY, { ...FRESH, entityExists: true })).toContain("legal/compliance");
    expect(ids(LEDGERLY, { ...FRESH, people: 2 })).toContain("legal/incorporate");
  });

  it("a page or distribution reveals the Board; distribution the rest of Customers", () => {
    expect(ids(LEDGERLY, { ...FRESH, pageLive: true })).toContain("distribution/formation");
    expect(ids(LEDGERLY, { ...FRESH, pageLive: true })).not.toContain("distribution/leads");
    expect(ids(LEDGERLY, { ...FRESH, distributionStarted: true })).toContain("distribution/leads");
  });

  it("Builder view ignores the stage; no stage given changes nothing", () => {
    expect(ids(LEDGERLY, FRESH, true)).toEqual(ids(LEDGERLY, undefined, true));
    expect(ids(LEDGERLY, undefined)).toContain("finance/runway");
    expect(tabRevealed("finance", "runway", undefined)).toBe(true);
    expect(tabRevealed("product", "vision", FRESH)).toBe(true);
    expect(Object.keys(TAB_REVEAL).sort()).toEqual(["development", "distribution", "finance", "legal"]);
  });
});
