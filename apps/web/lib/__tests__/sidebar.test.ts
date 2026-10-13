import { describe, expect, it } from "vitest";
import { withSidebarKeys } from "@foundmill/dugout";
import { SIDEBAR_BRAND, activeSidebarId, buildSidebarItems, departmentBadges, departmentHref, type SidebarDepartment } from "../sidebar";

const BID = "00000000-0000-4000-8000-000000000001";
const depts: SidebarDepartment[] = [
  { id: "d-dev", name: "Development", slug: "development", icon: "code", colourToken: "dept-2", position: 1, squad: [{ id: "a-dev" }], tabs: [{ slug: "plan", position: 1 }, { slug: "training-ground", position: 0 }] },
  { id: "d-prod", name: "Product", slug: "product", icon: "box", colourToken: "dept-1", position: 0, squad: [{ id: "a-prod" }], tabs: [{ slug: "vision", position: 0 }] },
  { id: "d-hidden", name: "Legal", slug: "legal", colourToken: "dept-3", position: 2, hidden: true, tabs: [] },
];

describe("sidebar items", () => {
  it("orders departments by position, skips hidden ones and links to their first tab", () => {
    const items = buildSidebarItems({ businessId: BID, departments: depts, live: false });
    const deptItems = items.filter((i) => i.group === "department");
    expect(deptItems.map((i) => i.id)).toEqual(["d-prod", "d-dev"]);
    expect(deptItems[1]?.href).toBe(`/b/${BID}/d/development/training-ground`);
    expect(departmentHref(BID, depts[0]!)).toBe(`/b/${BID}/d/development/training-ground`);
    expect(items.find((i) => i.id === "home")?.fixed).toBe("home");
    expect(items.find((i) => i.id === "inbox")?.fixed).toBe("inbox");
    expect(items.find((i) => i.id === "crm")?.fixed).toBe("crm");
    expect(items.some((i) => i.group === "live")).toBe(false);
    // The Foundmill wordmark is not an item (no icon): Dugout draws it from `SIDEBAR_BRAND` while expanded.
    expect(items.filter((i) => i.group === "foot").map((i) => i.label)).toEqual(["Settings", "Anthropic key", "Sign out"]);
    // Sign out is a button (no href), so no router prefetch can ever end the session.
    expect(items.find((i) => i.id === "sign-out")?.href).toBeUndefined();
    expect(items.some((i) => i.id === "brand")).toBe(false);
    expect(SIDEBAR_BRAND).toEqual({ href: "/" });
  });

  it("adds the LIVE block in live mode", () => {
    const items = buildSidebarItems({ businessId: BID, departments: depts, live: true });
    expect(items.filter((i) => i.group === "live").map((i) => i.label)).toEqual(["Network", "Communities", "Leaderboards"]);
  });

  it("badges the Inbox with the respond count and departments with unread items from their agents", () => {
    const inboxItems = [
      { fromAgentId: "a-dev", state: "unread" },
      { fromAgentId: "a-dev", state: "read" },
      { fromAgentId: "a-prod", state: "unread" },
      { fromAgentId: null, state: "unread" },
    ];
    const badges = departmentBadges(depts, inboxItems);
    expect(badges.get("d-dev")).toBe(1);
    expect(badges.get("d-prod")).toBe(1);
    const items = buildSidebarItems({ businessId: BID, departments: depts, inboxCounts: { respond: 4 }, inboxItems, live: false });
    expect(items.find((i) => i.id === "inbox")).toMatchObject({ badge: 4, badgeTone: "bad" });
    expect(items.find((i) => i.id === "d-dev")?.badge).toBe(1);
    expect(buildSidebarItems({ businessId: BID, departments: depts, inboxCounts: { respond: 0 }, live: false }).find((i) => i.id === "inbox")?.badge).toBeUndefined();
  });

  it("gets G chords from Dugout for fixed items and departments (renamed departments get new letters)", () => {
    const keyed = withSidebarKeys(buildSidebarItems({ businessId: BID, departments: depts, live: false }));
    expect(keyed.find((i) => i.id === "home")?.keys).toEqual(["G", "H"]);
    expect(keyed.find((i) => i.id === "d-prod")?.keys).toEqual(["G", "P"]);
    expect(keyed.find((i) => i.id === "d-dev")?.keys).toEqual(["G", "D"]);
    const renamed = withSidebarKeys(buildSidebarItems({ businessId: BID, departments: depts.map((d) => (d.id === "d-dev" ? { ...d, name: "Formulation Lab" } : d)), live: false }));
    expect(renamed.find((i) => i.id === "d-dev")?.keys).toEqual(["G", "F"]);
  });

  it("resolves the active item from the pathname", () => {
    expect(activeSidebarId(`/b/${BID}/home`, BID, depts)).toBe("home");
    expect(activeSidebarId(`/b/${BID}`, BID, depts)).toBe("home");
    expect(activeSidebarId(`/b/${BID}/inbox/123`, BID, depts)).toBe("inbox");
    expect(activeSidebarId(`/b/${BID}/d/development/plan`, BID, depts)).toBe("d-dev");
    expect(activeSidebarId(`/b/${BID}/settings/keys`, BID, depts)).toBe("keys");
    expect(activeSidebarId(`/b/${BID}/settings/mode`, BID, depts)).toBe("settings");
    expect(activeSidebarId(`/b/${BID}/trophies`, BID, depts)).toBe("milestones");
    expect(activeSidebarId(`/b/other/home`, BID, depts)).toBeUndefined();
    // The LIVE pages are not under /b/[bid]; each lights its own item, detail pages included.
    expect(activeSidebarId("/network", BID, depts)).toBe("network");
    expect(activeSidebarId("/communities", BID, depts)).toBe("communities");
    expect(activeSidebarId(`/communities/${BID}`, BID, depts)).toBe("communities");
    expect(activeSidebarId("/leaderboards", BID, depts)).toBe("leaderboards");
    expect(activeSidebarId(`/leaderboards/${BID}`, BID, depts)).toBe("leaderboards");
    expect(activeSidebarId(`/profiles/founder/${BID}`, BID, depts)).toBe("network");
    expect(activeSidebarId("/networking", BID, depts)).toBeUndefined();
  });
});
