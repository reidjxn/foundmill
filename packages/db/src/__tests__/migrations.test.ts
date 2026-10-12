/** Migration journal format, structural invariants (BUILD §2.1 / §7) and Drizzle ⇄ SQL mirror. */
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgMaterializedView, PgTable, PgView } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, readJournal, readMigrations } from "../migrations";
import { appliedMigrationCount } from "../migrator";
import type { Db } from "../client";
import * as schema from "../schema";
import { createTestDb, rewriteForMissingVector, type TestHarness } from "../testing/pglite";
import { NON_TENANT_TABLES, TENANT_TABLES } from "./rls/tables";

let h: TestHarness;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(() => h?.close());

const rows = async <T>(q: ReturnType<typeof sql>) => (await h.db.execute(q)) as unknown as { rows: T[] };

describe("journal", () => {
  it("is readable by drizzle's own migrator and by our reader, in the same order", () => {
    const theirs = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
    const ours = readMigrations();
    expect(theirs).toHaveLength(23);
    expect(ours.map((m) => m.tag)).toEqual(readJournal().entries.map((e) => e.tag));
    expect(theirs.map((m) => m.folderMillis)).toEqual(ours.map((m) => m.when));
    expect(ours.map((m) => m.tag)).toEqual([
      "0001_tenancy",
      "0002_accounts_businesses_ideas",
      "0003_product",
      "0004_agents_departments_tasks",
      "0005_inbox_decisions_plans",
      "0006_distribution",
      "0007_journey",
      "0008_crm",
      "0009_finance",
      "0010_legal",
      "0011_integrations_governance_events",
      "0012_live_social",
      "0013_workspaces",
      "0014_workspace_push",
      "0015_app_installations",
      "0016_live_hardening",
      "0017_business_logos",
      "0018_business_foundations",
      "0019_foundations_progress",
      "0020_agent_conversations",
      "0021_us_english_copy",
      "0022_account_preferences",
      "0034_first_payments",
    ]);
    // strictly increasing `when` so drizzle applies them in order
    const whens = ours.map((m) => m.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(new Set(whens).size).toBe(whens.length);
  });
  it("every statement is separated by a breakpoint (so drizzle can run them one by one)", () => {
    for (const m of readMigrations()) {
      expect(m.statements.length, m.tag).toBeGreaterThan(1);
      for (const st of m.statements) expect(st.trim().endsWith(";"), `${m.tag}: ${st.slice(0, 60)}`).toBe(true);
    }
  });
  it("the no-pgvector rewrite only touches the extension and vector(N) types", () => {
    const text = "create extension if not exists vector;\nembedding vector(1024),\nx text";
    expect(rewriteForMissingVector(text)).toContain("real[]");
    expect(rewriteForMissingVector(text)).not.toMatch(/create extension if not exists vector;/);
    expect(rewriteForMissingVector("select vectors from t")).toBe("select vectors from t");
  });
});

describe("structural invariants", () => {
  it("every public table has row level security enabled", async () => {
    const r = await rows<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(r.rows.map((x) => x.tablename)).toEqual([]);
  });
  it("every table has created_at; every table but audit_log has updated_at with its trigger", async () => {
    const tables = (await rows<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((x) => x.tablename);
    const cols = (await rows<{ table_name: string; column_name: string }>(sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`)).rows;
    const trg = (await rows<{ tgname: string }>(sql`select tgname from pg_trigger where not tgisinternal`)).rows.map((x) => x.tgname);
    for (const t of tables) {
      const names = new Set(cols.filter((c) => c.table_name === t).map((c) => c.column_name));
      expect(names.has("id"), `${t}.id`).toBe(true);
      expect(names.has("created_at"), `${t}.created_at`).toBe(true);
      if (t === "audit_log") continue;
      expect(names.has("updated_at"), `${t}.updated_at`).toBe(true);
      expect(trg, `${t}_updated_at trigger`).toContain(`${t}_updated_at`);
    }
  });
  it("every business_id column and every foreign key column is covered by an index", async () => {
    const fks = await rows<{ table_name: string; column_name: string }>(sql`
      select c.conrelid::regclass::text as table_name, a.attname as column_name
        from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
    const idx = await rows<{ table_name: string; column_name: string }>(sql`
      select i.indrelid::regclass::text as table_name, a.attname as column_name
        from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')`);
    const covered = new Set(idx.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = fks.rows.map((r) => `${r.table_name}.${r.column_name}`).filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
    const bids = await rows<{ table_name: string }>(sql`
      select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id'
         and table_name in (select tablename from pg_tables where schemaname = 'public')`);
    expect(bids.rows.map((r) => r.table_name).filter((t) => !covered.has(`${t}.business_id`))).toEqual([]);
  });
  it("money columns come as bigint minor units with a char(3) currency beside them", async () => {
    const r = await rows<{ table_name: string; column_name: string; data_type: string }>(sql`
      select table_name, column_name, data_type from information_schema.columns
       where table_schema = 'public' and column_name like '%\\_minor' escape '\\'
         and table_name in (select tablename from pg_tables where schemaname = 'public')`);
    expect(r.rows.length).toBeGreaterThan(20);
    for (const c of r.rows) expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("bigint");
    const cur = (await rows<{ table_name: string; data_type: string; character_maximum_length: number }>(sql`
      select table_name, data_type, character_maximum_length from information_schema.columns where table_schema = 'public' and column_name = 'currency'`)).rows;
    for (const c of cur) expect([c.data_type, c.character_maximum_length], c.table_name).toEqual(["character", 3]);
    const tablesWithMinor = new Set(r.rows.map((c) => c.table_name));
    const tablesWithCurrency = new Set(cur.map((c) => c.table_name));
    for (const t of tablesWithMinor) expect(tablesWithCurrency.has(t), `${t} has *_minor but no currency`).toBe(true);
  });
  it("vector(1024) columns exist (or the documented real[] fallback when pgvector is absent)", async () => {
    const r = await rows<{ table_name: string; udt_name: string }>(sql`select table_name, udt_name from information_schema.columns where column_name = 'embedding'`);
    expect(r.rows.map((x) => x.table_name).sort()).toEqual(["entities", "sources"]);
    for (const c of r.rows) expect(c.udt_name).toBe(h.hasVector ? "vector" : "_float4");
  });
  it("credentials is reachable by service_role only; audit_log has no update/delete grants", async () => {
    const grants = (await rows<{ table_name: string; grantee: string; privilege_type: string }>(sql`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('credentials', 'audit_log')`)).rows;
    const cred = grants.filter((g) => g.table_name === "credentials");
    expect(new Set(cred.map((g) => g.grantee))).toEqual(new Set(["service_role", "postgres"]));
    const audit = grants.filter((g) => g.table_name === "audit_log" && g.grantee !== "postgres");
    expect(audit.every((g) => g.privilege_type === "SELECT" || g.privilege_type === "INSERT")).toBe(true);
    expect(audit.some((g) => g.grantee === "authenticated" && g.privilege_type === "INSERT")).toBe(true);
  });
  it("the views exist with the expected shape", async () => {
    const v = (await rows<{ table_name: string }>(sql`select table_name from information_schema.views where table_schema = 'public' order by 1`)).rows.map((x) => x.table_name);
    expect(v).toEqual(["journey_daily", "public_profiles"]);
    const mv = (await rows<{ matviewname: string }>(sql`select matviewname from pg_matviews`)).rows.map((x) => x.matviewname);
    expect(mv).toEqual(["journey_daily_mv"]);
  });
});

describe("Drizzle schema mirrors the SQL", () => {
  const drizzleTables = Object.values(schema).filter((v) => is(v, PgTable)) as unknown as PgTable[];
  const drizzleViews = Object.values(schema).filter((v) => is(v, PgView) || is(v, PgMaterializedView));

  it("has exactly one Drizzle table per SQL table", async () => {
    const sqlTables = (await rows<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`)).rows.map((x) => x.tablename).sort();
    const ours = drizzleTables.map((t) => getTableName(t)).sort();
    expect(ours).toEqual(sqlTables);
    expect(new Set(ours).size).toBe(ours.length);
    expect(drizzleViews).toHaveLength(3);
  });

  it("every Drizzle column exists in SQL with the same name and nullability, and vice versa", async () => {
    const cols = (await rows<{ table_name: string; column_name: string; is_nullable: "YES" | "NO" }>(sql`
      select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`)).rows;
    for (const t of drizzleTables) {
      const name = getTableName(t);
      const sqlCols = new Map(cols.filter((c) => c.table_name === name).map((c) => [c.column_name, c.is_nullable]));
      const drizzleCols = Object.values(getTableColumns(t));
      expect(drizzleCols.map((c) => c.name).sort(), `${name}: columns`).toEqual([...sqlCols.keys()].sort());
      for (const c of drizzleCols) {
        expect(c.notNull, `${name}.${c.name} nullability`).toBe(sqlCols.get(c.name) === "NO");
      }
    }
  });

  it("the tenant catalogue plus the documented exceptions covers every table", () => {
    const all = drizzleTables.map((t) => getTableName(t)).sort();
    const listed = [...TENANT_TABLES.map((t) => t.name), ...NON_TENANT_TABLES].sort();
    expect(listed).toEqual(all);
  });
});

describe("appliedMigrationCount", () => {
  it("reads postgres.js results (an array of rows) as well as PGlite's `{ rows }`", async () => {
    const answers = (shape: "array" | "rows") => {
      const values = [1, 16];
      return { execute: async () => (shape === "array" ? [{ n: values.shift() }] : { rows: [{ n: values.shift() }] }) } as unknown as Db;
    };
    expect(await appliedMigrationCount(answers("array"))).toBe(16);
    expect(await appliedMigrationCount(answers("rows"))).toBe(16);
  });
});
