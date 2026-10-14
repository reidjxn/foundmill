/**
 * Home and navigation data (0044): dashboards (shared reads, one default, idempotent first Home), a taken slug, department
 * slugs, malformed cursors, thread paging, rejoining a community, demo businesses kept off the network, revenue sums,
 * quarter totals and chapter titles.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { decodeTimeCursor, encodeCursor, uniqueViolation } from "../../repos/_shared";
import { screenModule } from "../../repos/screens";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("home");
});
afterAll(() => r?.close());

describe("dashboards: one default Home, added tabs, promotion on delete", () => {
  it("a new tab never takes the default; the first dashboard is the default", async () => {
    const A = r.A.businessId;
    const user = r.A.memberId;
    const first = await repos.dashboards.add(r.db, A, { userId: user, name: "Home", preset: "founder", layout: { widgets: [] } });
    expect(first.isActive).toBe(true);
    const second = await repos.dashboards.add(r.db, A, { userId: user, name: "Investor update", preset: "investor", layout: { widgets: [] }, isActive: true });
    expect(second.isActive).toBe(false);
    expect((await repos.dashboards.active(r.db, A, user))?.id).toBe(first.id);
    // "Make default" moves it, and still exactly one is the default.
    await repos.dashboards.setActive(r.db, A, second.id);
    expect((await repos.dashboards.list(r.db, A, user)).filter((d) => d.isActive).map((d) => d.id)).toEqual([second.id]);
  });

  it("deleting the default Home promotes the oldest remaining dashboard", async () => {
    const A = r.A.businessId;
    const user = r.A.adminId;
    const home = await repos.dashboards.add(r.db, A, { userId: user, name: "Home", layout: { widgets: [] } });
    const other = await repos.dashboards.add(r.db, A, { userId: user, name: "Seller", layout: { widgets: [] } });
    await repos.dashboards.delete(r.db, A, home.id);
    expect((await repos.dashboards.active(r.db, A, user))?.id).toBe(other.id);
    // Deleting the last one leaves none (the next Home read creates a fresh one).
    await repos.dashboards.delete(r.db, A, other.id);
    expect(await repos.dashboards.active(r.db, A, user)).toBeNull();
  });

  it("two first loads at once make one Home (ensureActive is idempotent)", async () => {
    const A = r.A.businessId;
    const user = r.A.viewerId;
    const input = { userId: user, name: "Home", preset: "founder" as const, layout: { widgets: [] } };
    const [one, two, three] = await Promise.all([repos.dashboards.ensureActive(r.db, A, input), repos.dashboards.ensureActive(r.db, A, input), repos.dashboards.ensureActive(r.db, A, input)]);
    expect(two.id).toBe(one.id);
    expect(three.id).toBe(one.id);
    expect(await repos.dashboards.list(r.db, A, user)).toHaveLength(1);
  });

  it("the database refuses a second active dashboard (the index behind the idempotency)", async () => {
    const A = r.A.businessId;
    const user = r.A.ownerId;
    await repos.dashboards.ensureActive(r.db, A, { userId: user, name: "Home", layout: { widgets: [] } });
    const err = await r.db.insert(s.dashboardLayouts).values({ businessId: A, userId: user, name: "Duplicate", isActive: true }).catch((e: unknown) => e);
    expect(uniqueViolation(err)).toEqual({ constraint: "dashboard_layouts_one_active_key" });
  });
});

describe("a taken slug is a conflict on the slug field, not a database error", () => {
  it("businesses.update names the field and leaks no statement", async () => {
    const taken = (await repos.businesses.get(r.db, r.B.businessId)).slug;
    const err = await repos.businesses.update(r.db, r.A.businessId, { slug: taken }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "conflict", message: "That slug is taken", details: { field: "slug" } });
    expect(String((err as Error).message)).not.toMatch(/insert|update "|params/i);
    // Its own slug, and a free one, still save.
    const own = (await repos.businesses.get(r.db, r.A.businessId)).slug;
    expect((await repos.businesses.update(r.db, r.A.businessId, { slug: own })).slug).toBe(own);
    expect((await repos.businesses.update(r.db, r.A.businessId, { slug: `${own}-two` })).slug).toBe(`${own}-two`);
    await repos.businesses.update(r.db, r.A.businessId, { slug: own });
  });

  it("uniqueViolation finds the constraint through the driver's wrapper", async () => {
    const taken = (await repos.businesses.get(r.db, r.B.businessId)).slug;
    const err = await r.db.update(s.businesses).set({ slug: taken }).where(eq(s.businesses.id, r.A.businessId)).catch((e: unknown) => e);
    expect(uniqueViolation(err)).toEqual({ constraint: "businesses_slug_key" });
    expect(uniqueViolation(new Error("nope"))).toBeUndefined();
  });
});

describe("department slugs and archived departments", () => {
  it("a name an archived department had still gets a department of its own (suffixed slug)", async () => {
    const A = r.A.businessId;
    const growth = await repos.departments.create(r.db, A, { name: "Growth Ops", moduleKeys: ["distribution"] });
    expect(growth.slug).toBe("growth-ops");
    const second = await repos.departments.create(r.db, A, { name: "Growth Ops", moduleKeys: [] });
    expect(second.slug).toBe("growth-ops-2");
    await repos.departments.archive(r.db, A, growth.id);
    const third = await repos.departments.create(r.db, A, { name: "Growth Ops" });
    expect(third.slug).toBe("growth-ops-3");
  });

  it("an explicit slug that is taken (live or archived) is a conflict on the slug field", async () => {
    const A = r.A.businessId;
    await repos.departments.create(r.db, A, { name: "Studio", slug: "studio" });
    await expect(repos.departments.create(r.db, A, { name: "Another studio", slug: "studio" })).rejects.toMatchObject({ code: "conflict", details: { field: "slug" } });
  });

  it("unarchive brings a department back visible", async () => {
    const A = r.A.businessId;
    const d = await repos.departments.create(r.db, A, { name: "Counsel", moduleKeys: ["legal"] });
    await repos.departments.archive(r.db, A, d.id);
    expect((await repos.departments.list(r.db, A)).map((x) => x.id)).not.toContain(d.id);
    const back = await repos.departments.unarchive(r.db, A, d.id);
    expect(back.archivedAt).toBeNull();
    expect(back.hidden).toBe(false);
    expect((await repos.departments.list(r.db, A)).map((x) => x.id)).toContain(d.id);
  });
});

describe("screens move with their module", () => {
  it("screenModule reads the module off a tab's first module widget", () => {
    expect(screenModule({ widgets: [{ key: "module:legal/contracts" }] })).toBe("legal");
    expect(screenModule({ widgets: [{ key: "status_strip" }, { key: "module:product_spec/spec" }] })).toBe("product_spec");
    expect(screenModule({ widgets: [{ key: "status_strip" }] })).toBeNull();
    expect(screenModule(null)).toBeNull();
  });

  it("moveTo, archiveMany and setPositions change only the named tabs", async () => {
    const A = r.A.businessId;
    const from = await repos.departments.create(r.db, A, { name: "From" });
    const to = await repos.departments.create(r.db, A, { name: "To" });
    const a = await repos.screens.upsert(r.db, A, { departmentId: from.id, tabSlug: "a", title: "A", position: 0, layout: { widgets: [] } });
    const b = await repos.screens.upsert(r.db, A, { departmentId: from.id, tabSlug: "b", title: "B", position: 1, layout: { widgets: [] } });
    const c = await repos.screens.upsert(r.db, A, { departmentId: from.id, tabSlug: "c", title: "C", position: 2, layout: { widgets: [] } });
    await repos.screens.moveTo(r.db, A, [a.id], to.id);
    await repos.screens.archiveMany(r.db, A, [b.id]);
    await repos.screens.setPositions(r.db, A, [{ id: c.id, position: 2 }]);
    expect((await repos.screens.list(r.db, A, from.id)).map((x) => x.tabSlug)).toEqual(["c"]);
    expect((await repos.screens.list(r.db, A, to.id)).map((x) => x.tabSlug)).toEqual(["a"]);
    expect(await repos.screens.moveTo(r.db, A, [], to.id)).toEqual([]);
  });
});

describe("time cursors are checked before they reach SQL", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("accepts what cursorOf writes and refuses anything else with a ValidationError", () => {
    expect(decodeTimeCursor(encodeCursor("2026-10-12T10:00:00.123Z", id))).toEqual({ at: "2026-10-12T10:00:00.123Z", id });
    for (const bad of [encodeCursor("not a date", id), encodeCursor("2026-10-12T10:00:00.000Z", "not-a-uuid"), encodeCursor("2026-13-45T10:00:00.000Z", id), encodeCursor("2026-02-31T10:00:00.000Z", id), encodeCursor("0000-01-01T00:00:00.000Z", id), encodeCursor("2026-10-12", id), encodeCursor("2026-10-12T10:00:00Z", id), encodeCursor("'; drop table x; --", id), "%%%", Buffer.from("{}").toString("base64url")]) {
      expect(() => decodeTimeCursor(bad), bad).toThrow(/Malformed pagination cursor/);
    }
  });

  it("a keyset list answers a malformed cursor with a validation error, never a Postgres cast error", async () => {
    const bad = encodeCursor("not a date", id);
    await expect(repos.social.listThreads(r.db, r.A.ownerId, { cursor: bad })).rejects.toMatchObject({ code: "validation" });
    await expect(repos.journeys.listConversions(r.db, r.A.businessId, { cursor: bad })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("live.messages.threads pages by the order it sorts by", () => {
  it("every thread appears once across pages, newest activity first", async () => {
    const me = r.A.ownerId;
    const others = [r.A.adminId, r.A.memberId, r.A.viewerId, r.B.ownerId, r.B.adminId];
    const threads = [];
    for (const [i, other] of others.entries()) threads.push(await repos.social.findOrCreateThread(r.db, me, [other], `Thread ${i}`));
    // Created in order 0..4; the latest activity (last message, else creation) is thread 2, 0, 4, 3 (no message), 1.
    const lastMessageAt = [new Date("2026-10-05T10:00:00Z"), new Date("2026-10-02T10:00:00Z"), new Date("2026-10-06T10:00:00Z"), null, new Date("2026-10-04T10:00:00Z")];
    for (const [i, t] of threads.entries()) await r.db.update(s.messageThreads).set({ lastMessageAt: lastMessageAt[i]!, createdAt: new Date(`2026-10-0${i + 1}T08:00:00Z`) }).where(eq(s.messageThreads.id, t.id));
    const seen: string[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 5; page++) {
      const p = await repos.social.listThreads(r.db, me, { limit: 2, cursor: cursor ?? undefined });
      seen.push(...p.items.map((t) => t.id));
      cursor = p.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([threads[2]!.id, threads[0]!.id, threads[4]!.id, threads[3]!.id, threads[1]!.id]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("rejoining a community", () => {
  it("counts a returning member once, however many joins race, and takes the business chosen now", async () => {
    const community = await repos.social.createCommunity(r.db, { name: "Rejoin room", slug: "rejoin-room", createdBy: r.A.ownerId });
    const person = r.B.memberId;
    await repos.social.joinCommunity(r.db, person, community.id, { businessId: r.B.businessId });
    await repos.social.leaveCommunity(r.db, person, community.id);
    const count = async () => (await repos.social.getCommunity(r.db, community.id)).memberCount;
    const afterLeave = await count();
    const joins = await Promise.all([1, 2, 3].map(() => repos.social.joinCommunity(r.db, person, community.id, { businessId: null })));
    expect(joins.every((m) => m.status === "active")).toBe(true);
    expect(await count()).toBe(afterLeave + 1);
    // Joining again as someone else's business changes who they speak as, and counts nobody new.
    const again = await repos.social.joinCommunity(r.db, person, community.id, { businessId: r.B.businessId });
    expect(again.businessId).toBe(r.B.businessId);
    expect(await count()).toBe(afterLeave + 1);
    const back = await repos.social.joinCommunity(r.db, person, community.id, { businessId: null });
    expect(back.businessId).toBeNull();
  });

  it("a rejoin after leaving uses the business chosen at the rejoin, not the old label", async () => {
    const community = await repos.social.createCommunity(r.db, { name: "Label room", slug: "label-room", createdBy: r.A.ownerId });
    const person = r.B.viewerId;
    await repos.social.joinCommunity(r.db, person, community.id, { businessId: r.B.businessId });
    await repos.social.leaveCommunity(r.db, person, community.id);
    const rejoined = await repos.social.joinCommunity(r.db, person, community.id, { businessId: null });
    expect(rejoined.businessId).toBeNull();
  });
});

describe("demo businesses stay off the network for everyone outside them", () => {
  let demo: string;
  let real: string;
  let outsider: string;
  beforeAll(async () => {
    demo = r.A.businessId;
    real = r.B.businessId;
    outsider = await r.h.createUser("home-outsider@test.local");
    for (const id of [demo, real]) {
      await repos.businesses.setGameMode(r.db, id, "live");
      await repos.businesses.commit(r.db, id, { archetype: "b2b_saas" });
    }
    await r.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, demo));
  });

  it("is_public and the public profiles leave a demo out", async () => {
    expect(await repos.social.publicProfile(r.db, demo)).toBeNull();
    expect((await repos.social.publicProfile(r.db, real))?.businessId).toBe(real);
    const isPublic = (id: string) => r.db.execute(sql`select is_public(${id}::uuid) as ok`).then((res) => (res as unknown as { rows: { ok: boolean }[] }).rows[0]!.ok);
    expect(await isPublic(demo)).toBe(false);
    expect(await isPublic(real)).toBe(true);
  });

  it("a leaderboard shows a demo's entry to its own members only, and real businesses rank ahead of it", async () => {
    const board = await repos.social.upsertLeaderboard(r.db, { boardKind: "demo_kind", period: "2026-Q4", metric: "customers_won", archetype: "b2b_saas" });
    const ranked = await repos.social.setLeaderboardEntries(r.db, board.id, [
      { businessId: demo, metricValue: 500 },
      { businessId: real, metricValue: 3 },
    ]);
    expect(ranked.map((e) => [e.businessId, e.position])).toEqual([[real, 1], [demo, 2]]);
    const seenBy = async (viewerId: string) => (await repos.social.leaderboardEntries(r.db, board.id, 100, { viewerId })).map((e) => e.businessId);
    expect(await seenBy(outsider)).toEqual([real]);
    expect(await seenBy(r.B.ownerId)).toEqual([real]);
    expect(await seenBy(r.A.ownerId)).toEqual([real, demo]);
  });

  it("a demo's public community is listed for its own members and its community's members only", async () => {
    const community = await repos.social.createCommunity(r.db, { name: "Demo room", slug: "demo-room", ownerBusinessId: demo, createdBy: r.A.memberId });
    const listed = async (viewerId: string) => (await repos.social.listCommunities(r.db, { viewerId })).map((c) => c.id);
    expect(await listed(outsider)).not.toContain(community.id);
    expect(await listed(r.B.ownerId)).not.toContain(community.id);
    expect(await listed(r.A.ownerId)).toContain(community.id);
    expect(await listed(r.A.memberId)).toContain(community.id);
    expect([...(await repos.social.demoBusinessesHiddenFrom(r.db, outsider, [demo, real, null]))]).toEqual([demo]);
    expect((await repos.social.demoBusinessesHiddenFrom(r.db, r.A.ownerId, [demo])).size).toBe(0);
  });
});

describe("revenue is summed in SQL, per currency", () => {
  it("sums every payment (no page cap) and keeps currencies apart", async () => {
    const B = r.B.businessId;
    const from = new Date("2026-09-01T00:00:00Z");
    // More payments than one page can hold.
    await r.db.insert(s.conversions).values(Array.from({ length: 640 }, () => ({ businessId: B, kind: "payment" as const, amountMinor: 1000, currency: "GBP", occurredAt: new Date("2026-09-10T10:00:00Z") })));
    await r.db.insert(s.conversions).values([
      { businessId: B, kind: "payment" as const, amountMinor: 5000, currency: "USD", occurredAt: new Date("2026-09-11T10:00:00Z") },
      { businessId: B, kind: "signup" as const, amountMinor: 0, currency: "GBP", occurredAt: new Date("2026-09-11T10:00:00Z") },
    ]);
    const sums = await repos.journeys.sumConversions(r.db, B, { from, kind: "payment" });
    expect(sums).toEqual([
      { currency: "GBP", amountMinor: 640_000, count: 640 },
      { currency: "USD", amountMinor: 14_800, count: 3 }, // the fixture's own two payments (9,800) and the 5,000 added here
    ]);
    expect(await repos.journeys.sumConversions(r.db, r.A.businessId, { from: new Date("2030-01-01T00:00:00Z"), kind: "payment" })).toEqual([]);
  });
});

describe("chapters: quarter totals and stored titles", () => {
  it("quarterTotals folds the business-wide daily rows into one row per quarter", async () => {
    const B = r.B.businessId;
    // Daily rows come from the matview; a refresh after seeding conversions shows the quarters it holds.
    await repos.journeys.refreshDaily(r.db);
    const rows = await repos.journeys.quarterTotals(r.db, B, { from: "2026-01-01", to: "2026-12-31" });
    const q3 = rows.find((q) => q.day === "2026-07-01");
    expect(q3).toBeDefined();
    expect(q3!.payments).toBeGreaterThanOrEqual(640);
    expect(rows.every((q) => /^\d{4}-(01|04|07|10)-01$/.test(q.day))).toBe(true);
  });

  it("stores a title once per quarter and replaces it on a rewrite", async () => {
    const B = r.B.businessId;
    expect(await repos.journeys.chapterTitles(r.db, B)).toEqual({});
    await repos.journeys.setChapterTitle(r.db, B, { chapterId: "2026-Q3", title: "First paying customers", subtitle: "Summer", mood: "rising" });
    await repos.journeys.setChapterTitle(r.db, B, { chapterId: "2026-Q3", title: "The first hundred", mood: "breakthrough" });
    expect(await repos.journeys.chapterTitles(r.db, B)).toEqual({ "2026-Q3": "The first hundred" });
    expect(await repos.journeys.chapterTitles(r.db, r.A.businessId)).toEqual({});
    await expect(repos.journeys.setChapterTitle(r.db, B, { chapterId: "Q3-2026", title: "x" })).rejects.toThrow();
  });
});
