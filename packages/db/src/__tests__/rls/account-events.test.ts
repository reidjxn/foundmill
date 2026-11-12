/**
 * account_events and account_outbox (0085): the person-level event store. A person reads their own rows and only the
 * columns that are theirs; nobody else reads them (another account, a cofounder in the same project, a signed-out
 * visitor); no client role writes; the queue is the services' alone; the database refuses a payload that carries an
 * account id, an actor that is a second party and any rewrite; the rows go with the account.
 */
import { ACCOUNT_EVENT_TYPES } from "@foundmill/shared";
import { getTableColumns, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { EXPORT_EXCLUDED_TABLES, EXPORT_TABLES } from "../../repos/portability";
import * as s from "../../schema";
import { ACCOUNT_EVENT_CLIENT_COLUMNS, ACCOUNT_EVENT_HIDDEN_COLUMNS } from "../../schema";
import { createTestDb, unwrapDbError, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

const DENIED = /permission denied for table/;

let h: TestHarness;
let ada: string;
let bo: string;
let cy: string;
let A: BusinessFixture;

/** The columns a client role may name (the grant of 0085), as Drizzle columns. */
const mine = { id: s.accountEvents.id, userId: s.accountEvents.userId, type: s.accountEvents.type, occurredAt: s.accountEvents.occurredAt, payload: s.accountEvents.payload, createdAt: s.accountEvents.createdAt };

interface Written {
  eventId: string;
}
/** What the writer does, as the service role: the event, then its queue row. */
async function write(userId: string, type: string, payload: Record<string, unknown>, options: { actor?: Record<string, unknown>; key?: string | null } = {}): Promise<Written> {
  const actor = options.actor ?? { kind: "user", id: userId };
  return h.service().run(async (tx) => {
    const res = (await tx.execute(
      sql`insert into account_events (user_id, type, actor, payload, idempotency_key) values (${userId}::uuid, ${type}, ${JSON.stringify(actor)}::jsonb, ${JSON.stringify(payload)}::jsonb, ${options.key ?? null}) returning id`,
    )) as unknown as { rows: { id: string }[] };
    const eventId = res.rows[0]!.id;
    await tx.execute(sql`insert into account_outbox (user_id, event_id) values (${userId}::uuid, ${eventId}::uuid)`);
    return { eventId };
  });
}

const truth = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
/** A statement on the owner connection (every privilege, no RLS), failing with Postgres's own message. */
const asOwner = (q: ReturnType<typeof sql>) => h.db.execute(q).catch((err: unknown) => Promise.reject(unwrapDbError(err)));

beforeAll(async () => {
  h = await createTestDb();
  ada = await h.createUser("ada-account-events@test.local");
  bo = await h.createUser("bo-account-events@test.local");
  cy = await h.createUser("cy-account-events@test.local");
  A = await createBusinessFixture(h, "acct-events");
});
afterAll(() => h?.close());

describe("account_events: who reads", () => {
  it("a person reads their own rows and nobody else's", async () => {
    await write(ada, "profile.published", { handle: "ada-lovelace" });
    await write(ada, "profile.unpublished", { handle: "ada-lovelace" });
    await write(bo, "profile.published", { handle: "bo-ode" });
    const seenByAda = await h.asUser(ada).run((tx) => tx.select(mine).from(s.accountEvents));
    expect(seenByAda.map((r) => [r.userId, r.type, r.payload]).sort()).toEqual([
      [ada, "profile.published", { handle: "ada-lovelace" }],
      [ada, "profile.unpublished", { handle: "ada-lovelace" }],
    ]);
    expect((await h.asUser(bo).run((tx) => tx.select(mine).from(s.accountEvents))).map((r) => [r.userId, r.payload])).toEqual([[bo, { handle: "bo-ode" }]]);
    // A third account sees nothing, not even by naming the others.
    expect(await h.asUser(cy).run((tx) => tx.select(mine).from(s.accountEvents))).toEqual([]);
    expect(await h.asUser(cy).execute(sql`select id from account_events where user_id = ${ada}::uuid`)).toEqual([]);
    expect(await h.asUser(cy).execute(sql`select count(*)::int as n from account_events`)).toEqual([{ n: 0 }]);
  });

  it("the people of a project the person belongs to read nothing of it", async () => {
    // The owner's own fact; the admin, member and viewer are in the same business.
    const { eventId } = await write(A.ownerId, "profile.published", { handle: "the-owner" });
    expect((await h.asUser(A.ownerId).run((tx) => tx.select(mine).from(s.accountEvents))).map((r) => r.id)).toEqual([eventId]);
    for (const other of [A.adminId, A.memberId, A.viewerId]) {
      expect(await h.asUser(other).run((tx) => tx.select(mine).from(s.accountEvents)), other).toEqual([]);
      expect(await h.asUser(other).execute(sql`select id from account_events where id = ${eventId}::uuid`), other).toEqual([]);
    }
    // And nothing about it sits in the business's own events, which they do read.
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from events where type in ('profile.published', 'profile.unpublished')`)).toEqual([{ n: 0 }]);
    expect(Object.keys(getTableColumns(s.accountEvents))).not.toContain("businessId");
    expect(Object.keys(getTableColumns(s.accountOutbox))).not.toContain("businessId");
  });

  it("a signed-out visitor reads nothing", async () => {
    await expect(h.anon().execute(sql`select id from account_events`)).rejects.toThrow(DENIED);
    await expect(h.anon().execute(sql`select count(*) from account_events`)).rejects.toThrow(DENIED);
  });

  it("a person reads only the columns that are theirs: not the actor, not the idempotency key, not every column at once", async () => {
    await write(cy, "profile.published", { handle: "cy-young" }, { actor: { kind: "system", id: "platform" }, key: "private-key-with-other-ids" });
    await expect(h.asUser(cy).run((tx) => tx.select().from(s.accountEvents))).rejects.toThrow(DENIED);
    await expect(h.asUser(cy).execute(sql`select * from account_events`)).rejects.toThrow(DENIED);
    for (const column of ACCOUNT_EVENT_HIDDEN_COLUMNS) {
      await expect(h.asUser(cy).execute(sql`select ${sql.identifier(column)} from account_events`), column).rejects.toThrow(DENIED);
      // Not through a filter either: a hidden column cannot be probed.
      await expect(h.asUser(cy).execute(sql`select id from account_events where ${sql.identifier(column)} is not null`), column).rejects.toThrow(DENIED);
    }
    for (const column of ACCOUNT_EVENT_CLIENT_COLUMNS) expect(await h.asUser(cy).execute(sql`select ${sql.identifier(column)} from account_events`), column).toHaveLength(1);
  });

  it("every column is on one side of the grant, and the catalog's grants are exactly that", async () => {
    const columns = Object.values(getTableColumns(s.accountEvents)).map((c) => c.name).sort();
    expect([...ACCOUNT_EVENT_CLIENT_COLUMNS, ...ACCOUNT_EVENT_HIDDEN_COLUMNS].sort()).toEqual(columns);
    const granted = await truth<{ grantee: string; column_name: string; privilege_type: string }>(sql`
      select grantee, column_name, privilege_type from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'account_events' and grantee in ('authenticated', 'anon', 'PUBLIC')`);
    expect(granted.filter((g) => g.grantee !== "authenticated")).toEqual([]);
    expect(granted.every((g) => g.privilege_type === "SELECT")).toBe(true);
    expect(granted.map((g) => g.column_name).sort()).toEqual([...ACCOUNT_EVENT_CLIENT_COLUMNS].sort());
    const tableGrants = await truth<{ table_name: string; grantee: string; privilege_type: string }>(sql`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('account_events', 'account_outbox') and grantee <> 'postgres' order by 1, 2, 3`);
    expect(tableGrants.map((g) => `${g.table_name} ${g.grantee} ${g.privilege_type}`)).toEqual([
      "account_events service_role INSERT",
      "account_events service_role SELECT",
      "account_outbox service_role INSERT",
      "account_outbox service_role SELECT",
      "account_outbox service_role UPDATE",
    ]);
    const policies = await truth<{ tablename: string; policyname: string; cmd: string; roles: string }>(sql`
      select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename in ('account_events', 'account_outbox')`);
    expect(policies).toEqual([{ tablename: "account_events", policyname: "account_events_own_select", cmd: "SELECT", roles: "{authenticated}" }]);
    const rls = await truth<{ tablename: string; rowsecurity: boolean }>(sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('account_events', 'account_outbox') order by 1`);
    expect(rls).toEqual([
      { tablename: "account_events", rowsecurity: true },
      { tablename: "account_outbox", rowsecurity: true },
    ]);
  });
});

describe("account_events: who writes", () => {
  it("a client role cannot insert, change or delete an event, its own included", async () => {
    const before = await truth<{ n: number }>(sql`select count(*)::int as n from account_events`);
    const insert = (userId: string) => sql`insert into account_events (user_id, type, actor, payload) values (${userId}::uuid, 'profile.published', ${JSON.stringify({ kind: "user", id: userId })}::jsonb, '{"handle":"forged"}'::jsonb)`;
    await expect(h.asUser(ada).execute(insert(ada))).rejects.toThrow(DENIED);
    await expect(h.asUser(ada).execute(insert(bo))).rejects.toThrow(DENIED);
    await expect(h.anon().execute(insert(ada))).rejects.toThrow(DENIED);
    await expect(h.asUser(ada).execute(sql`update account_events set payload = '{"handle":"changed"}'::jsonb where user_id = ${ada}::uuid`)).rejects.toThrow(DENIED);
    await expect(h.asUser(ada).execute(sql`delete from account_events where user_id = ${ada}::uuid`)).rejects.toThrow(DENIED);
    await expect(h.asUser(cy).execute(sql`delete from account_events where user_id = ${ada}::uuid`)).rejects.toThrow(DENIED);
    await expect(h.anon().execute(sql`delete from account_events`)).rejects.toThrow(DENIED);
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from account_events`)).toEqual(before);
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from account_events where payload->>'handle' in ('forged', 'changed')`)).toEqual([{ n: 0 }]);
  });

  it("the queue is the services' alone: no client role reads or writes it", async () => {
    const [mineRow] = await truth<{ event_id: string }>(sql`select event_id from account_outbox where user_id = ${ada}::uuid limit 1`);
    for (const run of [h.asUser(ada), h.asUser(cy), h.anon()]) {
      await expect(run.execute(sql`select id from account_outbox`)).rejects.toThrow(DENIED);
      await expect(run.execute(sql`insert into account_outbox (user_id, event_id) values (${ada}::uuid, ${mineRow!.event_id}::uuid)`)).rejects.toThrow(DENIED);
      await expect(run.execute(sql`update account_outbox set published_at = now()`)).rejects.toThrow(DENIED);
      await expect(run.execute(sql`delete from account_outbox`)).rejects.toThrow(DENIED);
    }
    expect((await h.service().execute(sql`select id from account_outbox where user_id = ${ada}::uuid`)).length).toBe(2);
  });

  it("the service role writes and reads, marks the queue, and holds no update or delete on an event", async () => {
    const dee = await h.createUser("dee-account-events@test.local");
    const { eventId } = await write(dee, "profile.published", { handle: "dee-dee" });
    expect(await h.service().execute(sql`select type, actor, payload from account_events where id = ${eventId}::uuid`)).toEqual([{ type: "profile.published", actor: { kind: "user", id: dee }, payload: { handle: "dee-dee" } }]);
    expect(await h.service().execute(sql`update account_outbox set published_at = now(), attempts = attempts + 1 where event_id = ${eventId}::uuid returning attempts`)).toEqual([{ attempts: 1 }]);
    await expect(h.service().execute(sql`update account_events set payload = '{"handle":"changed"}'::jsonb where id = ${eventId}::uuid`)).rejects.toThrow(DENIED);
    await expect(h.service().execute(sql`delete from account_events where id = ${eventId}::uuid`)).rejects.toThrow(DENIED);
    await expect(h.service().execute(sql`delete from account_outbox where event_id = ${eventId}::uuid`)).rejects.toThrow(DENIED);
  });

  it("an event is never rewritten, whoever asks", async () => {
    const [row] = await truth<{ id: string }>(sql`select id from account_events where user_id = ${ada}::uuid limit 1`);
    // The owner connection holds every privilege; the trigger still refuses.
    await expect(asOwner(sql`update account_events set payload = '{"handle":"rewritten"}'::jsonb where id = ${row!.id}::uuid`)).rejects.toThrow(/never changed once written/);
    await expect(asOwner(sql`update account_events set user_id = ${bo}::uuid where id = ${row!.id}::uuid`)).rejects.toThrow(/never changed once written/);
    expect(await truth<{ user_id: string; handle: string }>(sql`select user_id, payload->>'handle' as handle from account_events where id = ${row!.id}::uuid`)).toEqual([{ user_id: ada, handle: "ada-lovelace" }]);
  });
});

