/**
 * Home and navigation data: dashboards (shared links, read-only roles, one default, first-load races, presets), a taken
 * slug, departments after an archive/merge/split, the revenue metric, the Ribbon's range and chapters, and demo
 * businesses on the network.
 */
import { getArchetypeSeed } from "@foundmill/agents";
import { CUSTOM_METRIC_EXAMPLE_IDS, presetWidgets } from "@foundmill/config";
import { businesses, conversions, repos } from "@foundmill/db";
import { MODULE_TABS } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DASHBOARD_PRESETS, PRESET_LAYOUTS } from "../presets";
import { RibbonInput, ribbonRange, untitledEndedChapters } from "../routers/journey";
import { UNSAVED_DASHBOARD_ID } from "../routers/department";
import { METRICS, METRIC_IDS } from "../services/metrics";
import { toTRPCError } from "../trpc";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "home", temporalClient: fakeTemporalClient(), env: { LIVE_MODE: "1" } });
}, 120_000);
afterAll(() => hz.close());

const cardsOf = (layout: unknown) => ((layout as { widgets: { key: string; settings: Record<string, unknown> }[] }).widgets).filter((w) => w.key === "department_card");

describe("dashboards", () => {
  it("a co-member opens a shared dashboard read-only, and cannot change, delete or restyle it", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const home = await owner.dashboard.get({ businessId });
    expect(home).toMatchObject({ stored: true, editable: true, userId: hz.A.ownerId });
    const member = hz.caller({ userId: hz.A.memberId });
    const shared = await member.dashboard.get({ businessId, dashboardId: home.id });
    expect(shared).toMatchObject({ id: home.id, userId: hz.A.ownerId, stored: true, editable: false });
    // Someone outside the business learns nothing.
    await expect(hz.caller({ userId: hz.B.ownerId }).dashboard.get({ businessId, dashboardId: home.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.dashboard.update({ businessId, dashboardId: home.id, name: "Mine now" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(member.dashboard.delete({ businessId, dashboardId: home.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(member.dashboard.applyPreset({ businessId, dashboardId: home.id, preset: "seller" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repos.dashboards.get(hz.db, businessId, home.id)).name).toBe("Home");
    // They copy it into one of their own instead.
    const copy = await member.dashboard.create({ businessId, name: "Copy of Home", preset: "founder" });
    expect(copy.userId).toBe(hz.A.memberId);
  });

  it("two first loads of Home at once make one dashboard, not several active ones", async () => {
    const { businessId } = hz.A;
    const userId = await hz.h.createUser("home-race@test.local");
    await repos.memberships.add(hz.db, businessId, { userId, role: "member" });
    const caller = hz.caller({ userId });
    const loads = await Promise.all([1, 2, 3, 4].map(() => caller.dashboard.get({ businessId })));
    expect(new Set(loads.map((d) => d.id)).size).toBe(1);
    const stored = await repos.dashboards.list(hz.db, businessId, userId);
    expect(stored).toHaveLength(1);
    expect(stored.filter((d) => d.isActive)).toHaveLength(1);
  });

  it("a new dashboard does not take over as the default Home; the first one does", async () => {
    const { businessId } = hz.A;
    const userId = await hz.h.createUser("home-default@test.local");
    await repos.memberships.add(hz.db, businessId, { userId, role: "admin" });
    const caller = hz.caller({ userId });
    const first = await caller.dashboard.create({ businessId, name: "Mine", preset: "seller" });
    expect(first.isActive).toBe(true);
    const second = await caller.dashboard.create({ businessId, name: "Investor update", preset: "investor" });
    expect(second.isActive).toBe(false);
    expect((await caller.dashboard.get({ businessId })).id).toBe(first.id);
    await caller.dashboard.update({ businessId, dashboardId: second.id, setActive: true });
    expect((await caller.dashboard.get({ businessId })).id).toBe(second.id);
  });

  for (const role of ["viewer", "advisor"] as const) {
    it(`a ${role} reads the Founder's view built for them, writes nothing, and every dashboard mutation says so (403, not 500)`, async () => {
      const { businessId } = hz.A;
      const userId = await hz.h.createUser(`home-${role}@test.local`);
      await repos.memberships.add(hz.db, businessId, { userId, role });
      const caller = hz.caller({ userId });
      const home = await caller.dashboard.get({ businessId });
      expect(home).toMatchObject({ id: UNSAVED_DASHBOARD_ID, stored: false, editable: false, name: "Home", preset: "founder", userId });
      expect(cardsOf(home.layout).length).toBeGreaterThan(0);
      expect(await repos.dashboards.list(hz.db, businessId, userId)).toHaveLength(0);
      // Reading a co-member's shared dashboard works, read-only.
      const ownerHome = await hz.caller({ userId: hz.A.ownerId }).dashboard.get({ businessId });
      expect(await caller.dashboard.get({ businessId, dashboardId: ownerHome.id })).toMatchObject({ editable: false, stored: true });
      expect(await caller.dashboard.list({ businessId })).toEqual([]);
      await expect(caller.dashboard.create({ businessId, name: "Mine", preset: "founder" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.dashboard.update({ businessId, dashboardId: ownerHome.id, name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.dashboard.delete({ businessId, dashboardId: ownerHome.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.dashboard.applyPreset({ businessId, dashboardId: ownerHome.id, preset: "builder" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.dashboard.compileMetric({ businessId, sentence: "customers won last 30 days" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await repos.dashboards.list(hz.db, businessId, userId)).toHaveLength(0);
    });
  }

  it("New › <preset>, a preset choice, Reset and the preview all store the one preset table", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const visible = (await repos.departments.list(hz.db, businessId)).length;
    const presets = await owner.dashboard.presets({ businessId });
    expect(presets.map((p) => p.id)).toEqual([...DASHBOARD_PRESETS]);
    for (const id of DASHBOARD_PRESETS) {
      const created = await owner.dashboard.create({ businessId, name: `Preset ${id}`, preset: id });
      const expected = presetWidgets(id, id === "founder" ? { departments: visible } : {});
      expect((created.layout as { widgets: unknown[] }).widgets).toEqual(expected);
      expect(presets.find((p) => p.id === id)!.layout).toEqual(created.layout);
      const applied = await owner.dashboard.applyPreset({ businessId, dashboardId: created.id, preset: id });
      expect((applied.layout as { widgets: unknown[] }).widgets).toEqual(expected);
    }
    const keys = (id: (typeof DASHBOARD_PRESETS)[number]) => PRESET_LAYOUTS[id].widgets.map((w) => w.key);
    // Each preset promises its widgets: Builder has Agent of the week, Seller the Live feed, Investor the two metrics.
    expect(keys("builder")).toContain("agent_of_the_week");
    expect(keys("seller")).toContain("live_feed");
    const investor = PRESET_LAYOUTS.investor.widgets;
    expect(investor.filter((w) => w.key === "custom_metric")).toHaveLength(2);
    expect(investor.find((w) => w.key === "journey_ribbon")!.settings).toMatchObject({ zoom: "all" });
  });

  it("every metric id a preset or the widget's hint names is in the catalogue", () => {
    expect([...CUSTOM_METRIC_EXAMPLE_IDS].every((id) => METRIC_IDS.includes(id))).toBe(true);
    for (const id of DASHBOARD_PRESETS) {
      for (const w of PRESET_LAYOUTS[id].widgets.filter((x) => x.key === "custom_metric")) expect(METRIC_IDS, `${id}: ${String(w.settings.queryId)}`).toContain(w.settings.queryId);
    }
  });

  it("the Founder's view has a department card for every visible department", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    for (const name of ["Ops one", "Ops two", "Ops three", "Ops four", "Ops five", "Ops six", "Ops seven"]) await repos.departments.create(hz.db, businessId, { name });
    const visible = (await repos.departments.list(hz.db, businessId)).length;
    expect(visible).toBeGreaterThan(6);
    const created = await owner.dashboard.create({ businessId, name: "Wide", preset: "founder" });
    const cards = cardsOf(created.layout);
    expect(cards).toHaveLength(visible);
    expect(cards.map((c) => c.settings.slot)).toEqual(Array.from({ length: visible }, (_, i) => i));
    // Nothing sits on top of the cards: the pulse and inbox start below the last card row.
    const widgets = (created.layout as { widgets: { key: string; y: number; h: number }[] }).widgets;
    const lastCardBottom = Math.max(...widgets.filter((w) => w.key === "department_card").map((w) => w.y + w.h));
    expect(widgets.find((w) => w.key === "squad_pulse")!.y).toBeGreaterThanOrEqual(lastCardBottom);
  });
});

describe("a taken business slug", () => {
  it("is a 409 on the slug field, not a 500 with the SQL", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const taken = (await repos.businesses.get(hz.db, hz.B.businessId)).slug;
    const err = (await owner.business.update({ businessId: hz.A.businessId, slug: taken }).catch((e: unknown) => e)) as TRPCError;
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("That slug is taken");
    expect((err.cause as { details?: unknown }).details).toEqual({ field: "slug" });
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).slug).not.toBe(taken);
  });

  it("any other unique violation is a conflict too, never an internal error echoing the statement", () => {
    const raw = Object.assign(new Error('Failed query: insert into "departments" (...) params: secret'), { cause: Object.assign(new Error('duplicate key value violates unique constraint "departments_business_id_slug_key"'), { code: "23505", constraint_name: "departments_business_id_slug_key" }) });
    const mapped = toTRPCError(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: raw.message, cause: raw }));
    expect(mapped.code).toBe("CONFLICT");
    expect(mapped.message).toBe("Another department already uses that address");
    const unknown = toTRPCError(new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "something_else_key" }) }));
    expect(unknown).toMatchObject({ code: "CONFLICT", message: "That already exists" });
  });
});

describe("departments: reset, create, merge and split keep tabs honest", () => {
  let businessId: string;
  let userId: string;
  const seed = getArchetypeSeed("b2b_saas");
  const tabsOf = async (departmentId: string) => (await repos.screens.list(hz.db, businessId, departmentId)).map((s) => s.tabSlug);

  beforeAll(async () => {
    userId = await hz.h.createUser("home-depts@test.local");
    const caller = hz.caller({ userId, email: "home-depts@test.local" });
    await caller.founder.profile.update({ displayName: "Reid", experience: "first-time", skills: { engineering: 14 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const idea = (await caller.idea.generate({ prompt: "bookkeeping for freelancers in the EU" })).ideas[0]!;
    const committed = await caller.idea.commit({ ideaId: idea.id, name: "Dept Test", archetype: "b2b_saas", gameMode: "personal", kit: { primary: "#1B4FD8", secondary: "#F5C400" } });
    businessId = committed.business.id;
  }, 120_000);

  const find = async (slug: string, includeArchived = false) => (await repos.departments.list(hz.db, businessId, { includeArchived, includeHidden: true })).find((d) => d.slug === slug);

  it("Reset to defaults brings back an archived department, with its tabs", async () => {
    const caller = hz.caller({ userId });
    const legal = (await find("legal"))!;
    await caller.department.archive({ businessId, departmentId: legal.id });
    expect(await find("legal")).toBeUndefined();
    const list = await caller.department.resetDefaults({ businessId });
    expect(list.map((d) => d.slug)).toContain("legal");
    const back = (await find("legal"))!;
    expect(back.id).toBe(legal.id);
    expect(back.archivedAt).toBeNull();
    expect(await tabsOf(back.id)).toEqual(MODULE_TABS.legal.map((t) => t.slug));
    expect(list.map((d) => d.slug).sort()).toEqual(seed.departments.map((d) => d.slug.replace(/_/g, "-")).sort());
  });

  it("creating a department named like an existing or archived one gets its own address, not a 500", async () => {
    const caller = hz.caller({ userId });
    const clash = await caller.department.create({ businessId, name: "Product", moduleKeys: [] });
    expect(clash.slug).toBe("product-2");
    const again = await caller.department.create({ businessId, name: "Product", moduleKeys: [] });
    expect(again.slug).toBe("product-3");
    await expect(caller.department.create({ businessId, name: "Anything", slug: "product" })).rejects.toMatchObject({ code: "CONFLICT" });
    // A name an archived department had.
    await caller.department.archive({ businessId, departmentId: clash.id });
    expect((await caller.department.create({ businessId, name: "Product", moduleKeys: [] })).slug).toBe("product-4");
  });

  it("merge then split moves the module's tabs with it: each department keeps only its own tabs", async () => {
    const caller = hz.caller({ userId });
    const legal = (await find("legal"))!;
    const finance = (await find("finance"))!;
    await caller.department.merge({ businessId, fromId: legal.id, intoId: finance.id });
    expect(new Set(await tabsOf(finance.id))).toEqual(new Set([...MODULE_TABS.finance, ...MODULE_TABS.legal].map((t) => t.slug)));
    const { created, source } = await caller.department.split({ businessId, sourceId: finance.id, department: { name: "Legal Desk", moduleKeys: ["legal"] } });
    expect(source.moduleKeys).toEqual(["finance"]);
    expect(await tabsOf(source.id)).toEqual(MODULE_TABS.finance.map((t) => t.slug));
    expect(await tabsOf(created.id)).toEqual(MODULE_TABS.legal.map((t) => t.slug));
    // No tab exists twice across the live departments.
    const all = await repos.departments.list(hz.db, businessId);
    const slugs = (await Promise.all(all.map((d) => tabsOf(d.id)))).flat();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("splitting into a name already in use still works (suffixed address)", async () => {
    const caller = hz.caller({ userId });
    const finance = (await find("finance"))!;
    const result = await caller.department.split({ businessId, sourceId: finance.id, department: { name: "Legal Desk", moduleKeys: [] } });
    expect(result.created.slug).toBe("legal-desk-2");
  });

  it("a hardware business, with seven departments, gets a card for each on its first Home", async () => {
    const hw = await hz.h.createUser("home-hardware@test.local");
    const caller = hz.caller({ userId: hw, email: "home-hardware@test.local" });
    await caller.founder.profile.update({ displayName: "Hal", experience: "first-time", skills: { engineering: 14 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const idea = (await caller.idea.generate({ prompt: "a smart bike lock" })).ideas[0]!;
    const committed = await caller.idea.commit({ ideaId: idea.id, name: "Lockworks", archetype: "hardware", gameMode: "personal", kit: { primary: "#1B4FD8", secondary: "#F5C400" } });
    const seeded = getArchetypeSeed("hardware").departments.length;
    expect(seeded).toBeGreaterThan(6);
    const [home] = await repos.dashboards.list(hz.db, committed.business.id, hw);
    expect(cardsOf(home!.layout)).toHaveLength(seeded);
  }, 120_000);
});

describe("the revenue metric", () => {
  it("sums every payment of the last 30 days (no page cap) and the widget names real metric ids", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const before = await owner.dashboard.customMetric.get({ businessId, queryId: "revenue_30d" });
    expect(before.format).toBe("money");
    // In the business's own currency: payments in another one are left out of the total, never added to it.
    const currency = (await repos.businesses.get(hz.db, businessId)).currency;
    await hz.db.insert(conversions).values(Array.from({ length: 1200 }, () => ({ businessId, kind: "payment" as const, amountMinor: 250, currency, occurredAt: new Date(Date.now() - 86_400_000) })));
    const after = await owner.dashboard.customMetric.get({ businessId, queryId: "revenue_30d" });
    expect(after.value).toBe((before.value ?? 0) + 1200 * 250);
    expect(after.currency).toBe(currency);
    // A revenue sentence compiles to it, with a preview.
    const compiled = await owner.dashboard.compileMetric({ businessId, sentence: "total revenue last month" });
    expect(compiled.queryId).toBe("revenue_30d");
    expect(compiled.preview.value).toBe(after.value);
    expect(METRICS.map((m) => m.queryId)).toEqual(METRIC_IDS);
  });
});

describe("journey.ribbon", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  it("refuses a range of centuries with BAD_REQUEST instead of walking chapters until it throws", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    await expect(owner.journey.ribbon({ businessId, to: "9999-12-31" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.journey.ribbon({ businessId, from: "1900-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.journey.ribbon({ businessId, from: shift(5), to: shift(1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await owner.journey.ribbon({ businessId, to: shift(700) })).chapters.length).toBeGreaterThan(1);
    expect(RibbonInput.safeParse({ from: shift(-3000), to: shift(700) }).success).toBe(true);
    expect(ribbonRange({}, Date.parse("2026-10-12T10:00:00Z"))).toEqual({ from: "2025-10-12", to: "2026-10-12" });
    expect(ribbonRange({ to: "2025-01-01" }, Date.parse("2026-10-12T10:00:00Z")).from <= "2025-01-01").toBe(true);
  });

  it("chapters carry the facts: quarter totals, milestones, stored titles, and the kick-off quarter's real day count", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    await hz.db.update(businesses).set({ committedAt: new Date("2025-11-15T10:00:00Z") }).where(eq(businesses.id, businessId));
    await hz.db.insert(conversions).values([
      { businessId, kind: "payment" as const, amountMinor: 9_900, currency: "EUR", occurredAt: new Date("2026-02-10T10:00:00Z") },
      { businessId, kind: "payment" as const, amountMinor: 4_900, currency: "EUR", occurredAt: new Date("2026-03-20T10:00:00Z") },
    ]);
    await repos.journeys.createMilestone(hz.db, businessId, { kind: "customer", label: "First customer", achievedAt: new Date("2026-02-10T12:00:00Z") });
    await repos.journeys.refreshDaily(hz.db);
    await repos.journeys.setChapterTitle(hz.db, businessId, { chapterId: "2026-Q1", title: "Paying customers arrive" });
    const request = vi.spyOn(hz.deps.composer, "requestChapterTitle").mockImplementation(() => undefined);
    try {
      const res = await owner.journey.ribbon({ businessId, from: "2026-04-01", to: today(), slim: true });
      const byId = new Map(res.chapters.map((c) => [c.id, c]));
      expect(res.chapters[0]).toMatchObject({ id: "2025-Q4", summary: { days: 47 } }); // 15 Nov – 31 Dec
      const q1 = byId.get("2026-Q1")!;
      expect(q1.title).toBe("Paying customers arrive");
      expect(q1.summary).toMatchObject({ revenueMinor: 14_800, payments: 2, milestoneLabels: ["First customer"] });
      expect(q1.provisionalTitle).not.toBe("Steady progress");
      // The range on screen (April on) does not blind the chapters before it; ended quarters with no title are asked about (at most two, newest first).
      const asked = request.mock.calls.map((c) => c[1]);
      expect(asked).not.toContain("2026-Q1");
      expect(asked.length).toBeLessThanOrEqual(2);
      for (const id of asked) expect(byId.get(id)!.status).toBe("past");
    } finally {
      request.mockRestore();
    }
  });

  it("asks the composer only about ended quarters without a title, newest first, two at a time", () => {
    const chapters = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"].map((id, i) => ({ id, endsOn: ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"][i]! }));
    expect(untitledEndedChapters(chapters, { "2025-Q4": "Done" }, "2026-02-01").map((c) => c.id)).toEqual(["2025-Q3", "2025-Q2"]);
    expect(untitledEndedChapters(chapters, {}, "2025-01-01")).toEqual([]);
  });
});

describe("demo businesses on the network", () => {
  it("an outsider does not see a demo's community; its own member does", async () => {
    const demo = hz.A.businessId;
    const real = hz.B.businessId;
    for (const id of [demo, real]) {
      await repos.businesses.setGameMode(hz.db, id, "live");
      await repos.businesses.commit(hz.db, id, { archetype: "b2b_saas" });
    }
    await hz.db.update(businesses).set({ isDemo: true }).where(eq(businesses.id, demo));
    const community = await repos.social.createCommunity(hz.db, { name: "Demo room", slug: "demo-home-room", ownerBusinessId: demo, createdBy: hz.A.ownerId });
    const outsider = await hz.h.createUser("home-outsider@test.local");

    const asOutsider = hz.caller({ userId: outsider });
    expect((await asOutsider.live.communities.list()).map((c) => c.id)).not.toContain(community.id);
    await expect(asOutsider.live.communities.get({ communityId: community.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(asOutsider.live.communities.join({ communityId: community.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const asDemoOwner = hz.caller({ userId: hz.A.ownerId });
    expect((await asDemoOwner.live.communities.get({ communityId: community.id })).community.id).toBe(community.id);
  });
});
