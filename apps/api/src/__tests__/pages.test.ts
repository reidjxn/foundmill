/**
 * page.* and publicPage.bySlug — a project's public page (docs/THESIS_REVIEW.md package 1.1; services/pages.ts).
 *
 * The starter draft is built from what the project has and writes nothing; members save the draft; only an owner or an
 * admin publishes and takes it down (events through the outbox, audited); the deterministic screen holds a page with
 * an email address, a phone number or markup; a sample business never publishes; the signed-out read gives the view's
 * columns only, and null for anything not public; Today's quiet line follows the page.
 */
import { repos } from "@foundmill/db";
import { PAGE_HOLD_MESSAGES, PAGE_SLUG_TAKEN, type ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PAGE_PUBLISH_ROLE_MESSAGE, PAGE_SAMPLE_MESSAGE, pageHoldReason } from "../services/pages";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "pages" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand in Leeds.", forWhom: "People in small city apartments", stage: "building", showFounders: false, ...over });

let n = 0;
async function project(name: string, options: { demo?: boolean } = {}) {
  n += 1;
  const [ownerId, adminId, memberId, viewerId] = await Promise.all(["owner", "admin", "member", "viewer"].map((r) => hz.h.createUser(`pages-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  if (options.demo) await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  for (const [userId, role] of [[ownerId, "owner"], [adminId, "admin"], [memberId, "member"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  return { id: b.id, slug: b.slug, name: b.name, ownerId: ownerId!, owner: hz.caller({ userId: ownerId! }), admin: hz.caller({ userId: adminId! }), member: hz.caller({ userId: memberId! }), viewer: hz.caller({ userId: viewerId! }) };
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");
const pageEvents = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type.startsWith("page.")).map((o) => ({ type: o.event.type, payload: o.event.payload }));

describe("page.get", () => {
  it("answers a starter draft from the business's own rows and writes nothing", async () => {
    const b = await project("Northwood Candles");
    await hz.db.execute(sql`insert into business_foundations (business_id, door, status, vision) values (${b.id}, 'ideation', 'ready', ${JSON.stringify({ statement: "Bring the outdoors inside.", forWhom: "People in small city apartments" })}::jsonb)`);
    const view = await b.member.page.get({ businessId: b.id });
    expect(view).toMatchObject({ saved: false, live: false, published: null, changed: false, canEdit: true, canPublish: false, isSample: false });
    // No founder's words on this business: the pitch is the project's name.
    expect(view.draft).toEqual({ pitch: b.name, about: "Bring the outdoors inside.", forWhom: "People in small city apartments", stage: "idea", showFounders: false });
    expect(view.slug).toMatch(/^northwood-candles/);
    expect(view.url).toBe(`http://localhost:3000/p/${view.slug}`);
    expect(await repos.pages.get(hz.db, b.id)).toBeNull();
    expect((await b.owner.page.get({ businessId: b.id })).canPublish).toBe(true);
    expect((await b.viewer.page.get({ businessId: b.id })).canEdit).toBe(false);
  });

  it("a member of another business reads nothing", async () => {
    const a = await project("Alpha");
    const other = await project("Bravo");
    expect(await code(other.owner.page.get({ businessId: a.id }))).toBe("FORBIDDEN");
    expect(await code(other.owner.page.publish({ businessId: a.id, content: page() }))).toBe("FORBIDDEN");
  });
});

