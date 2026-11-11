/**
 * 0078 `project_mail` (a project's Foundmill sending address).
 *
 * One row per business, so it is not in the generated cross-tenant suite; this file covers tenancy by hand and what only
 * this table has:
 *   - members read their own row; nobody reads another business's; a non-member and anon read nothing;
 *   - no app role writes at all: not the project's own owner (the cap and the pause are an operator's), not a member of
 *     another business;
 *   - the local part is chosen once and never changes, has a page-address shape and is never a role address;
 *   - `ensure` picks the page's address first, gives a taken one a suffix, and is stable.
 */
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
    for (const reserved of MAIL_RESERVED_LOCAL_PARTS) await expect(insert(reserved), reserved).rejects.toThrow(/project_mail_local_part_(reserved|format)/);
  });

  it("the migration's reserved list is the shared one", () => {
    const migration = readMigrations().find((m) => m.tag === "0078_project_mail")!.sql;
    const listed = [...(migration.match(/local_part not in \(([^)]+)\)/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...MAIL_RESERVED_LOCAL_PARTS].sort());
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

  it("resolves a local part to its business for inbound mail, and nothing else", async () => {
    expect(await repos.projectMail.resolve.byLocalPart(h.db as never, "mail-a")).toMatchObject({ businessId: A.businessId, localPart: "mail-a" });
    expect(await repos.projectMail.resolve.byLocalPart(h.db as never, "nobody-here")).toBeNull();
    expect(await repos.projectMail.resolve.byLocalPart(h.db as never, "' or 1=1 --")).toBeNull();
    const count = await h.db.execute(sql`select count(*)::int as n from project_mail`);
    expect(((count as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0) > 0).toBe(true);
  });
});
