/**
 * `pnpm --filter @foundmill/db check:schema [-- --json] [--no-compare]`: the production schema check (WP-11 T8 steps 1
 * to 3, 6 and 7; T10 step 2). Read-only by construction: every query runs in one `begin transaction read only` with a
 * statement timeout, so Postgres refuses any write. DATABASE_URL names the database to read (the connection string is
 * never printed). It reports:
 * - migrations: rows in `drizzle.__drizzle_migrations` against the entries of `migrations/meta/_journal.json`;
 * - public tables: the list, compared with the same list on an in-memory PGlite migrated from this checkout
 *   (`--no-compare` skips it);
 * - backup schemas (`bak_%`): for each, its size, its largest tables, owner and grants, what outside it depends on it,
 *   and how many businesses and credentials it still holds that the live tables no longer have;
 * - connection limits: the session's `statement_timeout`, `idle_in_transaction_session_timeout`, `max_connections`, and
 *   the role settings of `postgres`, `authenticator` and `authenticated`.
 * Exits 1 when the migration count differs, a table is missing or extra, or a backup schema exists; 0 otherwise.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@foundmill/shared";
import postgres from "postgres";

export type Run = (text: string) => Promise<Record<string, unknown>[]>;

export interface BackupSchema {
  name: string;
  tables: number;
  totalSize: string | null;
  largest: Record<string, unknown>[];
  owner: Record<string, unknown>[];
  grants: Record<string, unknown>[];
  foreignKeysFromOutside: Record<string, unknown>[];
  viewsOutside: Record<string, unknown>[];
  /** Businesses in the backup with no live row (null: the backup has no `businesses` table). */
  goneBusinesses: number | null;
  /** Rows of the backup's `credentials` (null: no such table). */
  credentials: number | null;
}

export interface SchemaReport {
  migrations: { applied: number | null; journal: number };
  tables: string[];
  missingTables: string[] | null;
  extraTables: string[] | null;
  backups: BackupSchema[];
  limits: { settings: Record<string, unknown>; roles: Record<string, unknown>[] };
  problems: string[];
}

const BAK_NAME = /^bak_[a-z0-9_]+$/;

export function journalEntries(): number {
  const path = fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url));
  return (JSON.parse(readFileSync(path, "utf8")) as { entries: unknown[] }).entries.length;
}

export async function publicTables(run: Run): Promise<string[]> {
  const rows = await run("select tablename from pg_tables where schemaname = 'public' order by 1");
  return rows.map((r) => String(r.tablename));
}

const count = async (run: Run, text: string): Promise<number> => Number((await run(text))[0]?.n ?? 0);

async function backupSchema(run: Run, name: string): Promise<BackupSchema> {
  // Callers pass only names that match BAK_NAME, so quoting the name as a literal or identifier is safe.
  const lit = `'${name}'`;
  const has = async (table: string) => (await run(`select to_regclass('"${name}".${table}') is not null as ok`))[0]?.ok === true;
  return {
    name,
    tables: await count(run, `select count(*)::int as n from pg_tables where schemaname = ${lit}`),
    totalSize: ((await run(`select pg_size_pretty(sum(pg_total_relation_size(relid))) as s from pg_stat_user_tables where schemaname = ${lit}`))[0]?.s as string | null) ?? null,
    largest: await run(`select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as size from pg_stat_user_tables where schemaname = ${lit} order by pg_total_relation_size(relid) desc limit 15`),
    owner: await run(`select pg_get_userbyid(nspowner) as owner, nspacl::text as acl from pg_namespace where nspname = ${lit}`),
    grants: await run(`select grantee, privilege_type, count(*)::int as tables from information_schema.table_privileges where table_schema = ${lit} group by 1, 2 order by 1, 2`),
    foreignKeysFromOutside: await run(
      `select conrelid::regclass::text as from_table, conname from pg_constraint where contype = 'f' and connamespace <> ${lit}::regnamespace
         and confrelid in (select oid from pg_class where relnamespace = ${lit}::regnamespace)`,
    ),
    viewsOutside: await run(
      `select distinct dn.nspname as schema, dc.relname as view from pg_depend d
         join pg_class sc on d.refclassid = 'pg_class'::regclass and sc.oid = d.refobjid
         join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
         join pg_class dc on dc.oid = r.ev_class join pg_namespace dn on dn.oid = dc.relnamespace
        where sc.relnamespace = ${lit}::regnamespace and dn.nspname <> ${lit}`,
    ),
    goneBusinesses: (await has("businesses"))
      ? await count(run, `select count(*)::int as n from "${name}".businesses b where not exists (select 1 from public.businesses p where p.id::text = b.id::text)`)
      : null,
    credentials: (await has("credentials")) ? await count(run, `select count(*)::int as n from "${name}".credentials`) : null,
  };
}