describe("writing and publishing", () => {
  it("a member saves the draft; a viewer cannot; only an owner or an admin publishes", async () => {
    const b = await project("Draft Rights");
    const saved = await b.member.page.saveDraft({ businessId: b.id, draft: page({ pitch: "  Candles\n that last " }) });
    expect(saved).toMatchObject({ saved: true, live: false, draft: { pitch: "Candles that last" } });
    expect(await code(b.viewer.page.saveDraft({ businessId: b.id, draft: page() }))).toBe("FORBIDDEN");
    expect(await code(b.member.page.publish({ businessId: b.id, content: page() }))).toBe("FORBIDDEN");
    expect(await code(b.member.page.unpublish({ businessId: b.id }))).toBe("FORBIDDEN");
    expect((await repos.audit.list(hz.db, b.id, { action: "page.draft_saved" })).items).toHaveLength(1);
    expect(await pageEvents(b.id)).toEqual([]);
    expect(PAGE_PUBLISH_ROLE_MESSAGE).toMatch(/owner or an admin/);
  });

  it("publish → live for anyone signed out; changes publish without moving the date; take it down", async () => {
    const b = await project("Live Page");
    const first = await b.admin.page.publish({ businessId: b.id, content: page() });
    expect(first.outcome).toBe("published");
    const live = first.page;
    expect(live).toMatchObject({ live: true, changed: false, published: page() });
    expect(live.publishedAt).toBeInstanceOf(Date);
    const url = `http://localhost:3000/p/${live.slug}`;
    expect(await pageEvents(b.id)).toEqual([{ type: "page.published", payload: expect.objectContaining({ slug: live.slug, url }) }]);
    expect((await repos.audit.list(hz.db, b.id, { action: "page.published" })).items).toHaveLength(1);

    // Signed out: exactly what the page shows.
    const anon = hz.caller(null);
    const pub = await anon.publicPage.bySlug({ slug: live.slug });
    expect(pub).toEqual({ slug: live.slug, url, name: b.name, pitch: page().pitch, about: page().about, forWhom: page().forWhom, stage: "building", publishedAt: live.publishedAt, brandPrimary: expect.any(String), brandSecondary: expect.any(String), logo: null, founderNames: [] });

    // A draft edit shows "changes not yet published" and does not reach the public page.
    const edited = await b.member.page.saveDraft({ businessId: b.id, draft: page({ stage: "live" }) });
    expect(edited.changed).toBe(true);
    expect((await anon.publicPage.bySlug({ slug: live.slug }))!.stage).toBe("building");
    const again = await b.owner.page.publish({ businessId: b.id, content: edited.draft });
    expect(again.outcome === "published" && again.page.publishedAt).toEqual(live.publishedAt);
    expect((await anon.publicPage.bySlug({ slug: live.slug }))!.stage).toBe("live");

    const down = await b.owner.page.unpublish({ businessId: b.id });
    expect(down).toMatchObject({ live: false, published: null, draft: { stage: "live" } });
    expect(down.unpublishedAt).toBeInstanceOf(Date);
    expect(await anon.publicPage.bySlug({ slug: live.slug })).toBeNull();
    expect((await pageEvents(b.id)).map((e) => e.type)).toEqual(["page.published", "page.published", "page.unpublished"]);
    // A second take-down changes nothing and writes nothing.
    await b.owner.page.unpublish({ businessId: b.id });
    expect((await pageEvents(b.id)).map((e) => e.type)).toEqual(["page.published", "page.published", "page.unpublished"]);
  });

  it("names the owners only when the page says so", async () => {
    const b = await project("Named");
    await hz.db.execute(sql`insert into founder_profiles (user_id, display_name) values (${b.ownerId}, 'Maya') on conflict (user_id) do update set display_name = 'Maya'`);
    const { page: view } = await b.owner.page.publish({ businessId: b.id, content: page({ showFounders: true }) });
    expect(view.preview.founderNames).toEqual(["Maya"]);
    expect((await hz.caller(null).publicPage.bySlug({ slug: view.slug }))!.founderNames).toEqual(["Maya"]);
    const { page: hidden } = await b.owner.page.publish({ businessId: b.id, content: page({ showFounders: false }) });
    expect((await hz.caller(null).publicPage.bySlug({ slug: hidden.slug }))!.founderNames).toEqual([]);
  });

  it("refuses an incomplete page with the field and a sentence", async () => {
    const b = await project("Incomplete");
    await expect(b.owner.page.publish({ businessId: b.id, content: page({ about: "  " }) })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Say a little about the project." });
    expect(await repos.pages.get(hz.db, b.id)).toBeNull();
  });

  it("holds a page with an email address, a phone number or markup, keeps the words and stays unpublished", async () => {
    const b = await project("Held");
    for (const [over, reason] of [
      [{ about: "Write to maya@example.com for a sample." }, "personal_data"],
      [{ forWhom: "Call (415) 555-0134 any time" }, "personal_data"],
      [{ pitch: "Candles <script>alert(1)</script>" }, "markup"],
      [{ about: "Click javascript:alert(1)" }, "markup"],
    ] as const) {
      const result = await b.owner.page.publish({ businessId: b.id, content: page(over) });
      expect(result).toMatchObject({ outcome: "held", reason, message: PAGE_HOLD_MESSAGES[reason] });
      expect(result.page).toMatchObject({ live: false, published: null, saved: true });
    }
    expect(await pageEvents(b.id)).toEqual([]);
    expect((await repos.audit.list(hz.db, b.id, { action: "page.publish_held" })).items).toHaveLength(4);
    expect(pageHoldReason(page())).toBeNull();
  });

  it("refuses a sample business, whoever asks", async () => {
    const b = await project("Sample", { demo: true });
    expect((await b.owner.page.get({ businessId: b.id })).isSample).toBe(true);
    await expect(b.owner.page.publish({ businessId: b.id, content: page() })).rejects.toMatchObject({ code: "CONFLICT", message: PAGE_SAMPLE_MESSAGE });
  });
});

describe("the address", () => {
  it("checks the rule, the reserved words and other projects' addresses, in the founder's words", async () => {
    const a = await project("Address A");
    const b = await project("Address B");
    const { page: aLive } = await a.owner.page.publish({ businessId: a.id, content: page() });
    await expect(b.member.page.setSlug({ businessId: b.id, slug: aLive.slug })).rejects.toMatchObject({ code: "CONFLICT", message: PAGE_SLUG_TAKEN });
    await expect(b.member.page.setSlug({ businessId: b.id, slug: "login" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "That address is kept for the product itself. Try another one." });
    await expect(b.member.page.setSlug({ businessId: b.id, slug: "-no" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // While the page is not live a member chooses it; the first change writes the row with the starter draft.
    const moved = await b.member.page.setSlug({ businessId: b.id, slug: "Bravo-Candles" });
    expect(moved).toMatchObject({ slug: "bravo-candles", saved: true, live: false, url: "http://localhost:3000/p/bravo-candles" });
    expect(moved.draft.pitch).toBe(b.name);
    // A live page's address is an owner's or an admin's.
    await expect(a.member.page.setSlug({ businessId: a.id, slug: "alpha-elsewhere" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const aMoved = await a.admin.page.setSlug({ businessId: a.id, slug: "alpha-elsewhere" });
    expect(aMoved.live).toBe(true);
    expect(await hz.caller(null).publicPage.bySlug({ slug: aLive.slug })).toBeNull();
    expect(await hz.caller(null).publicPage.bySlug({ slug: "alpha-elsewhere" })).toMatchObject({ name: a.name });
    expect((await pageEvents(a.id)).map((e) => `${e.type}:${(e.payload as { slug: string }).slug}`)).toEqual([`page.published:${aLive.slug}`, `page.unpublished:${aLive.slug}`, "page.published:alpha-elsewhere"]);
  });

  it("the signed-out read answers null for an unknown, malformed or reserved address", async () => {
    const anon = hz.caller(null);
    for (const slug of ["no-such-page", "x", "Login", "a b", "../etc"]) expect(await anon.publicPage.bySlug({ slug })).toBeNull();
  });
});

describe("today.get › pageReady", () => {
  it("is true until the page is live, false again after it is taken down; never for a sample business", async () => {
    const b = await project("Today Page");
    expect((await b.member.today.get({ businessId: b.id })).pageReady).toBe(true);
    await b.owner.page.publish({ businessId: b.id, content: page() });
    expect((await b.member.today.get({ businessId: b.id })).pageReady).toBe(false);
    await b.owner.page.unpublish({ businessId: b.id });
    expect((await b.member.today.get({ businessId: b.id })).pageReady).toBe(true);
    const sample = await project("Today Sample", { demo: true });
    expect((await sample.owner.today.get({ businessId: sample.id })).pageReady).toBe(false);
  });
});
