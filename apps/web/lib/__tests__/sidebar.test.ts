/** The founder-area sidebar (docs/DESIGN.md §8; founder decisions 2026-11-09). */
import { describe, expect, it } from "vitest";
import { withSidebarKeys } from "@foundmill/dugout";
import { MODULE_TABS, type ModuleKey } from "@foundmill/shared/constants";
import { FULL_ACCESS } from "../access";
import { SIDEBAR_BRAND, activeSidebarId, buildSidebarItems, departmentBadges, departmentHref, type SidebarDepartment } from "../sidebar";

const BID = "00000000-0000-4000-8000-000000000001";

/** A seeded department: every tab of its modules (or a subset), with the module's titles. */
function dept(id: string, name: string, slug: string, position: number, moduleKeys: ModuleKey[], extra: Partial<SidebarDepartment> = {}, tabSlugs?: string[]): SidebarDepartment {
  const all = moduleKeys.flatMap((k) => MODULE_TABS[k]);
  const tabs = (tabSlugs ? tabSlugs.map((s) => all.find((t) => t.slug === s)!) : all).map((t, i) => ({ slug: t.slug, title: t.title, position: i }));
  return { id, name, slug, colourToken: "dept-1", position, moduleKeys, tabs, ...extra };
}

// Ledgerly (b2b_saas): the six default departments.
const LEDGERLY: SidebarDepartment[] = [
  dept("d-prod", "Product", "product", 0, ["product"], { squad: [{ id: "a-prod" }] }),
  dept("d-dev", "Development", "development", 1, ["development"], { squad: [{ id: "a-dev" }] }),
  dept("d-dist", "Distribution", "distribution", 2, ["distribution"], { squad: [{ id: "a-dist" }] }),
  dept("d-fin", "Finance", "finance", 3, ["finance"]),
  dept("d-team", "Team", "team", 4, ["team"]),
  dept("d-legal", "Legal", "legal", 5, ["legal"], { squad: [{ id: "a-legal" }] }),
];

// Northwind (dtc_physical): Operations renamed Formulation Lab, Distribution renamed Retail Partnerships.
const NORTHWIND: SidebarDepartment[] = [
  ...LEDGERLY.filter((d) => d.slug !== "distribution"),
  dept("d-ops", "Formulation Lab", "operations", 2, ["development"], {}, ["specialists", "plan"]),
  dept("d-retail", "Retail Partnerships", "distribution", 3, ["distribution"]),
];

describe("Team call in the sidebar", () => {
  it("sits right under Team with the Video icon, opens the lobby, and lights on /calls routes", () => {
    const items = buildSidebarItems({ businessId: BID, departments: LEDGERLY, live: false });
    const labels = items.filter((i) => i.group === "area").map((i) => i.label);
    expect(labels.indexOf("Team call")).toBe(labels.indexOf("Team") + 1);
    const call = items.find((i) => i.id === "calls")!;
    expect(call).toMatchObject({ label: "Team call", href: `/b/${BID}/calls`, group: "area" });
    expect(call.icon).toBeTruthy();
    expect(activeSidebarId(`/b/${BID}/calls`, BID, LEDGERLY)).toBe("calls");
    expect(activeSidebarId(`/b/${BID}/calls/a1000000-0000-4000-8000-000000000001`, BID, LEDGERLY)).toBe("calls");
  });

  it("is not offered to someone who cannot read the Team section", () => {
    const access = { ...FULL_ACCESS, canRead: (s: string) => s !== "team" };
    const items = buildSidebarItems({ businessId: BID, departments: LEDGERLY, live: false, access });
    expect(items.some((i) => i.id === "calls")).toBe(false);
  });
});