/** Every read of the check. `reference` is the public table list of a database migrated from this checkout. */
export async function checkSchema(run: Run, reference: string[] | null): Promise<SchemaReport> {
  const hasDrizzle = (await run("select to_regclass('drizzle.__drizzle_migrations') is not null as ok"))[0]?.ok === true;
  const migrations = {
    applied: hasDrizzle ? await count(run, "select count(*)::int as n from drizzle.__drizzle_migrations") : null,
    journal: journalEntries(),
  };
  const tables = await publicTables(run);
  const missingTables = reference ? reference.filter((t) => !tables.includes(t)) : null;
  const extraTables = reference ? tables.filter((t) => !reference.includes(t)) : null;
  const names = (await run("select nspname from pg_namespace where nspname like 'bak\\_%' order by 1")).map((r) => String(r.nspname));
  const backups: BackupSchema[] = [];
  const odd = names.filter((n) => !BAK_NAME.test(n));
  for (const name of names.filter((n) => BAK_NAME.test(n))) backups.push(await backupSchema(run, name));
  const settings =
    (await run(
      // reset_val: the session's own value, not the check's `set local statement_timeout`.
      `select current_user, (select reset_val from pg_settings where name = 'statement_timeout') as statement_timeout,
         (select reset_val from pg_settings where name = 'idle_in_transaction_session_timeout') as idle_in_transaction_session_timeout,
         current_setting('max_connections') as max_connections`,
    ))[0] ?? {};
  const roles = await run("select rolname, rolconfig::text as rolconfig from pg_roles where rolname in ('postgres', 'authenticator', 'authenticated') order by 1");

  const problems: string[] = [];
  if (migrations.applied !== null && migrations.applied !== migrations.journal)
    problems.push(`migrations: ${migrations.applied} applied, the journal has ${migrations.journal}`);
  if (missingTables?.length) problems.push(`missing tables: ${missingTables.join(", ")}`);
  if (extraTables?.length) problems.push(`tables in no migration: ${extraTables.join(", ")}`);
  for (const n of odd) problems.push(`backup schema ${JSON.stringify(n)} has an unexpected name; read it by hand`);
  for (const b of backups) problems.push(`backup schema ${b.name} is still in the live database (${b.tables} tables, ${b.totalSize ?? "0 bytes"})`);
  return { migrations, tables, missingTables, extraTables, backups, limits: { settings, roles }, problems };
}

/** The reference list: an in-memory PGlite with every migration of this checkout applied. */
async function referenceTables(): Promise<string[]> {
  const { createTestDb } = await import("./testing/pglite");
  const h = await createTestDb({ pglite: true });
  try {
    return await publicTables(async (text) => (await h.pg.query<Record<string, unknown>>(text)).rows);
  } finally {
    await h.close();
  }
}

function printReport(r: SchemaReport): void {
  const print = (line: string) => process.stdout.write(`${line}\n`);
  print(`Migrations: ${r.migrations.applied ?? "no drizzle.__drizzle_migrations"} applied; the journal has ${r.migrations.journal}`);
  print(`Public tables: ${r.tables.length}`);
  if (r.missingTables) print(`  missing against this checkout: ${r.missingTables.join(", ") || "none"}`);
  if (r.extraTables) print(`  in no migration of this checkout: ${r.extraTables.join(", ") || "none"}`);
  print(`Backup schemas (bak_%): ${r.backups.length}`);
  for (const b of r.backups) {
    print(`  ${b.name}: ${b.tables} tables, ${b.totalSize ?? "0 bytes"}; businesses gone from public: ${b.goneBusinesses ?? "no table"}; credentials: ${b.credentials ?? "no table"}`);
    print(`    owner and grants: ${JSON.stringify(b.owner)} ${JSON.stringify(b.grants)}`);
    print(`    depended on from outside: ${b.foreignKeysFromOutside.length} foreign keys, ${b.viewsOutside.length} views ${JSON.stringify([...b.foreignKeysFromOutside, ...b.viewsOutside])}`);
    for (const t of b.largest) print(`    ${String(t.relname)}  ${String(t.n_live_tup)} rows  ${String(t.size)}`);
  }
  print(`Limits: ${JSON.stringify(r.limits.settings)}`);
  for (const role of r.limits.roles) print(`  ${String(role.rolname)}: ${String(role.rolconfig ?? "no settings")}`);
  print(r.problems.length ? `Problems:\n${r.problems.map((p) => `  - ${p}`).join("\n")}` : "No problems.");
}

async function main(): Promise<void> {
  const url = loadEnv().DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error("DATABASE_URL must be a postgres:// connection string");
  const reference = process.argv.includes("--no-compare") ? null : await referenceTables();
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // A second guard beside the read-only transaction; TLS for any host but this machine.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connection: { default_transaction_read_only: true }, ...(local ? {} : { ssl: "require" as const }) });
  try {
    const report = (await sql.begin("transaction read only", async (tx) => {
      await tx.unsafe("set local statement_timeout = '15s'");
      return checkSchema(async (text) => [...(await tx.unsafe(text))] as Record<string, unknown>[], reference);
    })) as SchemaReport;
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printReport(report);
    process.exitCode = report.problems.length ? 1 : 0;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
