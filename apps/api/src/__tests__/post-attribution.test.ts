/**
 * What a shared team post led to, the api's part (item 8; services/post-attribution.ts, services/pages.ts `followPage`,
 * services/post-drafts.ts `teamPostShares`, services/attribution.ts).
 *
 * - The share panel's links carry the post's own code per network (`s.<code>`), one `via` each.
 * - `publicPage.visited`: the first visit of a post's link stamps it and writes `visit.attributed` (ids only); a repeat,
 *   a member's own visit, a simulated link and anything that is not a post code do nothing; the answer is always the
 *   same; it is limited like the public story reads.
 * - `publicPage.follow` keeps the visitor's last post link only when it is the project's own, not simulated and
 *   visited: a code from another business, a simulated link and an unvisited one are dropped. An unconfirmed follow
 *   credits nothing.
 * - The Creative tab's `postOutcomes`: follows and replies behind the CRM, payments behind Finance; null for a quiet post.
 * - A first touch through `s.<code>` is recorded in `attributions` as the project's page (`p.<slug>`), and no account
 *   event carries a post code.
 */
import { assets, contactConsents, postAttributions, postLinks, repos } from "@foundmill/db";
import type { ProjectPageContent } from "@foundmill/shared";
import { VIA_PARAM } from "@foundmill/shared/via";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordSignupAttribution } from "../services/attribution";
import { POST_VISIT_LIMITS, postVisitLimitKeys, recordPostVisit } from "../services/post-attribution";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "postattr" });
  hz.deps.gateway.confirmFollow = async () => ({ sent: true, simulated: true });
  // The page's bot check (#119) passes the widget's token, as in page-follow.test.ts.
  hz.deps.gateway.verifyTurnstile = async (input) => (input.token === TURNSTILE_TOKEN ? { ok: true, reason: "ok", simulated: false } : { ok: false, reason: "invalid", simulated: false });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const content = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Bike repairs at your door", about: "A van full of parts comes to the bike.", forWhom: "", stage: "building", showFounders: false, followForm: true, ...over });
const silent = { debug() {}, info() {}, warn() {}, error() {} } as never;