describe("sidebar items", () => {
  it("reads Today, Needs you, then Plan, Customers, Money, Product and Team; Contacts and Milestones are area tabs", () => {
    const items = buildSidebarItems({ businessId: BID, departments: LEDGERLY, live: false });
    expect(items.filter((i) => i.group === "main" || i.group === "area" || i.group === "department").map((i) => i.label)).toEqual(["Today", "Needs you", "Plan", "Customers", "Money", "Product", "Team", "Team call"]);
    // Today is the front door (founder, 2026-11-07): the item keeps its id and `fixed: "home"`, so G H follows it.
    expect(items.find((i) => i.id === "home")).toMatchObject({ fixed: "home", label: "Today", href: `/b/${BID}/today` });
    // Needs you keeps the Inbox's id and `fixed`, and opens it on Respond.
    expect(items.find((i) => i.id === "inbox")).toMatchObject({ fixed: "inbox", label: "Needs you", href: `/b/${BID}/inbox?tab=respond` });
    // Each area links to its first inline tab, wherever its department is.
    expect(Object.fromEntries(items.filter((i) => i.group === "area" && i.area).map((i) => [i.area, i.href]))).toEqual({
      plan: `/b/${BID}/d/product/roadmap`,
      customers: `/b/${BID}/d/distribution/first-ten`,
      money: `/b/${BID}/d/finance/overview`,
      product: `/b/${BID}/d/product/specification`,
      team: `/b/${BID}/d/team/squad`,
    });
    expect(items.some((i) => i.label === "Contacts" || i.label === "Milestones" || i.label === "Inbox")).toBe(false);
    // A Personal business keeps Network (the founder's own requests and messages) and nothing else of the LIVE block.
    expect(items.filter((i) => i.group === "live").map((i) => i.label)).toEqual(["Network"]);
    // The Foundmill wordmark is not an item (no icon): Dugout draws it from `SIDEBAR_BRAND` while expanded. The
    // Anthropic key is a Settings tab, not a foot item (B13).
    expect(items.filter((i) => i.group === "foot").map((i) => i.label)).toEqual(["Settings", "Sign out"]);
    expect(items.some((i) => i.label === "Anthropic key")).toBe(false);
    // Sign out is a button (no href), so no router prefetch can ever end the session.
    expect(items.find((i) => i.id === "sign-out")?.href).toBeUndefined();
    expect(items.some((i) => i.id === "brand")).toBe(false);
    expect(SIDEBAR_BRAND).toEqual({ href: "/" });
  });

  it("maps Northwind's renamed departments by module: Formulation Lab is Product's, Retail Partnerships Customers'", () => {
    const items = buildSidebarItems({ businessId: BID, departments: NORTHWIND, live: false });
    expect(items.filter((i) => i.group === "area").map((i) => i.label)).toEqual(["Plan", "Customers", "Money", "Product", "Team", "Team call"]);
    expect(items.some((i) => i.label === "Formulation Lab" || i.label === "Retail Partnerships")).toBe(false);
    expect(activeSidebarId(`/b/${BID}/d/operations/specialists`, BID, NORTHWIND)).toBe("area-product");
    expect(activeSidebarId(`/b/${BID}/d/distribution/formation`, BID, NORTHWIND)).toBe("area-customers");
  });

  it("keeps a department with no modules as its own item after Team, with its dot and letter; a merged one splits by tab", () => {
    const notes = dept("d-notes", "Studio", "studio", 9, [], { colourToken: "dept-7", squad: [{ id: "a-notes" }] });
    notes.tabs = [{ slug: "notes", title: "Notes", position: 0 }];
    const growth = dept("d-growth", "Growth", "growth", 0, ["product", "distribution"]);
    const rows = [growth, ...LEDGERLY.filter((d) => !["product", "distribution"].includes(d.slug)), notes];
    const items = buildSidebarItems({ businessId: BID, departments: rows, live: false, inboxItems: [{ fromAgentId: "a-notes", state: "unread" }] });
    expect(items.filter((i) => i.group !== "live" && i.group !== "foot").map((i) => i.label)).toEqual(["Today", "Needs you", "Plan", "Customers", "Money", "Product", "Team", "Team call", "Studio"]);
    expect(items.find((i) => i.id === "d-notes")).toMatchObject({ group: "department", dept: "dept-7", href: `/b/${BID}/d/studio/notes`, badge: 1 });
    expect(withSidebarKeys(items).find((i) => i.id === "d-notes")?.keys).toEqual(["G", "S"]);
    expect(departmentHref(BID, notes)).toBe(`/b/${BID}/d/studio/notes`);
    // A merged department lights a different area per tab.
    expect(activeSidebarId(`/b/${BID}/d/growth/leads`, BID, rows)).toBe("area-customers");
    expect(activeSidebarId(`/b/${BID}/d/growth/vision`, BID, rows)).toBe("area-product");
    expect(activeSidebarId(`/b/${BID}/d/growth/roadmap`, BID, rows)).toBe("area-plan");
    expect(activeSidebarId(`/b/${BID}/d/studio/notes`, BID, rows)).toBe("d-notes");
  });

  it("adds the LIVE block in live mode: Network and Communities", () => {
    const items = buildSidebarItems({ businessId: BID, departments: LEDGERLY, live: true });
    expect(items.filter((i) => i.group === "live").map((i) => i.label)).toEqual(["Network", "Communities"]);
  });

  it("badges Network with what waits for the founder in every mode, and Communities with posts to moderate (audit #65)", () => {
    const personal = buildSidebarItems({ businessId: BID, departments: LEDGERLY, live: false, network: { total: 3, moderation: 2 } });
    expect(personal.find((i) => i.id === "network")).toMatchObject({ href: "/network", badge: 3 });
    expect(personal.find((i) => i.id === "communities")).toBeUndefined();
    const live = buildSidebarItems({ businessId: BID, departments: LEDGERLY, live: true, network: { total: 0, moderation: 2 } });
    expect(live.find((i) => i.id === "network")?.badge).toBeUndefined();
    expect(live.find((i) => i.id === "communities")?.badge).toBe(2);
  });

  it("badges Needs you with the respond count and each area with unread items from its departments' agents", () => {
    const inboxItems = [
      { fromAgentId: "a-dev", state: "unread" },
      { fromAgentId: "a-dev", state: "read" },
      { fromAgentId: "a-prod", state: "unread" },
      { fromAgentId: "a-legal", state: "unread" },
      { fromAgentId: null, state: "unread" },
    ];
    const badges = departmentBadges(LEDGERLY, inboxItems);
    expect(badges.get("d-dev")).toBe(1);
    expect(badges.get("d-prod")).toBe(1);
    const items = buildSidebarItems({ businessId: BID, departments: LEDGERLY, inboxCounts: { respond: 4 }, inboxItems, live: false });
    expect(items.find((i) => i.id === "inbox")).toMatchObject({ badge: 4, badgeTone: "bad" });
    // Product and Development are both Product's; Legal's note badges Money (the Company section).
    expect(items.find((i) => i.id === "area-product")?.badge).toBe(2);
    expect(items.find((i) => i.id === "area-money")?.badge).toBe(1);
    expect(items.find((i) => i.id === "area-team")?.badge).toBeUndefined();
    expect(buildSidebarItems({ businessId: BID, departments: LEDGERLY, inboxCounts: { respond: 0 }, live: false }).find((i) => i.id === "inbox")?.badge).toBeUndefined();
  });

  it("gets G chords from Dugout: G H, G I and the area letters P, C, M, R, T, whatever the departments are called", () => {
    const keyed = withSidebarKeys(buildSidebarItems({ businessId: BID, departments: NORTHWIND, live: false }));
    expect(keyed.filter((i) => i.keys).map((i) => `${i.label} ${i.keys!.join(" ")}`)).toEqual(["Today G H", "Needs you G I", "Plan G P", "Customers G C", "Money G M", "Product G R", "Team G T"]);
  });

  it("resolves the active item from the pathname", () => {
    expect(activeSidebarId(`/b/${BID}/home`, BID, LEDGERLY)).toBe("home");
    expect(activeSidebarId(`/b/${BID}/today`, BID, LEDGERLY)).toBe("home");
    expect(activeSidebarId(`/b/${BID}`, BID, LEDGERLY)).toBe("home");
    expect(activeSidebarId(`/b/${BID}/inbox/123`, BID, LEDGERLY)).toBe("inbox");
    expect(activeSidebarId(`/b/${BID}/d/development/plan`, BID, LEDGERLY)).toBe("area-product");
    expect(activeSidebarId(`/b/${BID}/d/product/roadmap`, BID, LEDGERLY)).toBe("area-plan");
    expect(activeSidebarId(`/b/${BID}/d/legal/entity`, BID, LEDGERLY)).toBe("area-money");
    expect(activeSidebarId(`/b/${BID}/d/finance`, BID, LEDGERLY)).toBe("area-money");
    expect(activeSidebarId(`/b/${BID}/crm`, BID, LEDGERLY)).toBe("area-customers");
    expect(activeSidebarId(`/b/${BID}/crm/e1/overview`, BID, LEDGERLY)).toBe("area-customers");
    expect(activeSidebarId(`/b/${BID}/milestones`, BID, LEDGERLY)).toBe("area-plan");
    expect(activeSidebarId(`/b/${BID}/trophies`, BID, LEDGERLY)).toBe("area-plan");
    expect(activeSidebarId(`/b/${BID}/settings/keys`, BID, LEDGERLY)).toBe("settings");
    expect(activeSidebarId(`/b/${BID}/settings/mode`, BID, LEDGERLY)).toBe("settings");
    expect(activeSidebarId(`/b/${BID}/d/nowhere/x`, BID, LEDGERLY)).toBeUndefined();
    expect(activeSidebarId(`/b/other/home`, BID, LEDGERLY)).toBeUndefined();
    // The LIVE pages are not under /b/[bid]; each lights its own item, detail pages included.
    expect(activeSidebarId("/network", BID, LEDGERLY)).toBe("network");
    expect(activeSidebarId("/communities", BID, LEDGERLY)).toBe("communities");
    expect(activeSidebarId(`/communities/${BID}`, BID, LEDGERLY)).toBe("communities");
    // A removed page lights nothing.
    expect(activeSidebarId("/leaderboards", BID, LEDGERLY)).toBeUndefined();
    expect(activeSidebarId(`/profiles/founder/${BID}`, BID, LEDGERLY)).toBe("network");
    expect(activeSidebarId("/networking", BID, LEDGERLY)).toBeUndefined();
  });
  it("Settings opens on Basics with Builder view off and on Business with it on (WP-10 T11)", () => {
    const settings = (builder: boolean) => buildSidebarItems({ businessId: BID, departments: LEDGERLY, live: false, builder }).find((i) => i.id === "settings")!.href;
    expect(settings(false)).toBe(`/b/${BID}/settings/basics`);
    expect(settings(true)).toBe(`/b/${BID}/settings/business`);
  });
});
