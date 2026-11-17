/**
 * 0130 `site_address_holds`: an address a site gives up (a rename, a deleted site) is held for
 * `fm_site_address_hold_days()` days before another project's site may take it; the project that gave it up may take
 * it back. A platform table: no app role reads or writes it.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

const rename = (businessId: string, slug: string) => h.pg.query(`update sites set slug = $2 where business_id = $1`, [businessId, slug]);
const holdOf = async (slug: string) => (await h.pg.query<{ released_by_business: string }>(`select released_by_business from site_address_holds where slug = $1`, [slug])).rows[0] ?? null;
const age = (slug: string, days: number) => h.pg.query(`update site_address_holds set released_at = now() - make_interval(days => $2) where slug = $1`, [slug, days]);

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "holds-a");
  B = await createBusinessFixture(h, "holds-b");
  for (const [f, slug] of [[A, "alpha-old"], [B, "beta-site"]] as const) await liveSite(f, slug);
});

/** A site that was published, so its address is one the public could have saved. */
async function liveSite(f: BusinessFixture, slug: string) {
  await h.service().run(async (tx) => {
    await repos.sites.ensure(tx, f.businessId, { slug });
    const r = await repos.sites.saveRelease(tx, f.businessId, { files: [{ path: "index.html", sha256: "a".repeat(64), size: 1 }], state: "preview" });
    await repos.sites.publish(tx, f.businessId, { releaseId: r.id, userId: f.ownerId });
  });
}

afterAll(async () => {
  await h?.close();
});

describe("site_address_holds", () => {
  it("the hold is 30 days", async () => {
    expect((await h.pg.query<{ d: number }>(`select fm_site_address_hold_days() as d`)).rows[0]?.d).toBe(30);
  });

  it("a renamed site's old address is held: another project cannot take it, as if it were in use", async () => {
    await rename(A.businessId, "alpha-new");
    expect(await holdOf("alpha-old")).toEqual({ released_by_business: A.businessId });
    await expect(rename(B.businessId, "alpha-old")).rejects.toThrow(/duplicate key/);
    // An owner of B pressing it through RLS gets the same answer.
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`update sites set slug = 'alpha-old' where business_id = ${B.businessId}`))).rejects.toThrow();
    expect((await h.pg.query(`select slug from sites where business_id = $1`, [B.businessId])).rows[0]).toEqual({ slug: "beta-site" });
  });

  it("the project that gave it up takes it back, and the hold is cleared", async () => {
    await rename(A.businessId, "alpha-old");
    expect(await holdOf("alpha-old")).toBeNull();
    expect(await holdOf("alpha-new")).toEqual({ released_by_business: A.businessId });
  });

  it("after the hold another project may take it", async () => {
    await age("alpha-new", 29);
    await expect(rename(B.businessId, "alpha-new")).rejects.toThrow(/duplicate key/);
    await age("alpha-new", 31);
    await rename(B.businessId, "alpha-new");
    expect((await h.pg.query(`select slug from sites where business_id = $1`, [B.businessId])).rows[0]).toEqual({ slug: "alpha-new" });
    expect(await holdOf("alpha-new")).toBeNull();
  });

  it("a deleted project's address is held too, and a new site cannot be created on it", async () => {
    const C = await createBusinessFixture(h, "holds-c");
    await liveSite(C, "gamma-site");
    await h.pg.query(`delete from businesses where id = $1`, [C.businessId]);
    expect(await holdOf("gamma-site")).toEqual({ released_by_business: C.businessId });
    const D = await createBusinessFixture(h, "holds-d");
    await expect(h.service().run((tx) => repos.sites.ensure(tx, D.businessId, { slug: "gamma-site" }))).rejects.toThrow();
  });

  it("a site that was never published holds nothing when it is renamed", async () => {
    const E = await createBusinessFixture(h, "holds-e");
    await h.service().run((tx) => repos.sites.ensure(tx, E.businessId, { slug: "draft-only" }));
    await rename(E.businessId, "draft-other");
    expect(await holdOf("draft-only")).toBeNull();
  });

  it("a business keeps at most 2 holds, its newest: renaming in a loop reserves nothing more", async () => {
    const F = await createBusinessFixture(h, "holds-f");
    await liveSite(F, "loop-0");
    for (let i = 1; i <= 5; i += 1) await rename(F.businessId, `loop-${i}`);
    const held = (await h.pg.query<{ slug: string }>(`select slug from site_address_holds where released_by_business = $1 order by slug`, [F.businessId])).rows.map((r) => r.slug);
    expect(held).toEqual(["loop-3", "loop-4"]);
  });

  it("a taken-down site's address is held for good once its project is deleted", async () => {
    const G = await createBusinessFixture(h, "holds-g");
    await liveSite(G, "phish-site");
    await h.pg.query(`update sites set status = 'taken_down', taken_down_reason = 'phishing' where business_id = $1`, [G.businessId]);
    await h.pg.query(`delete from businesses where id = $1`, [G.businessId]);
    const D = await createBusinessFixture(h, "holds-g2");
    await expect(h.service().run((tx) => repos.sites.ensure(tx, D.businessId, { slug: "phish-site" }))).rejects.toThrow();
    expect((await h.pg.query<{ inf: boolean }>(`select released_at = 'infinity' as inf from site_address_holds where slug = 'phish-site'`)).rows[0]).toEqual({ inf: true });
  });

  it("an update that keeps the slug records nothing", async () => {
    const before = (await h.pg.query(`select count(*)::int as n from site_address_holds`)).rows[0];
    await h.pg.query(`update sites set slug = slug, updated_at = now() where business_id = $1`, [A.businessId]);
    expect((await h.pg.query(`select count(*)::int as n from site_address_holds`)).rows[0]).toEqual(before);
  });

  it("no app role reads or writes it", async () => {
    for (const userId of [A.ownerId, A.adminId, B.ownerId]) {
      expect(await h.asUser(userId).run((tx) => tx.select().from(s.siteAddressHolds)).catch(() => [])).toEqual([]);
      await expect(h.asUser(userId).run((tx) => tx.insert(s.siteAddressHolds).values({ slug: "free-name", releasedByBusiness: A.businessId }))).rejects.toThrow(RLS_DENIED);
      expect(await h.asUser(userId).run((tx) => tx.delete(s.siteAddressHolds).returning({ slug: s.siteAddressHolds.slug })).catch(() => [])).toEqual([]);
    }
    expect(await h.anon().run((tx) => tx.select().from(s.siteAddressHolds)).catch(() => [])).toEqual([]);
    expect(await holdOf("gamma-site")).not.toBeNull();
  });
});
