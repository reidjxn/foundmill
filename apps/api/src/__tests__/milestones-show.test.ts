/**
 * Milestones a founder chooses to show (services/milestones.ts; migration 0087; docs/NETWORK.md F2 and F3).
 *
 * Publishing the page records "Page live" once, in the same transaction; an owner or an admin shows a reached milestone
 * and hides it again (events through the outbox, audited), a member, a viewer and another business's people cannot;
 * showing needs a published page and is refused for a sample business; the signed-out story and card give the label and
 * the date only (never a customer), and nothing for a private milestone, a page taken down, an archived business or a
 * sample business; `publicPage.bySlug` says whether there is a story; the reads are limited like the page read.
 *
 * The date of "Page live" is the page's, and the page's is the database's (0088): a signed-in owner who writes to the
 * tables directly, around the api, moves neither, and cannot delete the milestone to have it recorded again.
 */
import { repos } from "@foundmill/db";
import { MILESTONE_NEEDS_PAGE_MESSAGE, MILESTONE_NOT_FOUND_MESSAGE, MILESTONE_NOT_SHOWABLE_MESSAGE, MILESTONE_SAMPLE_MESSAGE, MILESTONE_SHOW_ROLE_MESSAGE, type ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_STORY_LIMITS, publicCardById, publicCardLimitKeys, publicStoryBySlug, publicStoryLimitKeys } from "../services/milestones";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "mshow" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand in Leeds.", forWhom: "", stage: "building", showFounders: false, followForm: true, ...over });