let n = 0;
async function project(name: string) {
  n += 1;
  const [ownerId, memberId] = await Promise.all(["owner", "member"].map((r) => hz.h.createUser(`postattr-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: memberId!, role: "member" });
  const owner = hz.caller({ userId: ownerId! });
  const published = await owner.page.publish({ businessId: b.id, content: content() });
  const page = { id: (await repos.pages.get(hz.db, b.id))!.id, slug: published.page.slug };
  // A post the team drafted (as `repos.teamPosts.write` stores it) with its codes.
  const out = await repos.teamPosts.write(hz.db, b.id, { ref: { trigger: "page_published", subject: "page_live", refId: page.id }, text: `${name} has a page now. Bike repairs at your door.`, authoredByAgentId: null });
  const links = await hz.db.select().from(postLinks).where(eq(postLinks.assetId, out.asset!.id));
  return { id: b.id, slug: page.slug, ownerId: ownerId!, memberId: memberId!, owner, member: hz.caller({ userId: memberId! }), assetId: out.asset!.id, links, code: (network: string | null) => links.find((l) => (l.network ?? null) === network)!.code };
}

const anon = () => hz.caller(null);
const linkRow = async (code: string) => (await hz.db.select().from(postLinks).where(eq(postLinks.code, code)))[0]!;
const visitEvents = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === "visit.attributed").map((o) => o.event);
const consentOf = async (businessId: string) => (await hz.db.select().from(contactConsents).where(eq(contactConsents.businessId, businessId)))[0]!;
const TURNSTILE_TOKEN = "a-token-from-the-widget";
const follow = (slug: string, email: string, post: string | null) => anon().publicPage.follow({ slug, email, consent: true, website: "", turnstile: TURNSTILE_TOKEN, post });

describe("the share panel's links", () => {
  it("carry the post's own code for each network, one via each, and the general code for a copied link", async () => {
    const b = await project("Doorstep");
    const rows = await b.owner.distribution.assets.list({ businessId: b.id });
    const post = rows.find((r) => r.id === b.assetId)!;
    expect(new URL(post.sharePost!.link!).searchParams.getAll(VIA_PARAM)).toEqual([`s.${b.code(null)}`]);
    expect(new URL(post.sharePost!.variants.x!.link!).searchParams.getAll(VIA_PARAM)).toEqual([`s.${b.code("x")}`]);
    expect(post.postOutcomes).toBeNull();
  });
});

describe("publicPage.visited", () => {
  it("stamps a post link's first visit and writes visit.attributed once, ids only", async () => {
    const b = await project("Visit");
    const code = b.code("x");
    expect(await anon().publicPage.visited({ via: `s.${code}` })).toEqual({ ok: true });
    expect((await linkRow(code)).firstVisitedAt).toBeInstanceOf(Date);
    expect(await anon().publicPage.visited({ via: `s.${code}` })).toEqual({ ok: true });
    const events = await visitEvents(b.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ linkId: (await linkRow(code)).id, assetId: b.assetId, network: "x" });
    expect(JSON.stringify(events[0]!.payload)).not.toContain(code);
  });

  it("leaves a member's own visit, a simulated link and anything that is not a post code alone, with the same answer", async () => {
    const b = await project("Member");
    expect(await b.owner.publicPage.visited({ via: `s.${b.code("threads")}` })).toEqual({ ok: true });
    expect(await b.member.publicPage.visited({ via: `s.${b.code("threads")}` })).toEqual({ ok: true });
    expect((await linkRow(b.code("threads"))).firstVisitedAt).toBeNull();
    await hz.db.update(postLinks).set({ simulated: true }).where(eq(postLinks.code, b.code("bluesky")));
    expect(await anon().publicPage.visited({ via: `s.${b.code("bluesky")}` })).toEqual({ ok: true });
    expect((await linkRow(b.code("bluesky"))).firstVisitedAt).toBeNull();
    for (const via of [`p.${b.slug}`, "s.NOTACODE00", "s.abcdefgh22", "", "u.someone"]) expect(await anon().publicPage.visited({ via }), via).toEqual({ ok: true });
    expect(await visitEvents(b.id)).toEqual([]);
    // Someone else's member is a visitor here.
    const other = await project("Other");
    expect(await other.owner.publicPage.visited({ via: `s.${b.code("threads")}` })).toEqual({ ok: true });
    expect((await linkRow(b.code("threads"))).firstVisitedAt).toBeInstanceOf(Date);
  });

  it("holds a caller to 30 a minute, and made-up codes never use up the shared ceiling, with the same answer either way (security review, Nov 14)", async () => {
    expect(POST_VISIT_LIMITS.perCaller).toEqual({ limit: 30, windowMs: 60_000 });
    const b = await project("Ceiling");
    const ctx = (address: string) => ({ db: hz.db, env: hz.deps.env, limits: hz.limits, log: silent, clientAddress: address, userId: null });
    // Made-up codes from many addresses: every answer is the plain one, and none of them stays on the shared total.
    const fake = (i: number) => `s.${"abcdefgh".slice(0, 8)}${"234567"[i % 6]}${"234567"[Math.floor(i / 6) % 6]}`;
    for (let i = 0; i < 36; i++) expect(await recordPostVisit(ctx(`198.51.100.${i % 20}`), { via: fake(i) })).toEqual({ ok: true });
    // The shared total has room for exactly as many real first visits as before: fill it to one short and a real code still records.
    for (let i = 0; i < POST_VISIT_LIMITS.all.limit - 1; i++) await hz.limits.take([{ key: postVisitLimitKeys.all, rule: POST_VISIT_LIMITS.all }]);
    expect(await recordPostVisit(ctx("203.0.113.7"), { via: `s.${b.code("x")}` })).toEqual({ ok: true });
    expect((await linkRow(b.code("x"))).firstVisitedAt).toBeInstanceOf(Date);
    // A made-up code with the shared total full answers exactly like a real one would.
    hz.limits.reset();
    for (let i = 0; i < POST_VISIT_LIMITS.unknown.limit; i++) await hz.limits.take([{ key: postVisitLimitKeys.unknown, rule: POST_VISIT_LIMITS.unknown }]);
    expect(await recordPostVisit(ctx("203.0.113.8"), { via: "s.zzzzzzzz22" })).toEqual({ ok: true });
    expect(await recordPostVisit(ctx("203.0.113.8"), { via: `s.${b.code("threads")}` })).toEqual({ ok: true });
    // The 31st beacon in a minute from one address is refused, real code or not.
    hz.limits.reset();
    for (let i = 0; i < 30; i++) await recordPostVisit(ctx("203.0.113.9"), { via: i % 2 ? "s.zzzzzzzz33" : `s.${b.code("reddit")}` });
    await expect(recordPostVisit(ctx("203.0.113.9"), { via: "s.zzzzzzzz44" })).rejects.toMatchObject({ name: expect.stringMatching(/RateLimited|AppError/) });
    await expect(recordPostVisit(ctx("203.0.113.9"), { via: `s.${b.code("linkedin")}` })).rejects.toMatchObject({ name: expect.stringMatching(/RateLimited|AppError/) });
  });

  it("is limited per code like the public story reads", async () => {
    const b = await project("Limited");
    const code = b.code("reddit");
    for (let i = 0; i < POST_VISIT_LIMITS.perKey.limit; i++) await hz.limits.take([{ key: postVisitLimitKeys.code(code), rule: POST_VISIT_LIMITS.perKey }]);
    await expect(anon().publicPage.visited({ via: `s.${code}` })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect((await linkRow(code)).firstVisitedAt).toBeNull();
  });
});

describe("publicPage.follow keeps the post link only when it may", () => {
  it("keeps the project's own visited link; credits nothing until the person confirms", async () => {
    const b = await project("Keep");
    await anon().publicPage.visited({ via: `s.${b.code("x")}` });
    expect(await follow(b.slug, "keep@example.com", b.code("x"))).toEqual({ ok: true });
    expect((await consentOf(b.id)).postLinkId).toBe((await linkRow(b.code("x"))).id);
    expect(await hz.db.select().from(postAttributions).where(eq(postAttributions.businessId, b.id))).toEqual([]);
  });

  it("drops a code from another business, a simulated link, an unvisited link and a value that is not a code", async () => {
    const other = await project("Elsewhere");
    await anon().publicPage.visited({ via: `s.${other.code("x")}` });
    for (const [i, make] of [
      async () => other.code("x"),
      async (b: Awaited<ReturnType<typeof project>>) => {
        await anon().publicPage.visited({ via: `s.${b.code("x")}` });
        await hz.db.update(postLinks).set({ simulated: true }).where(eq(postLinks.code, b.code("x")));
        return b.code("x");
      },
      async (b: Awaited<ReturnType<typeof project>>) => b.code("linkedin"),
      async () => "not a code",
    ].entries()) {
      const b = await project(`Drop${i}`);
      const post = await make(b);
      expect(await follow(b.slug, `drop${i}@example.com`, post)).toEqual({ ok: true });
      expect((await consentOf(b.id)).postLinkId, String(i)).toBeNull();
    }
  });
});

describe("the Creative tab's line", () => {
  it("counts follows and replies for a CRM reader and payments for a Finance reader; nothing for a walled one", async () => {
    const b = await project("Walls");
    const x = await linkRow(b.code("x"));
    for (const kind of ["follow", "follow", "reply", "payment"] as const)
      await hz.db.insert(postAttributions).values({ businessId: b.id, linkId: x.id, assetId: b.assetId, network: "x", outcomeKind: kind, outcomeEventId: crypto.randomUUID(), originId: crypto.randomUUID(), outcomeAt: new Date() });
    const outcomes = async (caller: typeof b.owner) => (await caller.distribution.assets.list({ businessId: b.id })).find((r) => r.id === b.assetId)!.postOutcomes;
    expect(await outcomes(b.owner)).toEqual({ follow: 2, reply: 1, payment: 1 });
    await repos.memberships.setSectionPermissions(hz.db, b.id, b.memberId, { finance: "none" });
    expect(await outcomes(b.member)).toEqual({ follow: 2, reply: 1, payment: 0 });
    await repos.memberships.setSectionPermissions(hz.db, b.id, b.memberId, { finance: "read", crm: "none" });
    expect(await outcomes(b.member)).toEqual({ follow: 0, reply: 0, payment: 1 });
    await repos.memberships.setSectionPermissions(hz.db, b.id, b.memberId, { finance: "none", crm: "none" });
    expect(await outcomes(b.member)).toBeNull();
    // #120's roles: a cofounder has an owner's standing and sees everything; a collaborator reads the CRM and no Money,
    // so follows and replies but never a payment, whatever their own permissions say.
    const [cofounderId, collaboratorId] = await Promise.all(["cofounder", "collaborator"].map((r) => hz.h.createUser(`postattr-walls-${r}@test.local`)));
    await repos.memberships.add(hz.db, b.id, { userId: cofounderId!, role: "cofounder" });
    await repos.memberships.add(hz.db, b.id, { userId: collaboratorId!, role: "collaborator", sectionPermissions: { finance: "write" } });
    expect(await outcomes(hz.caller({ userId: cofounderId! }))).toEqual({ follow: 2, reply: 1, payment: 1 });
    expect(await outcomes(hz.caller({ userId: collaboratorId! }))).toEqual({ follow: 2, reply: 1, payment: 0 });
    // Another business's rows never reach this one's list.
    const other = await project("WallsOther");
    expect((await other.owner.distribution.assets.list({ businessId: other.id })).every((r) => r.postOutcomes === null)).toBe(true);
    // The asset is still the team post the tab lists.
    expect((await hz.db.select().from(assets).where(eq(assets.id, b.assetId)))[0]!.contentRef).toMatch(/^post-draft:/);
  });
});

describe("a first touch through a post's code", () => {
  it("is recorded as the project's page in attributions, and no account event carries the code", async () => {
    const b = await project("Signup");
    const newcomer = await hz.h.createUser("postattr-newcomer@test.local");
    await recordSignupAttribution({ db: hz.db, log: silent }, newcomer, `s.${b.code("x")}`);
    expect(await repos.attributions.forUser(hz.db, newcomer)).toMatchObject({ sourceKind: "project_page", sourceRef: b.slug, sourceBusinessId: b.id });
    const rows = (await hz.db.execute(sql`select payload::text as p from account_events where user_id = ${newcomer}::uuid`)) as unknown as { rows: { p: string }[] };
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) {
      expect(r.p).not.toContain(b.code("x"));
      expect(r.p).toContain(b.slug);
    }
    // A simulated link records nothing.
    const later = await hz.h.createUser("postattr-later@test.local");
    await hz.db.update(postLinks).set({ simulated: true }).where(eq(postLinks.code, b.code("threads")));
    await recordSignupAttribution({ db: hz.db, log: silent }, later, `s.${b.code("threads")}`);
    expect(await repos.attributions.forUser(hz.db, later)).toBeNull();
  });
});