describe("account_events: the two-person rule in the database", () => {
  it("a payload never carries an account id: the other person's, the row's own, anywhere in it", async () => {
    const refused = /never names a person by their account id/;
    await expect(write(ada, "profile.published", { handle: "ada-lovelace", followerId: bo })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace", self: ada })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace", people: [{ who: bo.toUpperCase() }] })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace", note: `followed by ${bo} today` })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace", [bo]: true })).rejects.toThrow(refused);
    // The owner connection is held to it too.
    await expect(asOwner(sql`insert into account_events (user_id, type, actor, payload) values (${ada}::uuid, 'profile.published', '{"kind":"system","id":"platform"}'::jsonb, ${JSON.stringify({ from: bo })}::jsonb)`)).rejects.toThrow(refused);
    // A UUID that is no account's (the id of a record) is the writer's to judge, not the database's.
    const { eventId } = await write(ada, "profile.published", { handle: "ada-lovelace", recordId: "7b0c5e0e-0000-4000-8000-000000000001" });
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    // The public way to name someone: their handle.
    await write(ada, "profile.published", { handle: "ada-lovelace", followedBy: "bo-ode" });
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from account_events where payload::text like ${`%${bo}%`} or payload::text like ${`%${ada}%`}`)).toEqual([{ n: 0 }]);
  });

  it("the actor is the person themselves or the system by a word, never a second party", async () => {
    const refused = /account_events_actor_own/;
    await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "user", id: bo } })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "system", id: bo } })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "system", id: `follow:${bo}` } })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "agent", id: A.agentId } })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "webhook", id: "stripe" } })).rejects.toThrow(refused);
    await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "system" } })).rejects.toThrow(refused);
    await expect(asOwner(sql`insert into account_events (user_id, type, actor, payload) values (${ada}::uuid, 'profile.published', '"platform"'::jsonb, '{}'::jsonb)`)).rejects.toThrow(refused);
    await write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "system", id: "platform" } });
  });

  it("the shape is held: a dotted type, an object payload of bounded size, a bounded key", async () => {
    const insert = (type: string, payload: string, key: string | null = null) =>
      h.service().execute(sql`insert into account_events (user_id, type, actor, payload, idempotency_key) values (${ada}::uuid, ${type}, ${JSON.stringify({ kind: "user", id: ada })}::jsonb, ${payload}::jsonb, ${key})`);
    await expect(insert("Profile Published", "{}")).rejects.toThrow(/check constraint/);
    await expect(insert("profile", "{}")).rejects.toThrow(/check constraint/);
    await expect(insert("profile.published", "[]")).rejects.toThrow(/account_events_payload_object/);
    await expect(insert("profile.published", JSON.stringify({ handle: "x".repeat(17_000) }))).rejects.toThrow(/account_events_payload_object/);
    await expect(insert("profile.published", "{}", "")).rejects.toThrow(/check constraint/);
    await expect(insert("profile.published", "{}", "k".repeat(201))).rejects.toThrow(/check constraint/);
  });

  it("an idempotency key is one event per person, and two people may use the same key", async () => {
    const eve = await h.createUser("eve-account-events@test.local");
    const fay = await h.createUser("fay-account-events@test.local");
    await write(eve, "profile.published", { handle: "eve-eve" }, { key: "publish:1" });
    await expect(write(eve, "profile.published", { handle: "eve-eve" }, { key: "publish:1" })).rejects.toThrow(/account_events_idempotency_idx/);
    await write(fay, "profile.published", { handle: "fay-fay" }, { key: "publish:1" });
    await write(eve, "profile.unpublished", { handle: "eve-eve" });
    await write(eve, "profile.unpublished", { handle: "eve-eve" });
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from account_events where user_id = ${eve}::uuid`)).toEqual([{ n: 3 }]);
  });

  it("a queue row is its event's own person's: it cannot name another account, and an event is queued once", async () => {
    // An event of Bo's with no queue row yet.
    const [row] = await h.service().execute<{ id: string }>(sql`insert into account_events (user_id, type, actor, payload) values (${bo}::uuid, 'profile.unpublished', ${JSON.stringify({ kind: "user", id: bo })}::jsonb, '{"handle":"bo-ode"}'::jsonb) returning id`);
    await expect(h.service().execute(sql`insert into account_outbox (user_id, event_id) values (${ada}::uuid, ${row!.id}::uuid)`)).rejects.toThrow(/account_outbox_event_fkey/);
    await h.service().execute(sql`insert into account_outbox (user_id, event_id) values (${bo}::uuid, ${row!.id}::uuid)`);
    await expect(h.service().execute(sql`insert into account_outbox (user_id, event_id) values (${bo}::uuid, ${row!.id}::uuid)`)).rejects.toThrow(/account_outbox_event_id_key/);
  });
});

