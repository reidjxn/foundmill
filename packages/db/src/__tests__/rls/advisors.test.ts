/**
 * The Supabase database advisors, as tests (docs/holistic-plan/WP-11 T4, T5, T7). Each assertion is the advisor's own
 * rule read from the catalog of a database the harness migrated, so a finding fails here before it reaches production.
 * Runs on PGlite and, with RLS_TEST_DATABASE_URL, on a real Postgres with Supabase's roles (CI's postgres-suites job).
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { SERVICE_ONLY_TABLES } from "./tables";

/**
 * Tables that keep two permissive policies for one command, on purpose, with the reason. The advisor's lint 0006
 * counts every other pair as a cost on each read (both expressions are evaluated).
 */
export const MULTIPLE_PERMISSIVE_ALLOWED: Record<string, string> = {
  posts: "posts_moderate is `for all` on purpose: a moderator acts on any post beside the author's own policies",
  community_members: "community_members_moderate is `for all` on purpose, beside the member's own policies",
};

let h: TestHarness;
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;

beforeAll(async () => {
  h = await createTestDb();
});
afterAll(() => h?.close());

describe("security advisors", () => {
  it("every function in public pins its search_path (lint 0011, function_search_path_mutable)", async () => {
    const found = await rows<{ fn: string }>(sql`
      select p.oid::regprocedure::text as fn
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prokind in ('f', 'p')
         and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
       order by 1`);
    expect(found.map((r) => r.fn)).toEqual([]);
  });

  it("the tables with RLS on and no policy are exactly the service-only list (lint 0008), and no client role reads them", async () => {
    const found = await rows<{ t: string }>(sql`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
         and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
       order by 1`);
    expect(found.map((r) => r.t)).toEqual([...SERVICE_ONLY_TABLES].sort());
    for (const t of SERVICE_ONLY_TABLES) {
      for (const role of ["anon", "authenticated"]) {
        const [r] = await rows<{ ok: boolean }>(sql`select has_table_privilege(${role}::name, ${`public.${t}`}::text, 'select') as ok`);
        expect(r?.ok, `${role} reads ${t}`).toBe(false);
      }
    }
  });

  it("every table in public has RLS on (lint 0013, rls_disabled_in_public)", async () => {
    const found = await rows<{ t: string }>(sql`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
         and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
       order by 1`);
    expect(found.map((r) => r.t)).toEqual([]);
  });
});

describe("performance advisors", () => {
  it("no policy calls auth.uid() per row (lint 0003, auth_rls_initplan): every call is wrapped in a select", async () => {
    const bare = "regexp_replace(coalesce(%s, ''), 'select\\s+auth\\.uid\\(\\)', '', 'gi') ~ 'auth\\.uid\\(\\)'";
    const found = await rows<{ p: string }>(sql.raw(`
      select tablename || '.' || policyname as p from pg_policies
       where schemaname = 'public' and (${bare.replace("%s", "qual")} or ${bare.replace("%s", "with_check")})
       order by 1`));
    expect(found.map((r) => r.p)).toEqual([]);
  });

  it("a policy on auth.uid() is planned as one InitPlan, not a call per row", async () => {
    const userId = await h.createUser("advisors-initplan");
    const plan = await h.asUser(userId).execute<{ "QUERY PLAN": string }>(sql`explain (costs off) select 1 from founder_profiles`);
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("InitPlan");
  });

  it("every foreign key in public has an index led by its own columns (lint 0001, unindexed_foreign_keys)", async () => {
    // A port of splinter's 0001: an index covers a key when its first columns are the key's columns, in any order.
    const found = await rows<{ c: string }>(sql`
      select cl.relname || '.' || ct.conname as c
        from pg_constraint ct
        join pg_class cl on cl.oid = ct.conrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where ct.contype = 'f' and n.nspname = 'public'
         and not exists (
           select 1 from pg_index ix
            where ix.indrelid = ct.conrelid
              and (select array_agg(k order by k) from unnest(ct.conkey) k)
                = (select array_agg(k order by k) from unnest((ix.indkey::int2[])[0:cardinality(ct.conkey) - 1]) k))
       order by 1`);
    expect(found.map((r) => r.c)).toEqual([]);
  });

  it("no table outside the allow-list has two permissive policies for one command (lint 0006, multiple_permissive_policies)", async () => {
    const found = await rows<{ t: string; cmd: string }>(sql`
      select tablename as t, c.cmd from pg_policies p
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as c(cmd)
       where p.schemaname = 'public' and p.permissive = 'PERMISSIVE' and (p.cmd = c.cmd or p.cmd = 'ALL')
       group by 1, 2 having count(*) > 1
       order by 1, 2`);
    expect([...new Set(found.map((r) => r.t))].sort()).toEqual(Object.keys(MULTIPLE_PERMISSIVE_ALLOWED).sort());
  });

  it("a table made by fm_tenant_table is born with one policy per command", async () => {
    await h.db.execute(sql`create table advisors_probe (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
    try {
      await h.db.execute(sql`select fm_tenant_table('advisors_probe')`);
      const names = await rows<{ policyname: string }>(sql`select policyname from pg_policies where tablename = 'advisors_probe' order by 1`);
      expect(names.map((r) => r.policyname)).toEqual(["advisors_probe_delete", "advisors_probe_insert", "advisors_probe_select", "advisors_probe_update"]);
    } finally {
      await h.db.execute(sql`drop table advisors_probe`);
    }
  });
});
