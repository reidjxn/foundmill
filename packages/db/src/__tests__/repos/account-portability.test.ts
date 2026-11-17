/**
 * Account export and closing by request (WP-11 T16). Runs on PGlite and, with RLS_TEST_DATABASE_URL, on a real Postgres.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_COLUMNS, accountPortabilityRepo } from "../../repos/account-portability";
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
    const keys = await rows<{ k: string; d: string }>(sql`
      select cl.relname || '.' || a.attname as k, ct.confdeltype::text as d
        from pg_constraint ct join pg_class cl on cl.oid = ct.conrelid join pg_namespace n on n.oid = cl.relnamespace
        join pg_attribute a on a.attrelid = ct.conrelid and a.attnum = any(ct.conkey)
       where ct.contype = 'f' and n.nspname = 'public' and ct.confrelid = 'auth.users'::regclass
       order by 1`);
    const keyed = Object.entries(ACCOUNT_COLUMNS).filter(([, c]) => c.onDelete !== "none").map(([k]) => k).sort();
    expect(keyed).toEqual(keys.map((r) => r.k));
    // The classification says what deleting the auth user really does to each row.
    const action = { c: "cascade", n: "set null", r: "restrict", a: "restrict" } as Record<string, string>;
    for (const r of keys) expect(ACCOUNT_COLUMNS[r.k]!.onDelete, r.k).toBe(action[r.d]);
  });

  it("an export holds one account only", async () => {
    const out = await accountPortabilityRepo.export(h.db as never, A.ownerId);
    expect(out.format).toBe("foundmill-account-export/1");
    expect(out.tables["memberships.user_id"]?.length).toBeGreaterThan(0);
    const text = JSON.stringify(out);
    for (const id of [B.ownerId, B.adminId, B.memberId, B.businessId]) expect(text).not.toContain(id);
    await expect(accountPortabilityRepo.export(h.db as never, "nope")).rejects.toThrow(/UUID/);
  });

  it("never tells a person someone blocked them, nor shows others' read or mute state", async () => {
    await h.db.execute(sql`insert into connections (from_user, to_user, status, blocked_by) values (${B.ownerId}, ${B.memberId}, 'blocked', ${B.ownerId})`);
    const blocked = await accountPortabilityRepo.export(h.db as never, B.memberId);
    expect(JSON.stringify(blocked.tables["connections.to_user"] ?? [])).not.toContain("blocked");
    const blocker = await accountPortabilityRepo.export(h.db as never, B.ownerId);
    expect(JSON.stringify(blocker.tables["connections.from_user"])).toContain("blocked");
    for (const [key, c] of Object.entries(ACCOUNT_COLUMNS)) for (const col of c.omit ?? []) for (const row of blocker.tables[key] ?? []) expect(row, `${key} ${col}`).not.toHaveProperty(col);
  });

  it("closing: a sole owner's project is named first; after the auth user is gone only classified columns keep the id", async () => {
    const plan = await accountPortabilityRepo.closingPlan(h.db as never, A.ownerId);
    expect(plan.soleOwnerOf.map((b) => b.businessId)).toEqual([A.businessId]);
    // An archived project can be restored, so it counts too.
    await h.db.execute(sql`update businesses set archived_at = now() where id = ${A.businessId}`);
    expect((await accountPortabilityRepo.closingPlan(h.db as never, A.ownerId)).soleOwnerOf.map((b) => b.businessId)).toEqual([A.businessId]);
    await h.db.execute(sql`update businesses set archived_at = null where id = ${A.businessId}`);
    expect(plan.memberships).toBe(1);
    // A second owner, then the person can go without stranding the project (the founder deletes the auth user, F6).
    await h.db.execute(sql`insert into memberships (business_id, user_id, role) values (${A.businessId}, ${A.adminId}, 'owner') on conflict (business_id, user_id) do update set role = 'owner'`);
    expect((await accountPortabilityRepo.closingPlan(h.db as never, A.ownerId)).soleOwnerOf).toEqual([]);
    await h.db.execute(sql`delete from auth.users where id = ${A.ownerId}`);
    const left = await accountPortabilityRepo.leftovers(h.db as never, A.ownerId);
    for (const l of left) expect(["set null", "none"], l.column).toContain(ACCOUNT_COLUMNS[l.column]!.onDelete);
  });
});