describe("account_events: lifecycle", () => {
  it("deleting an account removes its events and its queue rows, and nobody else's", async () => {
    const gus = await h.createUser("gus-account-events@test.local");
    const hal = await h.createUser("hal-account-events@test.local");
    await write(gus, "profile.published", { handle: "gus-gus" }, { key: "k1" });
    await write(gus, "profile.unpublished", { handle: "gus-gus" });
    await write(hal, "profile.published", { handle: "hal-hal" });
    const counts = async (userId: string) => (await truth<{ events: number; queued: number }>(sql`
      select (select count(*)::int from account_events where user_id = ${userId}::uuid) as events,
             (select count(*)::int from account_outbox where user_id = ${userId}::uuid) as queued`))[0];
    expect(await counts(gus)).toEqual({ events: 2, queued: 2 });
    await h.db.execute(sql`delete from auth.users where id = ${gus}::uuid`);
    expect(await counts(gus)).toEqual({ events: 0, queued: 0 });
    expect(await counts(hal)).toEqual({ events: 1, queued: 1 });
    // No queue row is ever left without its event.
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from account_outbox o where not exists (select 1 from account_events e where e.id = o.event_id)`)).toEqual([{ n: 0 }]);
  });

  it("a business's archive never carries them, and a business's events refuse the account-scoped types", async () => {
    // The export classifies tables with a business_id; these have none, so they are in neither list and cannot be asked for.
    expect(repos.portability.businessScopedTables()).not.toContain("account_events");
    expect(repos.portability.businessScopedTables()).not.toContain("account_outbox");
    for (const table of ["account_events", "account_outbox"]) {
      expect(EXPORT_TABLES[table], table).toBeUndefined();
      expect(EXPORT_EXCLUDED_TABLES[table], table).toBeUndefined();
      await expect(repos.portability.page(h.db as never, A.businessId, table)).rejects.toThrow(/not exported/);
    }
    for (const type of ACCOUNT_EVENT_TYPES) {
      await expect(repos.events.write(h.db as never, A.businessId, { type, actor: { kind: "user", id: A.ownerId }, payload: { handle: "the-owner" } })).rejects.toThrow(/account-scoped/);
      await expect(repos.events.writeMany(h.db as never, A.businessId, [{ type, actor: { kind: "user", id: A.ownerId }, payload: { handle: "the-owner" } }])).rejects.toThrow(/account-scoped/);
    }
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from events where type = any(${sql`array[${sql.join(ACCOUNT_EVENT_TYPES.map((t) => sql`${t}`), sql`, `)}]`})`)).toEqual([{ n: 0 }]);
  });
});

