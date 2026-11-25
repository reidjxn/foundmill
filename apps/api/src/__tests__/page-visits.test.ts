/**
 * Visits to a project's public page, counted by Foundmill (founder, Nov 25, 2026; services/page-visits.ts, 0175).
 *
 * - `publicPage.visited` with a `slug` counts one visit for today and its source; without one it counts nothing.
 * - Left out: a member of the project, an address that is not a published page, a caller over its limit.
 * - Nothing about the visitor is stored: the row holds the business, the day, the source bucket and a count.
 * - `page.get` gives the members the last 28 days; another business's members see none of it (RLS).
 * - The source: a post's code, a Foundmill link, UTM tags and the referrer.
 */
import { pageVisitDays, repos } from "@foundmill/db";
import type { ProjectPageContent } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PAGE_VISIT_LIMIT, pageVisitSource, recordPageVisit } from "../services/page-visits";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "pagevisits" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const content: ProjectPageContent = { pitch: "Bike repairs at your door", about: "A van full of parts comes to the bike.", forWhom: "", stage: "building", showFounders: false, followForm: true };
const silent = { debug() {}, info() {}, warn() {}, error() {} } as never;
const APP = "https://app.example.com";

let n = 0;
async function project(name: string, publish = true) {
  n += 1;
  const ownerId = (await hz.h.createUser(`pagevisits-${n}@test.local`))!;
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId, role: "owner" });
  const owner = hz.caller({ userId: ownerId });
  const view = publish ? (await owner.page.publish({ businessId: b.id, content })).page : await owner.page.saveDraft({ businessId: b.id, draft: content });
  return { id: b.id, slug: view.slug, ownerId, owner };
}
const rows = (businessId: string) => hz.db.select().from(pageVisitDays).where(eq(pageVisitDays.businessId, businessId));

describe("pageVisitSource", () => {
  it.each([
    [{ via: "s.k3m7qa2xpw" }, "post"],
    [{ via: "p.maple-bakes" }, "foundmill"],
    [{ referrer: `${APP}/home` }, "foundmill"],
    [{ referrer: "https://www.google.com/" }, "search"],
    [{ referrer: "https://chatgpt.com/" }, "ai"],
    [{ referrer: "https://www.instagram.com/" }, "social"],
    [{ search: "?utm_source=newsletter&utm_medium=email" }, "email"],
    [{ search: "?utm_medium=cpc" }, "paid"],
    [{ referrer: "https://someblog.example/" }, "referral"],
    [{}, "direct"],
    [{ referrer: "not a url" }, "direct"],
  ])("%j is %s", (input, source) => {
    expect(pageVisitSource(input, APP)).toBe(source);
  });
});

describe("publicPage.visited counts visits", () => {
  it("adds one per visit for today and its source, and stores nothing about the visitor", async () => {
    const b = await project("Counted");
    const anon = hz.caller(null);
    expect(await anon.publicPage.visited({ slug: b.slug, referrer: "https://www.google.com/" })).toEqual({ ok: true });
    await anon.publicPage.visited({ slug: b.slug, referrer: "https://www.google.com/search?q=bikes" });
    await anon.publicPage.visited({ slug: b.slug, via: "s.k3m7qa2xpw" });
    // No slug (a bot-looking browser sends none): nothing is counted.
    await anon.publicPage.visited({ via: "" });
    const got = (await rows(b.id)).map((r) => ({ source: r.source, visits: r.visits })).sort((x, y) => x.source.localeCompare(y.source));
    expect(got).toEqual([
      { source: "post", visits: 1 },
      { source: "search", visits: 2 },
    ]);
    expect(Object.keys((await rows(b.id))[0]!).sort()).toEqual(["businessId", "createdAt", "day", "id", "source", "updatedAt", "visits"]);
  });

  it("leaves out a member of the project, a page that is not published and an unknown address", async () => {
    const b = await project("Own");
    await b.owner.publicPage.visited({ slug: b.slug });
    const draft = await project("Draft", false);
    await hz.caller(null).publicPage.visited({ slug: draft.slug });
    await hz.caller(null).publicPage.visited({ slug: "no-such-page-here" });
    expect(await rows(b.id)).toEqual([]);
    expect(await rows(draft.id)).toEqual([]);
  });

  it("stops counting one address over its limit, without an error", async () => {
    const b = await project("Limited");
    const ctx = { db: hz.db, env: hz.deps.env, limits: hz.limits, log: silent, clientAddress: "203.0.113.9" } as never;
    for (let i = 0; i < PAGE_VISIT_LIMIT.limit + 5; i++) await recordPageVisit(ctx, { slug: b.slug });
    expect((await rows(b.id))[0]!.visits).toBe(PAGE_VISIT_LIMIT.limit);
  });
});

describe("page.get shows the count to members only", () => {
  it("sums the last 28 days for the project, and another project's member sees none of it", async () => {
    const a = await project("Shown");
    const other = await project("Other");
    const today = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    await repos.pageVisits.count(hz.db, a.id, today, "social");
    await repos.pageVisits.count(hz.db, a.id, today, "social");
    await repos.pageVisits.count(hz.db, a.id, old, "direct");
    const view = await a.owner.page.get({ businessId: a.id });
    expect(view.visits).toMatchObject({ estimate: true, windowDays: 28, last7: 2, total: 2, bySource: [{ source: "social", visits: 2 }] });
    expect(view.visits!.daily).toHaveLength(28);
    expect((await other.owner.page.get({ businessId: other.id })).visits!.total).toBe(0);
    await expect(other.owner.page.get({ businessId: a.id })).rejects.toThrow();
  });
});
