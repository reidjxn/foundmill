/**
 * 0078 `project_mail` (a project's Foundmill sending address).
 *
 * One row per business, so it is not in the generated cross-tenant suite; this file covers tenancy by hand and what only
 * this table has:
 *   - members read their own row; nobody reads another business's; a non-member and anon read nothing;
 *   - no app role writes at all: not the project's own owner (the cap and the pause are an operator's), not a member of
 *     another business;
 *   - the local part is chosen once and never changes, has a page-address shape and is never a role address (alone or as
 *     a part) nor the product's name;
 *   - `ensure` picks the page's address first, gives a taken one a suffix, and is stable;
 *   - a deleted project's local part is retired for good (`retired_mail_local_parts`): a new project with the same slug
 *     gets another one. That table has no business_id (the project is gone), so the generated cross-tenant suite does not
 *     apply; it is closed to every app role, which this file checks.
 */
import { APP_NAME } from "@foundmill/config";
import { MAIL_RESERVED_LOCAL_PARTS } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../../migrations";
import { mailLocalPartCandidates } from "../../repos/mail";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "mail-a");
  B = await createBusinessFixture(h, "mail-b");
  outsiderId = await h.createUser("mail-outsider@test.local");
  await h.service().run((tx) => repos.projectMail.ensure(tx, A.businessId));
  await h.service().run((tx) => repos.projectMail.ensure(tx, B.businessId));
}, 120_000);
afterAll(() => h?.close());

describe("project_mail: tenancy", () => {
  it("every member reads their own project's address and never another's", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      expect((await h.asUser(userId).run((tx) => repos.projectMail.get(tx, A.businessId)))?.localPart).toBe("mail-a");
      expect(await h.asUser(userId).run((tx) => repos.projectMail.get(tx, B.businessId))).toBeNull();
    }
  });

  it("a non-member and anon read nothing", async () => {
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.projectMail))).toHaveLength(0);
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.projectMail)));
  });

  it("no app role writes: the project's own owner cannot raise its cap, unpause it or take another's address", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectMail).set({ dailyCap: 5_000 }).where(eq(s.projectMail.businessId, A.businessId)).returning({ id: s.projectMail.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectMail).set({ status: "active" }).where(eq(s.projectMail.businessId, B.businessId)).returning({ id: s.projectMail.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.projectMail).where(eq(s.projectMail.businessId, A.businessId)).returning({ id: s.projectMail.id })));
    }
    const c = await createBusinessFixture(h, "mail-c");
    await expect(h.asUser(c.ownerId).run((tx) => tx.insert(s.projectMail).values({ businessId: c.businessId, localPart: "mail-c" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(c.ownerId).run((tx) => repos.projectMail.ensure(tx, c.businessId))).rejects.toThrow(RLS_DENIED);
    expect((await repos.projectMail.get(h.db as never, A.businessId))?.dailyCap).toBeNull();
  });

  it("an operator raises one project's cap and pauses it on the service connection", async () => {
    expect((await h.service().run((tx) => repos.projectMail.setDailyCap(tx, A.businessId, 200)))?.dailyCap).toBe(200);
    expect((await h.service().run((tx) => repos.projectMail.setStatus(tx, B.businessId, "paused")))?.status).toBe("paused");
    expect((await repos.projectMail.get(h.db as never, B.businessId))?.dailyCap).toBeNull();
    await expect(h.service().run((tx) => repos.projectMail.setDailyCap(tx, A.businessId, 0))).rejects.toThrow(/daily cap/);
    await h.service().run((tx) => repos.projectMail.setStatus(tx, B.businessId, "active"));
  });
});

