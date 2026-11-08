import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@foundmill/dugout";
import { accessFor } from "../access";
import { entityPaletteItems, filterLocal, helpPaletteItems, localPaletteItems, searchInputFor } from "../search";

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

  it("offers Preferences (the person's own date format, guidance and text size), found by what it changes", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    const prefs = items.find((i) => i.id === "command:preferences");
    expect(prefs).toMatchObject({ kind: "command", label: "Preferences", description: "Your date format, guidance, text size and Builder view, in every business", href: `/b/${BID}/settings/preferences` });
    for (const q of ["Preferences", "date format", "time format", "24-hour", "guidance", "explain", "text size", "comfortable", "checklist", "tour", "builder view"]) expect(filterLocal(items, q)[0]?.id, q).toBe("command:preferences");
    // One row for it, not a second "Settings · Preferences".
    expect(items.filter((i) => i.href === `/b/${BID}/settings/preferences`)).toHaveLength(1);
  });

  it("calls the glossary tab Your words (the slug and the old name still find it) and says what Refresh does without a cycle (§7.17, B12)", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    const words = items.find((i) => i.id === "command:settings:glossary");
    expect(words).toMatchObject({ label: "Settings · Your words", href: `/b/${BID}/settings/glossary` });
    expect(filterLocal(items, "glossary")[0]?.id).toBe("command:settings:glossary");
    expect(filterLocal(items, "your words")[0]?.id).toBe("command:settings:glossary");
    expect(items.find((i) => i.id === "command:refresh-inbox")?.description).toBe("Ask the team for one quick note; no new work starts");
  });

  it("calls the mode tab What the team can do; the slug, spending and approvals still find it (founder, 2026-11-07)", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    expect(items.find((i) => i.id === "command:settings:mode")).toMatchObject({ label: "Settings · What the team can do", href: `/b/${BID}/settings/mode` });
    for (const q of ["mode", "spending", "approvals", "ask first"]) expect(filterLocal(items, q).some((i) => i.id === "command:settings:mode"), q).toBe(true);
  });

  it("offers Edit layout only where the screen has a layout to edit (audit OL-29)", () => {
    expect(localPaletteItems({ businessId: BID, departments, live: false }).some((i) => i.id === "command:edit-layout")).toBe(false);
    expect(localPaletteItems({ businessId: BID, departments, live: false, canEditLayout: true }).some((i) => i.id === "command:edit-layout")).toBe(true);
  });

  it("switches to the founder's other businesses, creates a new one and manages them all (audit IAE-08, WEB-13)", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false, businesses: [{ id: BID, name: "Northwind" }, { id: "b2", name: "Ledgerly" }] });
    expect(items.find((i) => i.id === "business:b2")).toMatchObject({ label: "Switch to Ledgerly", description: "Switch business", href: "/b/b2/today" });
    expect(items.find((i) => i.id === "command:new-business")).toMatchObject({ label: "Create a new business", href: "/new" });
    expect(items.find((i) => i.id === "command:manage-businesses")).toMatchObject({ label: "Manage businesses", href: "/businesses" });
    expect(filterLocal(items, "manage")[0]?.id).toBe("command:manage-businesses");
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

  it("calls the CRM Contacts on screen and still finds it by its old name; Stop all agents says what it does in plain words (B13, B6)", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    expect(items.find((i) => i.id === "screen:crm")).toMatchObject({ label: "Contacts", href: `/b/${BID}/crm`, shortcut: ["G", "C"] });
    expect(filterLocal(items, "crm")[0]?.id).toBe("screen:crm");
    expect(filterLocal(items, "contacts")[0]?.id).toBe("screen:crm");
    const stop = items.find((i) => i.id === "command:stop-all");
    expect(stop?.description).toBe("Pause the whole team. An owner can resume.");
    expect(stop?.description).not.toMatch(/kill switch/i);
  });

  it("builds the Help group from the defined terms, in the business's words, after the keyboard shortcuts row (B12)", () => {
    const items = helpPaletteItems(BID, null);
    expect(items[0]).toEqual(expect.objectContaining({ id: "help:keyboard-shortcuts", title: "Keyboard shortcuts" }));
    const runway = items.find((i) => i.id === "help:runway");
    expect(runway).toMatchObject({ title: "Runway", line: "How many months your cash lasts at today's spending.", href: `/b/${BID}/d/finance/runway` });
    // The old tab slug stays in the URL (learnPath's aliases); a term without a learn target has no href.
    expect(items.find((i) => i.id === "help:rating")?.href).toBe(`/b/${BID}/d/team/squad`);
    expect(items.find((i) => i.id === "help:estimate")?.href).toBeUndefined();
    // The longer explanation travels with the row, so a term without an href can open its definition in place.
    expect(items.find((i) => i.id === "help:estimate")?.long).toMatch(/^The figure is calculated/);
    expect(items.length).toBeGreaterThan(40);
    // The glossary renames inside the definitions.
    const clients = helpPaletteItems(BID, { customer: "client" });
    expect(clients.find((i) => i.id === "help:acquisition_cost")?.title).toBe("Cost to win a client");
  });

  it("offers Sign out as a command with no link, found by its synonyms too", () => {
    const items = localPaletteItems({ businessId: BID, departments, live: false });
    const signOut = items.find((i) => i.id === "command:sign-out");
    expect(signOut).toMatchObject({ kind: "command", label: "Sign out" });
    expect(signOut?.href).toBeUndefined();
    expect(filterLocal(items, "log out")[0]?.id).toBe("command:sign-out");
  });
});
