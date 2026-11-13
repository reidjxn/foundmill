/**
 * The attributions migration over a database that already has the account event store (0085): besides its own table
 * it redefines `fm_account_event_types()` with `signup.attributed` and `referral.arrived`, and the two checks that
 * call the function follow it without being touched. Before it, a member could plant a row under either name in the
 * business's `events` and `account_events` refused both; after it, the reverse, for every writer, and the planted rows
 * are gone. Nothing else about `events`, `outbox`, `account_events` or `account_outbox` changes: no constraint, no
 * policy, no grant, and the function keeps its attributes and who may call it.
 *
 * The migration's number may change when branches merge: `TAG` below is the one place this file names it.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, unwrapDbError, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

const TAG = "0086_attributions";
const NEW_TYPES = ["signup.attributed", "referral.arrived"] as const;
const EVENT_TABLES = sql`('events', 'outbox', 'account_events', 'account_outbox')`;

type Described = Awaited<ReturnType<typeof describeEventTables>>;
let h: TestHarness;
let A: BusinessFixture;
let before: Described;
let listBefore: string[] = [];
const refusedBefore: string[] = [];
const planted: string[] = [];
let kept = "";

const rows = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
/** What Postgres said, or "written". The runners (`asUser`, `service`, `anon`) already give Postgres's own message. */
const message = (p: Promise<unknown>) => p.then(() => "written", (err: unknown) => (err instanceof Error ? err.message : String(err)));
/** The same on the owner connection, where drizzle's wrapper is still around the error. */
const ownerMessage = (p: Promise<unknown>) => message(p.catch((err: unknown) => Promise.reject(unwrapDbError(err))));

/** Everything the catalog says about the four event tables and about the function both checks call. */
async function describeEventTables() {
  return {
    constraints: await rows(sql`select conrelid::regclass::text as table_name, conname, contype::text as contype, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid::regclass::text in ${EVENT_TABLES} order by 1, 2`),
    indexes: await rows(sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ${EVENT_TABLES} order by 1, 2`),
    policies: await rows(sql`select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public' and tablename in ${EVENT_TABLES} order by 1, 2`),
    tableGrants: await rows(sql`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ${EVENT_TABLES} order by 1, 2, 3`),
    columnGrants: await rows(sql`select table_name, grantee, column_name, privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name in ${EVENT_TABLES} order by 1, 2, 3, 4`),
    triggers: await rows(sql`select tgrelid::regclass::text as table_name, tgname, pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and tgrelid::regclass::text in ${EVENT_TABLES} order by 1, 2`),
    // The function, without its body: one of it, the same owner, attributes and callers.
    list: await rows(sql`
      select p.oid::int as oid, p.proowner::regrole::text as owner, l.lanname as lang, p.provolatile::text as volatility, p.proparallel::text as parallel, p.prosecdef as definer,
             p.proconfig as config, pg_get_function_result(p.oid) as returns, p.proacl::text as acl
        from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'fm_account_event_types' order by 1`),
  };
}

const intoEvents = (type: string) => sql`insert into events (business_id, type, actor, payload) values (${A.businessId}::uuid, ${type}, ${JSON.stringify({ kind: "user", id: A.memberId })}::jsonb, '{"sourceKind":"project_page","sourceRef":"forged"}'::jsonb) returning id`;
const intoAccountEvents = (userId: string, type: string) =>
  sql`insert into account_events (user_id, type, actor, payload) values (${userId}::uuid, ${type}, '{"kind":"system","id":"attribution"}'::jsonb, '{"sourceKind":"project_page","sourceRef":"bread-by-bike"}'::jsonb) returning id`;

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag < TAG) });
  A = await createBusinessFixture(h, "m-attribution-events");
  before = await describeEventTables();
  listBefore = (await rows<{ types: string[] }>(sql`select fm_account_event_types() as types`))[0]!.types;
  // Before: a member plants both names in the business's events, each with a queue row; the account store takes neither.
  for (const type of NEW_TYPES) {
    const id = (await h.asUser(A.memberId).execute<{ id: string }>(intoEvents(type)))[0]!.id;
    await h.pg.query(`insert into outbox (business_id, event_id) values ($1, $2)`, [A.businessId, id]);
    planted.push(id);
    refusedBefore.push(await message(h.service().execute(intoAccountEvents(A.ownerId, type))));
  }
  // A row of the business's own that must stay.
  kept = (await h.asUser(A.memberId).execute<{ id: string }>(intoEvents("task.started")))[0]!.id;
  await h.pg.query(`insert into outbox (business_id, event_id) values ($1, $2)`, [A.businessId, kept]);
  // The same connection that ran the statements above runs the migration: nothing is restarted in between.
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
}, 120_000);
afterAll(() => h?.close());

