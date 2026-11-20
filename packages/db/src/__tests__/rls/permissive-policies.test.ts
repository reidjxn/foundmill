/**
 * Supabase's performance advisor "multiple permissive policies" (lint 0006), as a test (docs/holistic-plan/WP-11 T6):
 * for each command, a table has one permissive policy that applies to it, unless it is listed here with the reason. The
 * helpers make a table born split, so a new business table passes without an entry.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "../../testing/pglite";

/** Table to reason. Add one only with a reason that a person can check. */
export const MULTIPLE_PERMISSIVE_ALLOWED: Record<string, string> = {
  posts: "posts_moderate is for all on purpose: a community's moderator may read and remove any post, beside the author's own policies",
  community_members: "community_members_moderate is for all on purpose: a moderator manages the roster, beside a person's own row",
};

/** Tables whose insert, update and delete policies were written by hand with different rules (not split from a `_write`). */
const WRITE_RULES_DIFFER: Record<string, string> = {
  connections: "per-command policies written by hand, not split from a _write",
  memberships: "per-command policies written by hand (0026, 0092): standing is managed by owners, not by every writer",
  outbox: "split by hand in 0099, with its own rules per command",
  project_pages: "per-command policies written by hand, not split from a _write",
};

let h: TestHarness;
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;

beforeAll(async () => {
  h = await createTestDb();
});
afterAll(() => h?.close());

describe("multiple permissive policies (lint 0006)", () => {
  for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    it(`no table outside the allow-list has two permissive policies for ${cmd}`, async () => {
      const found = await rows<{ t: string }>(sql`
        select tablename as t from pg_policies
         where schemaname = 'public' and permissive = 'PERMISSIVE' and (cmd = ${cmd} or cmd = 'ALL')
         group by tablename having count(*) > 1 order by 1`);
      expect(found.map((r) => r.t).filter((t) => !(t in MULTIPLE_PERMISSIVE_ALLOWED))).toEqual([]);
    });
  }

  it("every allow-list entry is still needed", async () => {
    const found = await rows<{ t: string }>(sql`
      select distinct a.tablename as t from pg_policies a join pg_policies b
        on b.schemaname = a.schemaname and b.tablename = a.tablename and b.policyname <> a.policyname
       where a.schemaname = 'public' and a.permissive = 'PERMISSIVE' and b.permissive = 'PERMISSIVE'
         and (a.cmd = b.cmd or a.cmd = 'ALL' or b.cmd = 'ALL')`);
    for (const t of Object.keys(MULTIPLE_PERMISSIVE_ALLOWED)) expect(found.map((r) => r.t), t).toContain(t);
  });

  it("no table keeps a <table>_write policy", async () => {
    const found = await rows<{ p: string }>(sql`select tablename || '.' || policyname as p from pg_policies where schemaname = 'public' and policyname = tablename || '_write' order by 1`);
    expect(found.map((r) => r.p)).toEqual([]);
  });

  it("the three write policies of a table agree: insert checks what update and delete use", async () => {
    const found = await rows<{ t: string }>(sql`
      select i.tablename as t from pg_policies i
        join pg_policies u on u.schemaname = i.schemaname and u.tablename = i.tablename and u.policyname = i.tablename || '_update'
        join pg_policies d on d.schemaname = i.schemaname and d.tablename = i.tablename and d.policyname = i.tablename || '_delete'
       where i.schemaname = 'public' and i.policyname = i.tablename || '_insert'
         and not (i.with_check = u.with_check and u.qual = d.qual and i.with_check is not null)
       order by 1`);
    expect(found.map((r) => r.t).filter((t) => !(t in WRITE_RULES_DIFFER))).toEqual([]);
  });

  it("a table made by each helper is born split", async () => {
    await h.db.transaction(async (tx) => {
      const names = async (t: string) => ((await tx.execute(sql`select policyname as n from pg_policies where schemaname = 'public' and tablename = ${t} order by 1`)) as unknown as { rows: { n: string }[] }).rows.map((r) => r.n);
      await tx.execute(sql`create table zz_helper_tenant (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id))`);
      await tx.execute(sql`select fm_tenant_table('zz_helper_tenant')`);
      await tx.execute(sql`create table zz_helper_idea (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), owner_user_id uuid)`);
      await tx.execute(sql`select fm_idea_table('zz_helper_idea')`);
      for (const t of ["zz_helper_tenant", "zz_helper_idea"]) {
        expect(await names(t), t).toEqual([`${t}_delete`, `${t}_insert`, `${t}_select`, `${t}_update`]);
      }
      const writers = ((await tx.execute(sql`select cmd, qual, with_check from pg_policies where tablename = 'zz_helper_tenant' and cmd <> 'SELECT' order by cmd`)) as unknown as { rows: { cmd: string; qual: string | null; with_check: string | null }[] }).rows;
      const expr = "has_role(business_id, '{owner,admin,member}'::text[])";
      expect(writers.map((w) => [w.cmd, w.qual, w.with_check])).toEqual([["DELETE", expr, null], ["INSERT", null, expr], ["UPDATE", expr, expr]]);
      throw new Error("rollback");
    }).catch((e: Error) => {
      if (e.message !== "rollback") throw e;
    });
  });
});
