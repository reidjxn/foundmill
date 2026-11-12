/**
 * The account events migration over a database that already holds business events: it adds the two account tables
 * and leaves `events` and `outbox` exactly as they were (columns, constraints, indexes, policies, grants, triggers and
 * rows). Nothing is backfilled: a profile that was already public gets no event for the past.
 *
 * The migration's number may change when branches merge: `TAG` below is the one place this file names it.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

const TAG = "0085_account_events";
const BUSINESS_EVENT_TABLES = ["events", "outbox"] as const;

let h: TestHarness;
let A: BusinessFixture;
let before: unknown;
let rowsBefore: unknown;

const rows = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const names = sql`('events', 'outbox')`;

/** Everything the catalog says about the two business tables. */
async function describeBusinessEventTables() {
  return {
    columns: await rows(sql`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name in ${names} order by 1, ordinal_position`),
    constraints: await rows(sql`select conrelid::regclass::text as table_name, conname, contype::text as contype, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid::regclass::text in ${names} order by 1, 2`),
    referencedBy: await rows(sql`select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint where contype = 'f' and confrelid::regclass::text in ${names} order by 1, 2`),
    indexes: await rows(sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ${names} order by 1, 2`),
    policies: await rows(sql`select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public' and tablename in ${names} order by 1, 2`),
    tableGrants: await rows(sql`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ${names} order by 1, 2, 3`),
    columnGrants: await rows(sql`select table_name, grantee, column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name in ${names} order by 1, 2, 3, 4`),
    triggers: await rows(sql`select tgrelid::regclass::text as table_name, tgname, pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and tgrelid::regclass::text in ${names} order by 1, 2`),
    rls: await rows(sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ${names} order by 1`),
  };
}

const businessEventRows = async () => ({
  events: await rows(sql`select id, business_id, type, occurred_at, actor, entity_ids, payload, narrated, idempotency_key, created_at, updated_at from events order by id`),
  outbox: await rows(sql`select id, business_id, event_id, published_at, attempts, last_error, created_at, updated_at from outbox order by id`),
});

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag < TAG) });
  // A business with events and queue rows, and a person whose profile is already public.
  A = await createBusinessFixture(h, "m-account-events");
  for (const eventId of A.eventIds.slice(0, 2)) await h.pg.query(`insert into outbox (business_id, event_id) values ($1, $2)`, [A.businessId, eventId]);
  await h.pg.query(`insert into founder_profiles (user_id, display_name, handle, public, published_at) values ($1, 'Ana Ruiz', 'ana-ruiz', true, now())`, [A.ownerId]);
  before = await describeBusinessEventTables();
  rowsBefore = await businessEventRows();
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

describe(`${TAG} applied over existing business events`, () => {
  it("leaves the business event tables exactly as they were", async () => {
    expect((before as { columns: unknown[] }).columns.length).toBeGreaterThan(15);
    expect((before as { policies: unknown[] }).policies.length).toBeGreaterThan(1);
    expect(await describeBusinessEventTables()).toEqual(before);
    const after = await businessEventRows();
    expect(after).toEqual(rowsBefore);
    expect((after.events as unknown[]).length).toBeGreaterThanOrEqual(6);
    expect(after.outbox as unknown[]).toHaveLength(2);
    // Still NOT NULL, still business-keyed.
    const nullable = await rows<{ table_name: string; is_nullable: string }>(sql`select table_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name in ${names} and column_name = 'business_id' order by 1`);
    expect(nullable).toEqual(BUSINESS_EVENT_TABLES.map((table_name) => ({ table_name, is_nullable: "NO" })));
  });

  it("adds the two account tables, keyed by the account and tied to it, with nothing backfilled", async () => {
    const columns = await rows<{ table_name: string; column_name: string; is_nullable: string }>(sql`
      select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name in ('account_events', 'account_outbox') order by 1, ordinal_position`);
    expect(columns.filter((c) => c.table_name === "account_events").map((c) => `${c.column_name}${c.is_nullable === "NO" ? "!" : ""}`)).toEqual(["id!", "user_id!", "type!", "occurred_at!", "actor!", "payload!", "idempotency_key", "created_at!", "updated_at!"]);
    expect(columns.filter((c) => c.table_name === "account_outbox").map((c) => `${c.column_name}${c.is_nullable === "NO" ? "!" : ""}`)).toEqual(["id!", "user_id!", "event_id!", "published_at", "attempts!", "last_error", "next_attempt_at", "created_at!", "updated_at!"]);
    expect(columns.some((c) => c.column_name === "business_id")).toBe(false);
    const fks = await rows<{ table_name: string; definition: string }>(sql`
      select conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as definition from pg_constraint where contype = 'f' and conrelid::regclass::text in ('account_events', 'account_outbox') order by 1, 2`);
    expect(fks.map((f) => `${f.table_name}: ${f.definition}`)).toEqual([
      "account_events: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE",
      "account_outbox: FOREIGN KEY (event_id, user_id) REFERENCES account_events(id, user_id) ON DELETE CASCADE",
      "account_outbox: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE",
    ]);
    expect(await rows(sql`select (select count(*)::int from account_events) as events, (select count(*)::int from account_outbox) as queued`)).toEqual([{ events: 0, queued: 0 }]);
  });

  it("is written so drizzle can run it statement by statement", () => {
    const migration = readMigrations().find((m) => m.tag === TAG)!;
    expect(migration.statements.length).toBeGreaterThan(15);
    for (const statement of migration.statements) expect(statement.trim().endsWith(";"), statement.slice(0, 60)).toBe(true);
    // It names no other table to change: the business event tables appear only in its header comment.
    const code = migration.sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/\b(alter|drop)\s+table\s+(if\s+exists\s+)?(events|outbox)\b/i);
    expect(code).not.toMatch(/\bon\s+(events|outbox)\b/i);
  });
});