describe(`${TAG} applied over the account event store`, () => {
  it("before it, the list was 0085's: the two names were a business's to write and not an account's", () => {
    expect(listBefore).toEqual(["profile.published", "profile.unpublished"]);
    expect(planted).toHaveLength(2);
    for (const refusal of refusedBefore) expect(refusal).toMatch(/account_events_type_account_scoped/);
  });

  it("the list is 0086's four (0094 adds founder_notice.sent), and the function is the same one: owner, attributes and callers unchanged", async () => {
    expect((await rows<{ types: string[] }>(sql`select fm_account_event_types() as types`))[0]!.types).toEqual(["profile.published", "profile.unpublished", "signup.attributed", "referral.arrived"]);
    const now = await describeEventTables();
    // Replaced in place (the same oid, so both checks still point at it), with nothing about it changed but its body.
    expect(now.list).toEqual(before.list);
    expect(now.list).toHaveLength(1);
    expect(now.list[0]).toMatchObject({ lang: "sql", volatility: "i", parallel: "s", definer: false, config: ['search_path=""'], returns: "text[]" });
    const [may] = await rows<{ anon: boolean; authenticated: boolean; service: boolean }>(sql`
      select has_function_privilege('anon', 'fm_account_event_types()', 'execute') as anon,
             has_function_privilege('authenticated', 'fm_account_event_types()', 'execute') as authenticated,
             has_function_privilege('service_role', 'fm_account_event_types()', 'execute') as service`);
    expect(may).toEqual({ anon: false, authenticated: true, service: true });
    await expect(h.anon().execute(sql`select fm_account_event_types()`)).rejects.toThrow(/permission denied/);
  });

  it("changes nothing else about the four event tables: constraints, indexes, policies, grants and triggers are as they were", async () => {
    const now = await describeEventTables();
    expect(now).toEqual(before);
    expect((before.constraints as { conname: string }[]).map((c) => c.conname)).toEqual(expect.arrayContaining(["events_not_account_scoped", "account_events_type_account_scoped"]));
  });

  it("the planted rows and their queue rows are gone, and the business's own rows stay", async () => {
    expect(await rows(sql`select id from events where type in ('signup.attributed', 'referral.arrived')`)).toEqual([]);
    for (const id of planted) expect(await rows(sql`select id from outbox where event_id = ${id}::uuid`), id).toEqual([]);
    expect(await rows<{ type: string }>(sql`select type from events where id = ${kept}::uuid`)).toEqual([{ type: "task.started" }]);
    expect(await rows(sql`select id from outbox where event_id = ${kept}::uuid`)).toHaveLength(1);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from events where business_id = ${A.businessId}::uuid`))[0]!.n).toBeGreaterThanOrEqual(A.eventIds.length + 1);
    // Every row of `events` satisfies the check as it now reads.
    expect(await rows(sql`select id from events where type = any (fm_account_event_types())`)).toEqual([]);
  });

  it("after it, no writer puts either name into a business's events: a member, an admin, an owner, the service role, the owner connection", async () => {
    for (const type of NEW_TYPES) {
      for (const writer of [A.memberId, A.adminId, A.ownerId]) expect(await message(h.asUser(writer).execute(intoEvents(type))), `${type} as ${writer}`).toMatch(/events_not_account_scoped/);
      expect(await message(h.service().execute(intoEvents(type))), `${type} as service_role`).toMatch(/events_not_account_scoped/);
      expect(await ownerMessage(h.db.execute(intoEvents(type))), `${type} on the owner connection`).toMatch(/events_not_account_scoped/);
      // Not by renaming a row that is already there either.
      expect(await message(h.asUser(A.memberId).execute(sql`update events set type = ${type} where id = ${kept}::uuid`)), `${type} by update`).toMatch(/events_not_account_scoped/);
    }
    // A member still writes the business's own events.
    expect(await message(h.asUser(A.memberId).execute(intoEvents("task.started")))).toBe("written");
  });

  it("after it, account_events takes both names from the services and from nobody else, and a person reads only their own", async () => {
    const [mine] = await h.service().execute<{ id: string }>(intoAccountEvents(A.memberId, "signup.attributed"));
    const [theirs] = await h.service().execute<{ id: string }>(intoAccountEvents(A.ownerId, "referral.arrived"));
    expect(await h.asUser(A.memberId).execute(sql`select id, type from account_events`)).toEqual([{ id: mine!.id, type: "signup.attributed" }]);
    expect(await h.asUser(A.ownerId).execute(sql`select id, type from account_events`)).toEqual([{ id: theirs!.id, type: "referral.arrived" }]);
    // The two people share a business, and neither reads the other's row; nor do the rest of its people.
    expect(await h.asUser(A.memberId).execute(sql`select id from account_events where id = ${theirs!.id}::uuid`)).toEqual([]);
    expect(await h.asUser(A.ownerId).execute(sql`select id from account_events where id = ${mine!.id}::uuid`)).toEqual([]);
    for (const other of [A.adminId, A.viewerId]) expect(await h.asUser(other).execute(sql`select id from account_events`), other).toEqual([]);
    // No client role writes either type, its own row included.
    for (const type of NEW_TYPES) {
      expect(await message(h.asUser(A.memberId).execute(intoAccountEvents(A.memberId, type))), type).toMatch(/permission denied for table/);
      expect(await message(h.anon().execute(intoAccountEvents(A.memberId, type))), type).toMatch(/permission denied for table/);
    }
    // A business-scoped name is still not an account's.
    expect(await message(h.service().execute(intoAccountEvents(A.ownerId, "signup.created")))).toMatch(/account_events_type_account_scoped/);
  });

  it("touches `events` once, for the planted rows, and `outbox` and the account tables never", () => {
    const migration = readMigrations().find((m) => m.tag === TAG)!;
    const code = migration.statements.map((st) => st.split("\n").filter((line) => !line.trim().startsWith("--")).join(" ").trim());
    expect(code.filter((st) => /\b(events|outbox|account_events|account_outbox)\b/.test(st))).toEqual(["delete from events where type in ('signup.attributed', 'referral.arrived');"]);
    // It replaces the list and never drops it: a drop would take the two checks' dependency with it.
    expect(code.filter((st) => /fm_account_event_types/.test(st)).map((st) => st.split("(")[0]!.trim())).toEqual(["create or replace function fm_account_event_types", "revoke all on function fm_account_event_types", "grant execute on function fm_account_event_types"]);
  });
});
