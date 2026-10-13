import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@foundmill/dugout";
import { accessFor } from "../access";
import { entityPaletteItems, filterLocal, localPaletteItems, searchInputFor } from "../search";

const BID = "00000000-0000-4000-8000-000000000001";
const departments = [{ id: "d1", name: "Distribution", slug: "distribution", colourToken: "dept-4" as const, tabs: [{ slug: "channels", title: "Channels", position: 1 }, { slug: "formation", title: "Formation", position: 0 }] }];

describe("universal search", () => {
  it("builds local items for screens, departments, settings commands and inbox rows", () => {
    const items = localPaletteItems({ businessId: BID, departments, inboxItems: [{ id: "i1", subject: "Approve the launch", type: "decision", state: "unread" }, { id: "i2", subject: "Old", type: "update", state: "archived" }], live: false });
    expect(items.find((i) => i.id === "department:d1")?.href).toBe(`/b/${BID}/d/distribution/formation`);
    expect(items.find((i) => i.id === "screen:d1:channels")?.label).toBe("Distribution · Channels");
    expect(items.filter((i) => i.kind === "command").length).toBeGreaterThanOrEqual(9 + 4);
    expect(items.find((i) => i.id === "inbox:i1")?.href).toBe(`/b/${BID}/inbox/i1`);
    expect(items.find((i) => i.id === "inbox:i2")).toBeUndefined();
    // Network is the founder's own in every mode; Communities and Leaderboards come with a LIVE business.
    expect(items.some((i) => i.id === "screen:network")).toBe(true);
    expect(items.some((i) => i.id === "screen:communities")).toBe(false);
    expect(localPaletteItems({ businessId: BID, departments, live: true }).some((i) => i.id === "screen:communities")).toBe(true);
  });

  it("maps entity hits to palette rows with the CRM href", () => {
    const rows = entityPaletteItems(BID, [{ entity: { id: "e1", kind: "person", displayName: "Ada Lovelace", identifiers: { email: "ada@example.com" } }, score: 0.9, matchedOn: "name" }]);
    expect(rows[0]).toMatchObject({ id: "entity:e1", kind: "person", label: "Ada Lovelace", description: "ada@example.com", href: `/b/${BID}/crm/e1/overview` });
  });

  it("turns a parsed query into crm.search input, honouring operators and the > command prefix", () => {
    expect(searchInputFor(parseSearchQuery("ada role:lead department:distribution"), (v) => (v === "distribution" ? "d1" : undefined))).toEqual({ q: "ada", role: "lead", stage: undefined, departmentId: "d1", limit: 20 });
    expect(searchInputFor(parseSearchQuery(">edit"))).toBeNull();
    expect(searchInputFor(parseSearchQuery("   "))).toBeNull();
  });

  it("filters local rows by prefix, word prefix and substring", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    const r = filterLocal(items, "chan");
    expect(r[0]?.id).toBe("screen:d1:channels");
    expect(filterLocal(items, "").length).toBe(items.length);
    expect(filterLocal(items, "zzzz")).toEqual([]);
  });

  it("offers Preferences (the person's own date and time format), found by what it changes", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    const prefs = items.find((i) => i.id === "command:preferences");
    expect(prefs).toMatchObject({ kind: "command", label: "Preferences", href: `/b/${BID}/settings/preferences` });
    for (const q of ["Preferences", "date format", "time format", "24-hour"]) expect(filterLocal(items, q)[0]?.id, q).toBe("command:preferences");
    // One row for it, not a second "Settings · Preferences".
    expect(items.filter((i) => i.href === `/b/${BID}/settings/preferences`)).toHaveLength(1);
  });

  it("offers Edit layout only where the screen has a layout to edit (audit OL-29)", () => {
    expect(localPaletteItems({ businessId: BID, departments, live: false }).some((i) => i.id === "command:edit-layout")).toBe(false);
    expect(localPaletteItems({ businessId: BID, departments, live: false, canEditLayout: true }).some((i) => i.id === "command:edit-layout")).toBe(true);
  });

  it("opens the founder's other businesses and starts a new one (audit IAE-08, WEB-13)", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false, businesses: [{ id: BID, name: "Northwind" }, { id: "b2", name: "Ledgerly" }] });
    expect(items.find((i) => i.id === "business:b2")).toMatchObject({ label: "Open Ledgerly", href: "/b/b2/home" });
    expect(items.some((i) => i.id === `business:${BID}`)).toBe(false);
    expect(items.find((i) => i.id === "command:new-business")?.href).toBe("/new");
    expect(items.find((i) => i.id === "command:profile")?.href).toBe("/onboarding");
    expect(filterLocal(items, "switch")[0]?.id).toBe("business:b2");
    expect(filterLocal(items, "new business")[0]?.id).toBe("command:new-business");
    expect(filterLocal(items, "Ledgerly")[0]?.id).toBe("business:b2");
  });

  it("offers only what the person's role and section walls allow (audit RUI-05)", () => {
    const walled = accessFor({ role: "member", sectionPermissions: { distribution: "none", crm: "none" } });
    const withModules = [{ ...departments[0]!, moduleKeys: ["distribution"] }];
    const member = localPaletteItems({ businessId: BID, departments: withModules, live: false, access: walled });
    expect(member.some((i) => i.id === "department:d1")).toBe(false);
    expect(member.some((i) => i.id === "screen:crm")).toBe(false);
    expect(member.some((i) => i.id === "command:stop-all")).toBe(false);
    expect(member.some((i) => i.id === "command:refresh-inbox")).toBe(true);
    const viewer = localPaletteItems({ businessId: BID, departments: withModules, live: false, access: accessFor({ role: "viewer", sectionPermissions: {} }) });
    expect(viewer.some((i) => i.id === "department:d1")).toBe(true);
    expect(viewer.some((i) => i.id === "command:refresh-inbox")).toBe(false);
    expect(viewer.some((i) => i.id === "command:holiday")).toBe(false);
  });

  it("sends an agent's record to the agent's profile (audit GTM-19)", () => {
    const rows = entityPaletteItems(BID, [{ entity: { id: "e9", kind: "agent", displayName: "Chief of Staff", agentId: "a9" }, score: 1, matchedOn: "prefix" }]);
    expect(rows[0]?.href).toBe(`/b/${BID}/agents/a9/overview`);
  });

  it("searches by operators alone (audit GTM-27)", () => {
    expect(searchInputFor(parseSearchQuery("role:supplier"))).toEqual({ q: "", role: "supplier", stage: undefined, departmentId: undefined, limit: 20 });
    expect(searchInputFor(parseSearchQuery("department:nowhere"), () => undefined)).toBeNull();
  });

  it("offers Sign out as a command with no link, found by its synonyms too", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    const signOut = items.find((i) => i.id === "command:sign-out");
    expect(signOut).toMatchObject({ kind: "command", label: "Sign out" });
    expect(signOut?.href).toBeUndefined();
    expect(filterLocal(items, "log out")[0]?.id).toBe("command:sign-out");
  });
});