let n = 0;
async function project(name: string, options: { demo?: boolean } = {}) {
  n += 1;
  const [ownerId, adminId, memberId, viewerId] = await Promise.all(["owner", "admin", "member", "viewer"].map((r) => hz.h.createUser(`mshow-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  if (options.demo) await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  for (const [userId, role] of [[ownerId, "owner"], [adminId, "admin"], [memberId, "member"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  return { id: b.id, name: b.name, ownerId: ownerId!, owner: hz.caller({ userId: ownerId! }), admin: hz.caller({ userId: adminId! }), member: hz.caller({ userId: memberId! }), viewer: hz.caller({ userId: viewerId! }) };
}
type Project = Awaited<ReturnType<typeof project>>;

const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");
const keyOf = (m: { ref?: unknown }) => (m.ref as { trophyKey?: string } | null)?.trophyKey ?? null;
const milestones = async (businessId: string) => repos.journeys.listMilestones(hz.db, businessId);
const byKey = async (businessId: string, key: string) => (await milestones(businessId)).find((m) => keyOf(m) === key);
const shownEvents = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type.startsWith("milestone.")).map((o) => ({ type: o.event.type, payload: o.event.payload }));
/** A milestone as ingest or the nightly sweep records it, on the service connection. */
const record = async (businessId: string, key: string, label: string, ref: Record<string, unknown> = {}) => (await repos.journeys.awardMilestone(hz.db, businessId, { kind: "customer", label, achievedAt: new Date("2026-11-19T10:00:00Z"), ref: { trophyKey: key, ...ref } }))!;

async function fill(key: string, rule: { limit: number; windowMs: number }) {
  for (let i = 0; i < rule.limit; i++) await hz.limits.take([{ key, rule }]);
}
async function hits(key: string, windowMs = 60_000): Promise<number> {
  const probe = await hz.limits.take([{ key, rule: { limit: 100_000, windowMs } }]);
  if (!probe.ok) throw new Error("probe refused");
  await hz.limits.refund(probe.ticket);
  return 100_000 - 1 - probe.remaining;
}

/** A project with a live page and its "Page live" milestone. */
async function live(name: string): Promise<Project & { slug: string; pageLiveId: string }> {
  const b = await project(name);
  const published = await b.owner.page.publish({ businessId: b.id, content: page() });
  return { ...b, slug: published.page.slug, pageLiveId: (await byKey(b.id, "page_live"))!.id };
}

describe("publishing the page records \"Page live\"", () => {
  it("once, at the moment the page went live, with the page's id; publishing changes and putting it back up award nothing new", async () => {
    const b = await project("First Publish");
    expect(await milestones(b.id)).toEqual([]);
    // A saved draft is not a live page.
    await b.member.page.saveDraft({ businessId: b.id, draft: page() });
    expect(await milestones(b.id)).toEqual([]);

    const first = await b.admin.page.publish({ businessId: b.id, content: page() });
    const row = (await repos.pages.get(hz.db, b.id))!;
    const reached = await milestones(b.id);
    expect(reached).toHaveLength(1);
    expect(reached[0]).toMatchObject({ kind: "trophy", label: "Page live", visibility: "private" });
    expect(reached[0]!.achievedAt.toISOString()).toBe(first.page.publishedAt!.toISOString());
    expect(reached[0]!.ref).toEqual({ trophyKey: "page_live", pageId: row.id });
    // Reached, and private until a founder shows it: nothing is public on its own.
    const anon = hz.caller(null);
    expect((await anon.publicPage.bySlug({ slug: first.page.slug }))!.story).toBe(false);
    expect(await anon.publicPage.storyBySlug({ slug: first.page.slug })).toBeNull();
    expect(await anon.publicPage.cardById({ id: reached[0]!.id })).toBeNull();
    // The console reads it with the others.
    const today = new Date().toISOString().slice(0, 10);
    const ribbon = await b.member.journey.ribbon({ businessId: b.id, from: today, to: today });
    expect(ribbon.milestones.map((m) => [m.id, m.label, m.visibility])).toEqual([[reached[0]!.id, "Page live", "private"]]);

    await b.owner.page.publish({ businessId: b.id, content: page({ stage: "live" }) });
    await b.owner.page.unpublish({ businessId: b.id });
    await b.owner.page.publish({ businessId: b.id, content: page() });
    const after = await milestones(b.id);
    expect(after.map((m) => [m.id, m.achievedAt.toISOString()])).toEqual([[reached[0]!.id, first.page.publishedAt!.toISOString()]]);
  });

  it("the date is the database's: an owner writing around the api cannot backdate the page or the milestone", async () => {
    const b = await project("Honest Date");
    const first = await b.owner.page.publish({ businessId: b.id, content: page() });
    const wentLive = first.page.publishedAt!;
    expect(Math.abs(wentLive.getTime() - Date.now())).toBeLessThan(60_000);
    const milestone = (await byKey(b.id, "page_live"))!;
    expect(milestone.achievedAt).toEqual(wentLive);

    // The owner's own session, straight at the tables (as PostgREST would carry it).
    const direct = hz.h.asUser(b.ownerId);
    await direct.execute(sql`update project_pages set published_at = '2020-01-01T00:00:00Z' where business_id = ${b.id}`);
    await expect(direct.execute(sql`update milestones set achieved_at = '2020-01-01T00:00:00Z' where id = ${milestone.id}`)).rejects.toThrow(/not changed by hand/);
    await expect(direct.execute(sql`delete from milestones where id = ${milestone.id}`)).rejects.toThrow(/not deleted by hand/);
    await expect(direct.execute(sql`insert into milestones (business_id, kind, label, achieved_at, ref) values (${b.id}, 'trophy', 'Page live', '2020-01-01T00:00:00Z', ${JSON.stringify({ trophyKey: "page_live", pageId: (await repos.pages.get(hz.db, b.id))!.id })}::jsonb)`)).rejects.toThrow();

    // Shown, the story and the card carry the day the page really went live, and so does the page.
    await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: milestone.id });
    const anon = hz.caller(null);
    expect((await anon.publicPage.bySlug({ slug: first.page.slug }))!.publishedAt).toEqual(wentLive);
    expect((await anon.publicPage.storyBySlug({ slug: first.page.slug }))!.milestones.map((m) => m.achievedAt)).toEqual([wentLive]);
    expect((await anon.publicPage.cardById({ id: milestone.id }))!.milestone.achievedAt).toEqual(wentLive);

    // Publishing changes through the api afterwards still works and still keeps the date.
    const again = await b.owner.page.publish({ businessId: b.id, content: page({ stage: "live" }) });
    expect(again.page.publishedAt).toEqual(wentLive);
    expect((await byKey(b.id, "page_live"))!.achievedAt).toEqual(wentLive);
  });

  it("a held page and a sample business record nothing", async () => {
    const held = await project("Held Page");
    expect((await held.owner.page.publish({ businessId: held.id, content: page({ about: "Write to maya@example.com for an order." }) })).outcome).toBe("held");
    expect(await milestones(held.id)).toEqual([]);
    const sample = await project("Sample", { demo: true });
    expect(await code(sample.owner.page.publish({ businessId: sample.id, content: page() }))).toBe("CONFLICT");
    expect(await milestones(sample.id)).toEqual([]);
  });
});

describe("journey.showMilestone and journey.hideMilestone", () => {
  it("an owner shows a reached milestone: it becomes the story and a card, with its event and audit row; an admin hides it", async () => {
    const b = await live("Show And Hide");
    const anon = hz.caller(null);
    const shown = await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId });
    const cardUrl = `http://localhost:3000/m/${b.pageLiveId}`;
    expect(shown).toEqual({ milestoneId: b.pageLiveId, key: "page_live", shown: true, url: cardUrl, storyUrl: `http://localhost:3000/p/${b.slug}/story` });
    expect((await byKey(b.id, "page_live"))!.visibility).toBe("public");
    expect(await shownEvents(b.id)).toEqual([{ type: "milestone.shown", payload: { milestoneId: b.pageLiveId, key: "page_live", slug: b.slug, url: cardUrl } }]);
    const audits = (await repos.audit.list(hz.db, b.id, { action: "milestone.shown" })).items;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorKind: "user", target: { kind: "milestone", id: b.pageLiveId }, details: { key: "page_live", slug: b.slug } });

    // Signed out: the project as its page shows it, and the milestone's label and date.
    const story = await anon.publicPage.storyBySlug({ slug: b.slug });
    const achievedAt = (await byKey(b.id, "page_live"))!.achievedAt;
    expect(story).toEqual({
      slug: b.slug,
      name: b.name,
      pageUrl: `http://localhost:3000/p/${b.slug}`,
      storyUrl: `http://localhost:3000/p/${b.slug}/story`,
      brandPrimary: expect.any(String),
      brandSecondary: expect.any(String),
      logo: null,
      mark: true,
      milestones: [{ id: b.pageLiveId, key: "page_live", label: "Page live", achievedAt, url: cardUrl }],
    });
    const card = await anon.publicPage.cardById({ id: b.pageLiveId });
    expect(card).toEqual({ ...story, milestones: undefined, milestone: story!.milestones[0] });
    expect(card).not.toHaveProperty("milestones");
    expect((await anon.publicPage.bySlug({ slug: b.slug }))!.story).toBe(true);
    // The mark is the free plan's; a paid plan removes it from the story and the card too.
    await repos.businesses.update(hz.db, b.id, { planTier: "pro" });
    expect((await anon.publicPage.storyBySlug({ slug: b.slug }))!.mark).toBe(false);
    expect((await anon.publicPage.cardById({ id: b.pageLiveId }))!.mark).toBe(false);
    await repos.businesses.update(hz.db, b.id, { planTier: "free" });

    // A second press changes nothing twice.
    expect((await b.admin.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId })).shown).toBe(true);
    expect(await shownEvents(b.id)).toHaveLength(1);

    const hidden = await b.admin.journey.hideMilestone({ businessId: b.id, milestoneId: b.pageLiveId });
    expect(hidden).toMatchObject({ milestoneId: b.pageLiveId, shown: false, url: cardUrl });
    expect((await byKey(b.id, "page_live"))!.visibility).toBe("private");
    expect((await shownEvents(b.id)).map((e) => e.type)).toEqual(["milestone.shown", "milestone.hidden"]);
    expect((await repos.audit.list(hz.db, b.id, { action: "milestone.hidden" })).items).toHaveLength(1);
    expect(await anon.publicPage.storyBySlug({ slug: b.slug })).toBeNull();
    expect(await anon.publicPage.cardById({ id: b.pageLiveId })).toBeNull();
    expect((await anon.publicPage.bySlug({ slug: b.slug }))!.story).toBe(false);
    expect((await b.owner.journey.hideMilestone({ businessId: b.id, milestoneId: b.pageLiveId })).shown).toBe(false);
    expect(await shownEvents(b.id)).toHaveLength(2);
  });

  it("a member and a viewer cannot show or hide; nobody signed out can", async () => {
    const b = await live("Roles");
    for (const who of [b.member, b.viewer]) {
      expect(await code(who.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId }))).toBe("FORBIDDEN");
    }
    expect(await code(hz.caller(null).journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId }))).toBe("UNAUTHORIZED");
    expect((await byKey(b.id, "page_live"))!.visibility).toBe("private");
    await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId });
    for (const who of [b.member, b.viewer]) {
      expect(await code(who.journey.hideMilestone({ businessId: b.id, milestoneId: b.pageLiveId }))).toBe("FORBIDDEN");
    }
    expect(await code(hz.caller(null).journey.hideMilestone({ businessId: b.id, milestoneId: b.pageLiveId }))).toBe("UNAUTHORIZED");
    expect((await byKey(b.id, "page_live"))!.visibility).toBe("public");
    expect(await shownEvents(b.id)).toHaveLength(1);
    expect(MILESTONE_SHOW_ROLE_MESSAGE).toMatch(/owner or an admin/);
  });

  it("another business's owner cannot show or hide a milestone, under either business's id", async () => {
    const a = await live("Alpha");
    const other = await live("Bravo");
    await a.owner.journey.showMilestone({ businessId: a.id, milestoneId: a.pageLiveId });
    for (const who of [other.owner, other.admin, other.member]) {
      expect(await code(who.journey.hideMilestone({ businessId: a.id, milestoneId: a.pageLiveId }))).toBe("FORBIDDEN");
      expect(await code(who.journey.showMilestone({ businessId: a.id, milestoneId: a.pageLiveId }))).toBe("FORBIDDEN");
    }
    // Under their own business the other project's milestone does not exist.
    await expect(other.owner.journey.hideMilestone({ businessId: other.id, milestoneId: a.pageLiveId })).rejects.toMatchObject({ code: "NOT_FOUND", message: MILESTONE_NOT_FOUND_MESSAGE });
    await expect(other.owner.journey.showMilestone({ businessId: other.id, milestoneId: a.pageLiveId })).rejects.toMatchObject({ code: "NOT_FOUND", message: MILESTONE_NOT_FOUND_MESSAGE });
    expect((await byKey(a.id, "page_live"))!.visibility).toBe("public");
    expect((await byKey(other.id, "page_live"))!.visibility).toBe("private");
    expect(await shownEvents(other.id)).toEqual([]);
    expect((await hz.caller(null).publicPage.storyBySlug({ slug: a.slug }))!.milestones).toHaveLength(1);
  });

  it("showing needs a published page, in one plain sentence; hiding never does", async () => {
    const b = await project("No Page Yet");
    const follower = await record(b.id, "first_follower", "First follower");
    await expect(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: follower.id })).rejects.toMatchObject({ code: "CONFLICT", message: MILESTONE_NEEDS_PAGE_MESSAGE });
    await b.member.page.saveDraft({ businessId: b.id, draft: page() });
    await expect(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: follower.id })).rejects.toMatchObject({ code: "CONFLICT", message: MILESTONE_NEEDS_PAGE_MESSAGE });
    expect((await byKey(b.id, "first_follower"))!.visibility).toBe("private");
    expect(await shownEvents(b.id)).toEqual([]);
    expect(MILESTONE_NEEDS_PAGE_MESSAGE.split(". ")).toHaveLength(2);

    const slug = (await b.owner.page.publish({ businessId: b.id, content: page() })).page.slug;
    expect((await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: follower.id })).shown).toBe(true);
    // Taken down: the story and the card are gone at once, and the founder can still hide the milestone.
    await b.owner.page.unpublish({ businessId: b.id });
    const anon = hz.caller(null);
    expect(await anon.publicPage.storyBySlug({ slug })).toBeNull();
    expect(await anon.publicPage.cardById({ id: follower.id })).toBeNull();
    expect((await b.owner.journey.hideMilestone({ businessId: b.id, milestoneId: follower.id })).shown).toBe(false);
    await expect(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: follower.id })).rejects.toMatchObject({ code: "CONFLICT", message: MILESTONE_NEEDS_PAGE_MESSAGE });
  });

  it("a customer or revenue milestone cannot be shown yet (counted or estimated, not one real event); hiding one always works", async () => {
    const b = await live("Counted Not Recorded");
    const customer = await record(b.id, "customer_1", "First customer");
    const revenue = await record(b.id, "mrr_1k", "First $1K MRR");
    for (const m of [customer, revenue]) {
      await expect(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: m.id })).rejects.toMatchObject({ code: "CONFLICT", message: MILESTONE_NOT_SHOWABLE_MESSAGE });
    }
    expect((await byKey(b.id, "customer_1"))!.visibility).toBe("private");
    expect(await shownEvents(b.id)).toEqual([]);
    expect(await hz.caller(null).publicPage.storyBySlug({ slug: b.slug })).toBeNull();
    // A row the service made public before the rule can still be taken off the page.
    await repos.journeys.setMilestoneShown(hz.db, b.id, customer.id, true);
    expect((await b.owner.journey.hideMilestone({ businessId: b.id, milestoneId: customer.id })).shown).toBe(false);
  });

  it("a sample business shows nothing, and a note someone typed in is not a milestone to show", async () => {
    const sample = await project("Sample Show", { demo: true });
    const seeded = await record(sample.id, "customer_1", "First customer");
    await expect(sample.owner.journey.showMilestone({ businessId: sample.id, milestoneId: seeded.id })).rejects.toMatchObject({ code: "CONFLICT", message: MILESTONE_SAMPLE_MESSAGE });
    await expect(sample.owner.journey.hideMilestone({ businessId: sample.id, milestoneId: seeded.id })).rejects.toMatchObject({ code: "CONFLICT", message: MILESTONE_SAMPLE_MESSAGE });
    expect(await hz.caller(null).publicPage.cardById({ id: seeded.id })).toBeNull();

    const b = await live("Typed In");
    const note = await repos.journeys.createMilestone(hz.db, b.id, { kind: "launch", label: "We are huge" });
    await expect(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: note.id })).rejects.toMatchObject({ code: "NOT_FOUND", message: MILESTONE_NOT_FOUND_MESSAGE });
    const made = await repos.journeys.awardMilestone(hz.db, b.id, { kind: "trophy", label: "Made up", ref: { trophyKey: "made_up_key" } });
    await expect(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: made!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await repos.journeys.archiveMilestone(hz.db, b.id, b.pageLiveId);
    await expect(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await code(b.owner.journey.showMilestone({ businessId: b.id, milestoneId: "not-an-id" }))).toBe("BAD_REQUEST");
  });
});

