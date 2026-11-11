/**
 * publicPage.follow — following a project from its public page (docs/THESIS_REVIEW.md package 1.6; services/pages.ts
 * `followPage`, repos.followers, 0079 `contact_consents`).
 *
 * A signup on a published page whose switch is on becomes a lead in Customers (source `page`, lawful basis `consent`,
 * owned by nobody) with a consent record of the exact sentence, the page's address and the time, and `page.followed`
 * once. The answer is the same for a new address, a repeat, a suppressed address and a filled hidden field; a page that
 * is not public, a sample, or one with the switch off takes nobody; the limits hold; nothing carries the address but the
 * contact itself.
 */
import { contactConsents, repos, suppressionHash } from "@foundmill/db";
import { FOLLOW_ERRORS, followConsentText, type ProjectPageContent } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PAGE_FOLLOW_LIMITS } from "../services/pages";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "follow" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches, poured by hand.", forWhom: "", stage: "idea", showFounders: false, followForm: true, ...over });

let n = 0;
async function project(name: string, options: { demo?: boolean; publish?: Partial<ProjectPageContent> | false } = {}) {
  n += 1;
  const [ownerId, memberId] = await Promise.all(["owner", "member"].map((r) => hz.h.createUser(`follow-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: memberId!, role: "member" });
  const owner = hz.caller({ userId: ownerId! });
  let slug = "";
  if (options.publish !== false) {
    const r = await owner.page.publish({ businessId: b.id, content: page(options.publish ?? {}) });
    slug = r.page.slug;
  }
  if (options.demo) await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  return { id: b.id, name: b.name, slug, owner, member: hz.caller({ userId: memberId! }) };
}

const anon = () => hz.caller(null);
const refusal = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string; cause?: { code?: string } }) => `${err.code}:${err.cause?.code ?? ""}`);
const followEvents = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === "page.followed").map((o) => o.event);
const consents = async (businessId: string) => ({ rows: await hz.db.select().from(contactConsents).where(eq(contactConsents.businessId, businessId)) });
const leads = async (businessId: string) => (await repos.entities.listByRole(hz.db, businessId, "lead")).items;

describe("publicPage.follow", () => {
  it("a stranger's signup is a real contact with consent recorded, one event, and the count on the Public page tab", async () => {
    const b = await project("Northwood");
    expect(await anon().publicPage.follow({ slug: b.slug, email: "  Maya.Lee@Example.com ", consent: true, website: "" })).toEqual({ ok: true });

    const [lead] = await leads(b.id);
    expect(lead).toMatchObject({ kind: "person", displayName: "maya.lee@example.com", source: "page", lawfulBasis: "consent", identifiers: { email: "maya.lee@example.com" } });
    expect(lead!.role).toMatchObject({ role: "lead", stage: "new", ownerRef: null });

    const { rows } = await consents(b.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: lead!.id, purpose: "email", source: "page", sourceRef: b.slug, consentText: followConsentText(b.name), withdrawnAt: null });
    expect(rows[0]!.agreedAt).toBeInstanceOf(Date);

    const events = await followEvents(b.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ pageId: expect.any(String), entityId: lead!.id, consentId: rows[0]!.id });
    expect(events[0]!.actor).toEqual({ kind: "system", id: "public-page" });
    const audit = (await repos.audit.list(hz.db, b.id, { action: "page.followed" })).items;
    expect(audit).toHaveLength(1);
    // The address goes nowhere but the contact itself.
    expect(JSON.stringify([events, audit])).not.toMatch(/maya/i);

    // The founders see the count, the source and when they agreed.
    expect((await b.member.page.get({ businessId: b.id })).followers).toBe(1);
    const byRole = await b.member.crm.roles.byRole({ businessId: b.id, role: "lead" });
    expect(byRole.items.find((e) => e.id === lead!.id)!.emailConsentAt).toEqual(rows[0]!.agreedAt);
    expect((await b.member.crm.entity.get({ businessId: b.id, entityId: lead!.id })).emailConsentAt).toEqual(rows[0]!.agreedAt);
  });

  it("a second signup with the same address answers the same and writes nothing", async () => {
    const b = await project("Repeat");
    await anon().publicPage.follow({ slug: b.slug, email: "sam@example.com", consent: true });
    const before = await leads(b.id);
    expect(await anon().publicPage.follow({ slug: b.slug, email: "SAM@example.com ", consent: true })).toEqual({ ok: true });
    expect(await leads(b.id)).toEqual(before);
    expect((await consents(b.id)).rows).toHaveLength(1);
    expect(await followEvents(b.id)).toHaveLength(1);
    expect((await b.member.page.get({ businessId: b.id })).followers).toBe(1);
  });

  it("an existing contact who follows gets the consent record and keeps their record", async () => {
    const b = await project("Known");
    const known = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Lee Park", identifiers: { email: "lee@example.com" }, source: "manual" });
    await anon().publicPage.follow({ slug: b.slug, email: "lee@example.com", consent: true });
    const [lead] = await leads(b.id);
    expect(lead).toMatchObject({ id: known.id, displayName: "Lee Park", source: "manual", lawfulBasis: "consent" });
    expect((await consents(b.id)).rows).toHaveLength(1);
    expect((await followEvents(b.id))[0]!.payload).toMatchObject({ entityId: known.id });
  });

  it("the hidden field filled in, or a suppressed address: the same answer, nothing written", async () => {
    const b = await project("Quiet");
    expect(await anon().publicPage.follow({ slug: b.slug, email: "bot@example.com", consent: true, website: "http://spam.example" })).toEqual({ ok: true });
    await repos.channels.addSuppression(hz.db, b.id, { emailHash: suppressionHash("email", "gone@example.com"), reason: "Unsubscribed", scope: "business", source: "test" });
    expect(await anon().publicPage.follow({ slug: b.slug, email: "Gone@example.com", consent: true })).toEqual({ ok: true });
    expect(await leads(b.id)).toEqual([]);
    expect((await consents(b.id)).rows).toHaveLength(0);
    expect(await followEvents(b.id)).toEqual([]);
  });

  it("refuses an unusable address or an unticked box in plain words", async () => {
    const b = await project("Refuse");
    for (const email of ["", "maya", "maya@example", "a b@example.com"]) expect(await refusal(anon().publicPage.follow({ slug: b.slug, email, consent: true }))).toBe("BAD_REQUEST:follow_email");
    expect(await refusal(anon().publicPage.follow({ slug: b.slug, email: "maya@example.com", consent: false }))).toBe("BAD_REQUEST:follow_consent");
    const err = await anon().publicPage.follow({ slug: b.slug, email: "x", consent: true }).catch((e: Error) => e);
    expect((err as Error).message).toBe(FOLLOW_ERRORS.email);
    expect(await leads(b.id)).toEqual([]);
  });

  it("takes nobody on a page that is not public, a sample, a page with the switch off, or one published before the switch existed", async () => {
    const off = await project("Off", { publish: { followForm: false } });
    const draftOnly = await project("Draft", { publish: false });
    await draftOnly.owner.page.saveDraft({ businessId: draftOnly.id, draft: page() });
    const draftSlug = (await draftOnly.owner.page.get({ businessId: draftOnly.id })).slug;
    const sample = await project("Sample");
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${sample.id}`);
    const old = await project("Old");
    await hz.db.execute(sql`update project_pages set published = published - 'followForm' where business_id = ${old.id}`);
    const down = await project("Down");
    await down.owner.page.unpublish({ businessId: down.id });
    for (const slug of [off.slug, draftSlug, sample.slug, old.slug, down.slug, "no-such-page", "x", "../etc"]) {
      expect(await refusal(anon().publicPage.follow({ slug, email: "maya@example.com", consent: true })), slug).toBe("NOT_FOUND:follow_closed");
    }
    for (const b of [off, draftOnly, sample, old, down]) expect((await consents(b.id)).rows).toHaveLength(0);
    // The public read says the same: the old page shows no form until the founder publishes again.
    expect((await anon().publicPage.bySlug({ slug: old.slug }))!.followForm).toBe(false);
    expect((await old.owner.page.get({ businessId: old.id })).draft.followForm).toBe(true);
    await old.owner.page.publish({ businessId: old.id, content: (await old.owner.page.get({ businessId: old.id })).draft });
    expect((await anon().publicPage.bySlug({ slug: old.slug }))!.followForm).toBe(true);
  });

  it("holds the page's caps and the ceiling; beyond the per-address allowance it answers the same and writes nothing", async () => {
    const b = await project("Busy");
    const pageId = (await repos.pages.get(hz.db, b.id))!.id;
    for (let i = 0; i < PAGE_FOLLOW_LIMITS.perPageHour.limit; i++) await hz.limits.take([{ key: `page-follow:page:${pageId}:hour`, rule: PAGE_FOLLOW_LIMITS.perPageHour }]);
    expect(await refusal(anon().publicPage.follow({ slug: b.slug, email: "late@example.com", consent: true }))).toBe("TOO_MANY_REQUESTS:rate_limited");
    expect(await leads(b.id)).toEqual([]);

    hz.limits.reset();
    for (let i = 0; i < PAGE_FOLLOW_LIMITS.perAddress.limit; i++) await hz.limits.take([{ key: `page-follow:addr:${pageId}:${suppressionHash("email", "again@example.com")}`, rule: PAGE_FOLLOW_LIMITS.perAddress }]);
    expect(await anon().publicPage.follow({ slug: b.slug, email: "again@example.com", consent: true })).toEqual({ ok: true });
    expect(await leads(b.id)).toEqual([]);

    hz.limits.reset();
    for (let i = 0; i < PAGE_FOLLOW_LIMITS.all.limit; i++) await hz.limits.take([{ key: "page-follow:all", rule: PAGE_FOLLOW_LIMITS.all }]);
    expect(await refusal(anon().publicPage.follow({ slug: b.slug, email: "new@example.com", consent: true }))).toBe("TOO_MANY_REQUESTS:rate_limited");
  });

  it("a follower belongs to that project only", async () => {
    const a = await project("Alpha");
    const other = await project("Bravo");
    await anon().publicPage.follow({ slug: a.slug, email: "only-alpha@example.com", consent: true });
    expect(await leads(other.id)).toEqual([]);
    expect((await other.member.page.get({ businessId: other.id })).followers).toBe(0);
    expect(await refusal(other.member.crm.roles.byRole({ businessId: a.id, role: "lead" }))).toMatch(/^FORBIDDEN:/);
  });
});