describe("repos.accountEvents", () => {
  it("under RLS a person lists and gets their own events, with only the readable fields", async () => {
    const ivy = await h.createUser("ivy-account-events@test.local");
    const first = await write(ivy, "profile.published", { handle: "ivy-ivy" }, { key: "secret-key" });
    await write(ivy, "profile.unpublished", { handle: "ivy-ivy" });
    const page = await h.asUser(ivy).run((tx) => repos.accountEvents.list(tx, ivy));
    expect(page.items.map((e) => e.type).sort()).toEqual(["profile.published", "profile.unpublished"]);
    expect(page.nextCursor).toBeNull();
    for (const item of page.items) expect(Object.keys(item).sort()).toEqual(["createdAt", "id", "occurredAt", "payload", "type", "userId"]);
    expect((await h.asUser(ivy).run((tx) => repos.accountEvents.list(tx, ivy, { type: "profile.published" }))).items.map((e) => e.id)).toEqual([first.eventId]);
    expect(await h.asUser(ivy).run((tx) => repos.accountEvents.get(tx, ivy, first.eventId))).toMatchObject({ id: first.eventId, userId: ivy, type: "profile.published", payload: { handle: "ivy-ivy" } });
    expect(await h.asUser(ivy).run((tx) => repos.accountEvents.countByType(tx, ivy))).toEqual({ "profile.published": 1, "profile.unpublished": 1 });
    // Paging walks every row once.
    const one = await h.asUser(ivy).run((tx) => repos.accountEvents.list(tx, ivy, { limit: 1 }));
    const two = await h.asUser(ivy).run((tx) => repos.accountEvents.list(tx, ivy, { limit: 1, cursor: one.nextCursor }));
    expect(new Set([...one.items, ...two.items].map((e) => e.id)).size).toBe(2);
    expect(two.nextCursor).toBeNull();
  });

  it("another account gets nothing through the repo, whichever id it names; the service-only reads are refused under RLS", async () => {
    const [row] = await truth<{ id: string }>(sql`select id from account_events where user_id = ${ada}::uuid limit 1`);
    expect((await h.asUser(bo).run((tx) => repos.accountEvents.list(tx, ada))).items).toEqual([]);
    expect(await h.asUser(bo).run((tx) => repos.accountEvents.get(tx, ada, row!.id))).toBeNull();
    expect(await h.asUser(bo).run((tx) => repos.accountEvents.get(tx, bo, row!.id))).toBeNull();
    expect(await h.asUser(bo).run((tx) => repos.accountEvents.countByType(tx, ada))).toEqual({});
    await expect(h.asUser(ada).run((tx) => repos.accountEvents.byIdempotencyKey(tx, ada, "anything"))).rejects.toThrow(DENIED);
    await expect(h.asUser(ada).run((tx) => repos.accountEvents.outboxPending(tx, ada))).rejects.toThrow(DENIED);
    await expect(h.asUser(ada).run((tx) => repos.accountEvents.outboxCountPending(tx))).rejects.toThrow(DENIED);
    await expect(h.asUser(ada).run((tx) => repos.accountEvents.outboxFailing(tx))).rejects.toThrow(DENIED);
  });

  it("on the service connection: the idempotency lookup and the queue's state, never a payload", async () => {
    const jo = await h.createUser("jo-account-events@test.local");
    const { eventId } = await write(jo, "profile.published", { handle: "jo-jo" }, { key: "publish:jo" });
    expect((await h.service().run((tx) => repos.accountEvents.byIdempotencyKey(tx, jo, "publish:jo")))?.id).toBe(eventId);
    expect(await h.service().run((tx) => repos.accountEvents.byIdempotencyKey(tx, jo, "publish:someone-else"))).toBeNull();
    expect(await h.service().run((tx) => repos.accountEvents.outboxCountPending(tx, jo))).toBe(1);
    const pending = await h.service().run((tx) => repos.accountEvents.outboxPending(tx, jo));
    expect(pending.map((p) => [p.eventId, p.type, p.attempts, p.lastError])).toEqual([[eventId, "profile.published", 0, null]]);
    expect(Object.keys(pending[0]!)).not.toContain("payload");
    await h.service().execute(sql`update account_outbox set attempts = 3, last_error = 'Error: stream is away' where event_id = ${eventId}::uuid`);
    const failing = await h.service().run((tx) => repos.accountEvents.outboxFailing(tx));
    expect(failing.find((f) => f.eventId === eventId)).toMatchObject({ userId: jo, attempts: 3, lastError: "Error: stream is away" });
    await expect(repos.accountEvents.list(h.db as never, "not-a-uuid")).rejects.toThrow(/Invalid user id/);
  });
});