describe("what the public reads", () => {
  it("a milestone about a customer is its label and date: never the customer, the amount or an internal id", async () => {
    const b = await live("Customer Story");
    const customer = await record(b.id, "customer_1", "First customer", { entityId: "0f0a0d00-0000-4000-8000-00000000c0de", customerName: "Acme Corp", amountMinor: 4900, currency: "USD", conversionId: "0f0a0d00-0000-4000-8000-00000000c0ff" });
    // A customer milestone cannot be shown by a founder yet; the public read's own rule is tested on a row the service made public.
    await repos.journeys.setMilestoneShown(hz.db, b.id, customer.id, true);
    await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId });
    const anon = hz.caller(null);
    const story = (await anon.publicPage.storyBySlug({ slug: b.slug }))!;
    // Oldest first: the page went live today, the customer row is dated Nov 19.
    expect(story.milestones.map((m) => m.label).sort()).toEqual(["First customer", "Page live"]);
    expect([...story.milestones].sort((x, y) => x.achievedAt.getTime() - y.achievedAt.getTime()).map((m) => m.id)).toEqual(story.milestones.map((m) => m.id));
    const card = (await anon.publicPage.cardById({ id: customer.id }))!;
    expect(card.milestone).toEqual({ id: customer.id, key: "customer_1", label: "First customer", achievedAt: new Date("2026-11-19T10:00:00Z"), url: `http://localhost:3000/m/${customer.id}` });
    for (const out of [JSON.stringify(story), JSON.stringify(card)]) {
      expect(out).not.toContain("Acme");
      expect(out).not.toContain("4900");
      expect(out).not.toContain("c0de");
      expect(out).not.toContain("c0ff");
      expect(out).not.toContain(b.id);
    }
    // No tally anywhere: a story is a list, and neither read carries a count.
    expect(Object.keys(story).sort()).toEqual(["brandPrimary", "brandSecondary", "logo", "mark", "milestones", "name", "pageUrl", "slug", "storyUrl"]);
    expect(Object.keys(card).sort()).toEqual(["brandPrimary", "brandSecondary", "logo", "mark", "milestone", "name", "pageUrl", "slug", "storyUrl"]);
  });

  it("an archived business and a business that became a sample lose the story and every card at once", async () => {
    const anon = hz.caller(null);
    const archived = await live("Archived");
    await archived.owner.journey.showMilestone({ businessId: archived.id, milestoneId: archived.pageLiveId });
    expect(await anon.publicPage.cardById({ id: archived.pageLiveId })).not.toBeNull();
    await hz.db.execute(sql`update businesses set archived_at = now() where id = ${archived.id}`);
    expect(await anon.publicPage.storyBySlug({ slug: archived.slug })).toBeNull();
    expect(await anon.publicPage.cardById({ id: archived.pageLiveId })).toBeNull();

    const sample = await live("Became Sample");
    await sample.owner.journey.showMilestone({ businessId: sample.id, milestoneId: sample.pageLiveId });
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${sample.id}`);
    expect(await anon.publicPage.storyBySlug({ slug: sample.slug })).toBeNull();
    expect(await anon.publicPage.cardById({ id: sample.pageLiveId })).toBeNull();
  });

  it("a malformed address or id reads as nothing and spends nothing", async () => {
    const anon = hz.caller(null);
    expect(await anon.publicPage.storyBySlug({ slug: "Not A Slug" })).toBeNull();
    expect(await anon.publicPage.cardById({ id: "not-an-id" })).toBeNull();
    expect(await anon.publicPage.cardById({ id: "" })).toBeNull();
    expect(await hits(publicStoryLimitKeys.unknown)).toBe(0);
    expect(await hits(publicCardLimitKeys.unknown)).toBe(0);
  });
});

describe("the public reads' limits", () => {
  it("lookups that find nothing do not use up what a real story or card reads from", async () => {
    const b = await live("Real Story");
    await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId });
    const quiet = await live("No Story");
    const anon = hz.caller(null);
    for (let i = 0; i < 12; i++) expect(await anon.publicPage.storyBySlug({ slug: `no-such-story-${i}` })).toBeNull();
    // A live page that shows nothing reads as unknown, and is counted the same way.
    expect(await anon.publicPage.storyBySlug({ slug: quiet.slug })).toBeNull();
    expect(await hits(publicStoryLimitKeys.all)).toBe(0);
    expect(await hits(publicStoryLimitKeys.key("no-such-story-0"))).toBe(0);
    expect(await hits(publicStoryLimitKeys.unknown)).toBe(13);
    expect((await anon.publicPage.storyBySlug({ slug: b.slug }))?.name).toBe(b.name);
    expect(await hits(publicStoryLimitKeys.all)).toBe(1);
    expect(await hits(publicStoryLimitKeys.key(b.slug))).toBe(1);

    // Cards: a hidden milestone's id and a random id both read as unknown.
    expect(await anon.publicPage.cardById({ id: quiet.pageLiveId })).toBeNull();
    expect(await anon.publicPage.cardById({ id: "00000000-0000-4000-8000-000000000000" })).toBeNull();
    expect(await hits(publicCardLimitKeys.all)).toBe(0);
    expect(await hits(publicCardLimitKeys.unknown)).toBe(2);
    expect((await anon.publicPage.cardById({ id: b.pageLiveId }))?.milestone.label).toBe("Page live");
    expect(await hits(publicCardLimitKeys.key(b.pageLiveId))).toBe(1);

    // With the unknown ceilings full, probing is refused and the real story and card still read.
    await fill(publicStoryLimitKeys.unknown, PUBLIC_STORY_LIMITS.unknown);
    await fill(publicCardLimitKeys.unknown, PUBLIC_STORY_LIMITS.unknown);
    expect(await code(anon.publicPage.storyBySlug({ slug: "no-such-story-x" }))).toBe("TOO_MANY_REQUESTS");
    expect(await code(anon.publicPage.cardById({ id: "00000000-0000-4000-8000-000000000001" }))).toBe("TOO_MANY_REQUESTS");
    expect((await anon.publicPage.storyBySlug({ slug: b.slug }))?.milestones).toHaveLength(1);
    expect((await anon.publicPage.cardById({ id: b.pageLiveId }))?.name).toBe(b.name);
  });

  it("limits each caller by the address the api sees, under a key that does not hold the address", async () => {
    const b = await live("Caller Story");
    await b.owner.journey.showMilestone({ businessId: b.id, milestoneId: b.pageLiveId });
    const refused = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code);
    await fill(publicStoryLimitKeys.caller(hz.deps.env, "203.0.113.40"), PUBLIC_STORY_LIMITS.perCaller);
    expect(await refused(publicStoryBySlug({ ...hz.deps, clientAddress: "203.0.113.40" }, b.slug))).toBe("rate_limited");
    expect(await hits(publicStoryLimitKeys.all)).toBe(0);
    expect((await publicStoryBySlug({ ...hz.deps, clientAddress: "203.0.113.41" }, b.slug))?.name).toBe(b.name);
    // The story's budget is not the card's.
    expect((await publicCardById({ ...hz.deps, clientAddress: "203.0.113.40" }, b.pageLiveId))?.name).toBe(b.name);
    await fill(publicCardLimitKeys.caller(hz.deps.env, "203.0.113.42"), PUBLIC_STORY_LIMITS.perCaller);
    expect(await refused(publicCardById({ ...hz.deps, clientAddress: "203.0.113.42" }, b.pageLiveId))).toBe("rate_limited");
    expect(publicStoryLimitKeys.caller(hz.deps.env, "203.0.113.40")).not.toContain("203.0.113.40");
    expect(publicCardLimitKeys.caller(hz.deps.env, "203.0.113.42")).not.toContain("203.0.113.42");
  });
});
