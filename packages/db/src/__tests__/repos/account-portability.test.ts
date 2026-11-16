/**
 * Account export and closing by request (WP-11 T16). Runs on PGlite and, with RLS_TEST_DATABASE_URL, on a real Postgres.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_COLUMNS } from "../../repos/account-portability";
import { repos } from "../../repos";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "../rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "acct-a");
  B = await createBusinessFixture(h, "acct-b");
}, 120_000);
afterAll(() => h?.close());

describe("account portability", () => {
  it("classifies every foreign key to auth.users exactly once", async () => {
    const keys = await rows<{ k: string }>(sql`
      select cl.relname || '.' || a.attname as k
        from pg_constraint ct join pg_class cl on cl.oid = ct.conrelid join pg_namespace n on n.oid = cl.relnamespace
        join pg_attribute a on a.attrelid = ct.conrelid and a.attnum = any(ct.conkey)
       where ct.contype = 'f' and n.nspname = 'public' and ct.confrelid = 'auth.users'::regclass
       order by 1`);
    const keyed = Object.entries(ACCOUNT_COLUMNS).filter(([, c]) => c.onDelete !== "none").map(([k]) => k).sort();
    expect(keyed).toEqual(keys.map((r) => r.k));
  });

  it("an export holds one account only", async () => {
    const out = await repos.accountPortability.export(h.db as never, A.ownerId);
    expect(out.format).toBe("foundmill-account-export/1");
    expect(out.tables["memberships.user_id"]?.length).toBeGreaterThan(0);
    const text = JSON.stringify(out);
    for (const id of [B.ownerId, B.adminId, B.memberId, B.businessId]) expect(text).not.toContain(id);
    await expect(repos.accountPortability.export(h.db as never, "nope")).rejects.toThrow(/UUID/);
  });

  it("closing: a sole owner's project is named first; after the auth user is gone only classified columns keep the id", async () => {
    const plan = await repos.accountPortability.closingPlan(h.db as never, A.ownerId);
    expect(plan.soleOwnerOf.map((b) => b.businessId)).toEqual([A.businessId]);
    expect(plan.memberships).toBe(1);
    // A second owner, then the person can go without stranding the project (the founder deletes the auth user, F6).
    await h.db.execute(sql`insert into memberships (business_id, user_id, role) values (${A.businessId}, ${A.adminId}, 'owner') on conflict (business_id, user_id) do update set role = 'owner'`);
    expect((await repos.accountPortability.closingPlan(h.db as never, A.ownerId)).soleOwnerOf).toEqual([]);
    await h.db.execute(sql`delete from auth.users where id = ${A.ownerId}`);
    const left = await repos.accountPortability.leftovers(h.db as never, A.ownerId);
    for (const l of left) expect(["set null", "none"], l.column).toContain(ACCOUNT_COLUMNS[l.column]!.onDelete);
  });
});