describe("project_mail: the address", () => {
  it("never changes once chosen, and never moves to another business", async () => {
    await expect(h.pg.query(`update project_mail set local_part = 'renamed' where business_id = $1`, [A.businessId])).rejects.toThrow(/never changes/);
    await expect(h.pg.query(`update project_mail set business_id = $1 where business_id = $2`, [B.businessId, A.businessId])).rejects.toThrow();
    const again = await h.service().run((tx) => repos.projectMail.ensure(tx, A.businessId));
    expect(again.localPart).toBe("mail-a");
  });

  it("refuses a malformed local part and every role address", async () => {
    const d = await createBusinessFixture(h, "mail-d");
    const insert = (local: string) => h.pg.query(`insert into project_mail (business_id, local_part) values ($1, $2)`, [d.businessId, local]);
    for (const bad of ["ab", "x".repeat(41), "-abc", "abc-", "Abc", "a_b", "a.b"]) await expect(insert(bad), bad).rejects.toThrow(/project_mail_local_part_format/);
    for (const reserved of MAIL_RESERVED_LOCAL_PARTS) await expect(insert(reserved), reserved).rejects.toThrow(/project_mail_local_part_(reserved|format|brand)/);
    // As one of the hyphen-separated parts too, at either end or in the middle.
    for (const reserved of MAIL_RESERVED_LOCAL_PARTS) {
      for (const local of [`acme-${reserved}`, `${reserved}-acme`, `my-${reserved}-desk`]) await expect(insert(local), local).rejects.toThrow(/project_mail_local_part_(reserved|brand)/);
    }
    await expect(insert(`my${APP_NAME.toLowerCase()}shop`)).rejects.toThrow(/project_mail_local_part_brand/);
    // A word that merely contains a role word is fine.
    await insert("teamwork-studio");
  });

  it("the migration's reserved list is the shared one, and its brand check is APP_NAME", () => {
    const migration = readMigrations().find((m) => m.tag === "0078_project_mail")!.sql;
    const listed = (migration.match(/local_part !~ '\(\^\|-\)\(([^)]+)\)\(-\|\$\)'/)?.[1] ?? "").split("|");
    expect(listed.sort()).toEqual([...MAIL_RESERVED_LOCAL_PARTS].sort());
    expect(migration).toContain(`position('${APP_NAME.toLowerCase()}' in local_part) = 0`);
  });

  it("takes the public page's address first, then the business slug, and suffixes a taken one", async () => {
    const e = await createBusinessFixture(h, "mail-e");
    await h.service().run((tx) => tx.insert(s.projectPages).values({ businessId: e.businessId, slug: "evergreen-candles", draft: {} as never }));
    expect((await h.service().run((tx) => repos.projectMail.ensure(tx, e.businessId))).localPart).toBe("evergreen-candles");
    // The page's address changes later: the sending address stays.
    await h.pg.query(`update project_pages set slug = 'evergreen-two' where business_id = $1`, [e.businessId]);
    expect((await h.service().run((tx) => repos.projectMail.ensure(tx, e.businessId))).localPart).toBe("evergreen-candles");
    // Another project whose page address equals a taken local part gets a suffix.
    const f = await createBusinessFixture(h, "mail-f");
    await h.service().run((tx) => tx.insert(s.projectPages).values({ businessId: f.businessId, slug: "mail-a", draft: {} as never }));
    const fRow = await h.service().run((tx) => repos.projectMail.ensure(tx, f.businessId));
    expect(fRow.localPart).toBe("mail-f");
    const g = await createBusinessFixture(h, "mail-g");
    await h.pg.query(`update businesses set slug = 'mail-a-x' where id = $1`, [g.businessId]);
    await h.service().run((tx) => tx.insert(s.projectPages).values({ businessId: g.businessId, slug: "mail-a", draft: {} as never }).onConflictDoNothing());
    expect((await h.service().run((tx) => repos.projectMail.ensure(tx, g.businessId))).localPart).toBe("mail-a-x");
  });

  it("candidates skip role addresses and always end with a fallback", () => {
    const list = mailLocalPartCandidates({ pageSlug: "support", businessSlug: "admin", businessName: "Help", businessId: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" });
    expect(list).not.toContain("support");
    expect(list).not.toContain("admin");
    expect(list).toContain("project-0f1e2d3c");
    expect(list.filter((v) => MAIL_RESERVED_LOCAL_PARTS.includes(v))).toEqual([]);
  });

  it("candidates skip a role word as a part and the product's name, falling back instead of failing", () => {
    const list = mailLocalPartCandidates({ pageSlug: "paypal-security", businessSlug: `${APP_NAME.toLowerCase()}-shop`, businessName: "Acme Support Desk", businessId: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" });
    expect(list.some((v) => v.includes("security") || v.includes(APP_NAME.toLowerCase()) || v.includes("support"))).toBe(false);
    expect(list[0]).toBe("project-0f1e2d3c");
    // A taken (retired) name is skipped like a reserved one.
    const free = mailLocalPartCandidates({ pageSlug: null, businessSlug: "evergreen", businessName: "Evergreen", businessId: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" }, new Set(["evergreen"]));
    expect(free).not.toContain("evergreen");
    expect(free).toContain("evergreen-0f1e");
  });

  it("resolves a local part to its business for inbound mail, and nothing else", async () => {
    expect(await repos.projectMail.resolve.byLocalPart(h.db as never, "mail-a")).toMatchObject({ businessId: A.businessId, localPart: "mail-a" });
    expect(await repos.projectMail.resolve.byLocalPart(h.db as never, "nobody-here")).toBeNull();
    expect(await repos.projectMail.resolve.byLocalPart(h.db as never, "' or 1=1 --")).toBeNull();
    const count = await h.db.execute(sql`select count(*)::int as n from project_mail`);
    expect(((count as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0) > 0).toBe(true);
  });
});

describe("retired_mail_local_parts: a deleted project's address is never given out again", () => {
  const bareBusiness = async (slug: string) => {
    const owner = await h.createUser(`${slug}-${crypto.randomUUID().slice(0, 6)}@test.local`);
    return (await h.pg.query<{ id: string }>(`insert into businesses (name, slug, created_by) values ($1, $2, $3) returning id`, [`Retire ${slug}`, slug, owner])).rows[0]!.id;
  };

  it("delete a business, create one with the same slug: its local part differs", async () => {
    const first = await bareBusiness("old-candles");
    expect((await h.service().run((tx) => repos.projectMail.ensure(tx, first))).localPart).toBe("old-candles");
    await h.pg.query(`delete from businesses where id = $1`, [first]);
    expect((await h.pg.query(`select 1 from retired_mail_local_parts where local_part = 'old-candles'`)).rows).toHaveLength(1);
    const second = await bareBusiness("old-candles");
    const row = await h.service().run((tx) => repos.projectMail.ensure(tx, second));
    expect(row.localPart).not.toBe("old-candles");
    expect(await repos.projectMail.resolve.byLocalPart(h.db as never, "old-candles")).toBeNull();
    // Even a direct insert of the retired name is refused.
    const third = await bareBusiness("old-candles-three");
    await expect(h.pg.query(`insert into project_mail (business_id, local_part) values ($1, 'old-candles')`, [third])).rejects.toThrow(/never given out again/);
  });

  it("no app role reads or writes it", async () => {
    for (const userId of [A.ownerId, A.adminId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => tx.select().from(s.retiredMailLocalParts)));
      await expect(h.asUser(userId).run((tx) => tx.insert(s.retiredMailLocalParts).values({ localPart: "free-name" }))).rejects.toThrow(RLS_DENIED);
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.retiredMailLocalParts).returning({ localPart: s.retiredMailLocalParts.localPart })));
    }
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.retiredMailLocalParts)));
    expect((await h.pg.query(`select 1 from retired_mail_local_parts where local_part = 'old-candles'`)).rows).toHaveLength(1);
  });
});
