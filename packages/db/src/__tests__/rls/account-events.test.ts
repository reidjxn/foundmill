/**
 * account_events and account_outbox (0085): the person-level event store. A person reads their own rows and only the
 * columns that are theirs; nobody else reads them (another account, a cofounder in the same project, a signed-out
 * visitor); no client role writes; the queue is the services' alone; the database refuses a payload that carries an
 * account id (in any common spelling), an actor that is a second party and any rewrite; an account-scoped type is
 * never a row of a business's `events`, and only such a type is a row here; the rows go with the account.
 *
 * The list of account-scoped types is `fm_account_event_types()`: defined by 0085 and redefined by every migration
 * that adds a type (0086: `signup.attributed`, `referral.arrived`). It is held equal to `ACCOUNT_EVENT_TYPES` twice
 * here: as the migrated database answers it, and as the latest migration that defines it spells it.
 */
import { ACCOUNT_EVENT_TYPES } from "@foundmill/shared";
import { getTableColumns, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../../migrations";
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

/**
 * Every definition of `fm_account_event_types()` among the migrations, in the order they run: the migration, the
 * attributes it states between the signature and the body, and the list it returns.
 */
function accountTypeDefinitions(): { tag: string; replaces: boolean; attributes: string; types: string[] }[] {
  const definition = /create (or replace )?function fm_account_event_types\(\) returns text\[\]\s+([^$]*?)\s+as \$\$\s*select array\[([^\]]*)\]::text\[\]\s*\$\$;/g;
  return readMigrations().flatMap((m) =>
    [...m.sql.matchAll(definition)].map((found) => ({
      tag: m.tag,
      replaces: found[1] !== undefined,
      attributes: found[2]!.replace(/\s+/g, " "),
      types: [...found[3]!.matchAll(/'([^']*)'/g)].map((t) => t[1]!),
    })),
  );
}
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
    // Every common spelling of an id, the other person's and the row's own: without hyphens, with hyphens elsewhere,
    // in capitals, with Unicode dashes, in braces, as a URN, and inside a longer run of letters and digits.
    const compact = bo.replace(/-/g, "");
    const spellings: Record<string, string> = {
      compact,
      "compact, capitals": compact.toUpperCase(),
      "a hyphen every four": compact.replace(/(.{4})/g, "$1-").slice(0, -1),
      "one stray hyphen": `${compact.slice(0, 5)}-${compact.slice(5)}`,
      "hyphen U+2010": bo.replace(/-/g, "\u2010"),
      "non-breaking hyphen U+2011": bo.replace(/-/g, "\u2011"),
      "en dash U+2013": bo.replace(/-/g, "\u2013"),
      "em dash U+2014": bo.replace(/-/g, "\u2014"),
      "minus sign U+2212": bo.replace(/-/g, "\u2212"),
      "fullwidth hyphen U+FF0D": bo.replace(/-/g, "\uff0d"),
      braces: `{${bo}}`,
      urn: `urn:uuid:${bo}`,
      "spaces between the groups": bo.replace(/-/g, " "),
      "dots between the groups": bo.replace(/-/g, "."),
      "underscores between the groups": bo.replace(/-/g, "_"),
      "colons between pairs": compact.replace(/(..)/g, "$1:").slice(0, -1),
      "after other letters and digits": `ab12${compact}`,
      "before other letters and digits": `${compact}cd34`,
      "inside a longer run": `abcdef0123456789${compact}0123456789abcdef`,
      "the row's own, compact": ada.replace(/-/g, ""),
    };
    for (const [how, value] of Object.entries(spellings)) {
      await expect(write(ada, "profile.published", { handle: "ada-lovelace", n: value }), how).rejects.toThrow(refused);
      await expect(write(ada, "profile.published", { handle: "ada-lovelace", deep: [{ list: [`see ${value}.`] }] }), `${how}, nested in text`).rejects.toThrow(refused);
    }
    await expect(write(ada, "profile.published", { handle: "ada-lovelace", [compact]: true }), "a compact id as a key").rejects.toThrow(refused);
    // What the database cannot see, and says so (migration header, ARCHITECTURE §5): an id cut in two across values.
    const split = await write(ada, "profile.published", { handle: "ada-lovelace", a: "7b0c5e0e-0000-4000", b: "-8000-000000000002" });
    expect(split.eventId).toMatch(/^[0-9a-f-]{36}$/);
    // A long run of letters and digits that holds no account's id (a hash) is not refused here.
    await write(ada, "profile.published", { handle: "ada-lovelace", digest: "0123456789abcdef".repeat(4) });
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
    // An id in any spelling is not a word: without hyphens, in capitals, with Unicode dashes, behind a prefix.
    const compact = bo.replace(/-/g, "");
    for (const id of [compact, compact.toUpperCase(), `follow:${compact}`, `follow:${bo.replace(/-/g, ".")}`, `follow:${bo.replace(/-/g, "_")}`, `f:${compact.replace(/(.{8})/g, "$1:")}x`, bo.replace(/-/g, "\u2010"), compact.replace(/(.{4})/g, "$1-").slice(0, -1), "Platform", "platform team", "", "x".repeat(64)]) {
      await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "system", id } }), id).rejects.toThrow(refused);
    }
    // Exactly `kind` and `id`, both text: nothing else rides in the actor.
    for (const actor of [
      { kind: "system", id: "platform", other: bo },
      { kind: "system", id: "platform", note: "x" },
      { kind: "user", id: ada, on_behalf_of: bo },
      { kind: "system", id: 7 },
      { kind: "system", id: ["platform"] },
      { kind: ["system"], id: "platform" },
      { kind: "user", id: ada.toUpperCase() },
      { kind: "user", id: ada.replace(/-/g, "") },
      {},
    ]) {
      await expect(write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: actor as Record<string, unknown> }), JSON.stringify(actor)).rejects.toThrow(refused);
    }
    await write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "system", id: "platform" } });
    await write(ada, "profile.published", { handle: "ada-lovelace" }, { actor: { kind: "system", id: "public-page:follow_form.v2" } });
  });

  it("the guards run with an empty search path, and the helpers are not the clients' to call", async () => {
    const functions = await truth<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(sql`
      select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fm_account_events_guard', 'fm_account_event_types', 'fm_account_id_text') order by 1`);
    expect(functions.map((f) => [f.proname, f.prosecdef, f.proconfig])).toEqual([
      ["fm_account_event_types", false, ['search_path=""']],
      ["fm_account_events_guard", true, ['search_path=""']],
      ["fm_account_id_text", false, ['search_path=""']],
    ]);
    // What the guard reads a value as: lower case, an id's punctuation gone (hyphen, dashes, space, dot, colon, underscore).
    expect(await truth<{ t: string }>(sql`select fm_account_id_text(${"0A1B\u20102C3D\u2014x-Y\uff0dZ a.b:c_d"}) as t`)).toEqual([{ t: "0a1b2c3dxyzabcd" }]);
    // JSON's own punctuation stays, so two values never run together.
    expect(await truth<{ t: string }>(sql`select fm_account_id_text(${JSON.stringify({ a: "0a1b", b: ["2c3d", 7] })}::jsonb::text) as t`)).toEqual([{ t: '{"a""0a1b","b"["2c3d",7]}' }]);
    await expect(h.asUser(ada).execute(sql`select fm_account_id_text('x')`)).rejects.toThrow(/permission denied/);
    await expect(h.anon().execute(sql`select fm_account_id_text('x')`)).rejects.toThrow(/permission denied/);
    await expect(h.anon().execute(sql`select fm_account_event_types()`)).rejects.toThrow(/permission denied/);
  });

  it("the shape is held: an account-scoped type, an object payload of bounded size, a bounded key", async () => {
    const insert = (type: string, payload: string, key: string | null = null) =>
      h.service().execute(sql`insert into account_events (user_id, type, actor, payload, idempotency_key) values (${ada}::uuid, ${type}, ${JSON.stringify({ kind: "user", id: ada })}::jsonb, ${payload}::jsonb, ${key})`);
    for (const type of ["Profile Published", "profile", "profile.published ", "PROFILE.PUBLISHED", "profile.renamed", "payment.received", "task.started", ""]) {
      await expect(insert(type, "{}"), type).rejects.toThrow(/account_events_type_account_scoped/);
    }
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

  it("the database lists the account-scoped types once, and the list is the shared vocabulary's", async () => {
    const [row] = await truth<{ types: string[] }>(sql`select fm_account_event_types() as types`);
    // A type added to ACCOUNT_EVENT_TYPES without the migration that redefines the function fails here.
    expect([...row!.types].sort()).toEqual([...ACCOUNT_EVENT_TYPES].sort());
    // The same list in the same order, so a type is only ever appended.
    expect(row!.types).toEqual([...ACCOUNT_EVENT_TYPES]);
    const checks = await truth<{ table_name: string; conname: string; definition: string }>(sql`
      select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint
       where conname in ('events_not_account_scoped', 'account_events_type_account_scoped') order by 1`);
    expect(checks.map((c) => [c.table_name, c.conname])).toEqual([["account_events", "account_events_type_account_scoped"], ["events", "events_not_account_scoped"]]);
    for (const c of checks) expect(c.definition, c.conname).toContain("fm_account_event_types()");
  });

  it("the latest definition among the migrations is the shared vocabulary's, and every redefinition only appends and keeps the attributes", async () => {
    const definitions = accountTypeDefinitions();
    // 0085 creates it; every later one replaces it. Not pinned to a count: the next account-scoped type adds one.
    expect(definitions.length).toBeGreaterThanOrEqual(2);
    expect(definitions.map((d) => d.replaces)).toEqual([false, ...definitions.slice(1).map(() => true)]);
    expect(definitions[0]!.tag).toBe("0085_account_events");
    expect(definitions[0]!.types).toEqual(["profile.published", "profile.unpublished"]);
    // The latest one, whichever migration it is in, is `ACCOUNT_EVENT_TYPES`, in order.
    const latest = definitions.at(-1)!;
    expect(latest.types).toEqual([...ACCOUNT_EVENT_TYPES]);
    expect(latest.types).toEqual(expect.arrayContaining(["signup.attributed", "referral.arrived"]));
    for (const [i, d] of definitions.entries()) {
      expect(new Set(d.types).size, d.tag).toBe(d.types.length);
      // `create or replace` resets what it does not state: language, volatility, parallel safety and the search path
      // are restated exactly as 0085 has them.
      expect(d.attributes, d.tag).toBe("language sql immutable parallel safe set search_path = ''");
      // Append only: each list starts with the one before it.
      if (i > 0) expect(d.types.slice(0, definitions[i - 1]!.types.length), d.tag).toEqual(definitions[i - 1]!.types);
    }
    // No migration defines it in a spelling the reader above does not see (a second function, another signature).
    const mentions = readMigrations().flatMap((m) => [...m.sql.matchAll(/^\s*create\b[^;]*?\bfunction\s+fm_account_event_types\b/gim)].map(() => m.tag));
    expect(mentions).toEqual(definitions.map((d) => d.tag));
    // And the migrated database holds one function of that name, with those attributes and 0085's grants.
    const live = await truth<{ volatility: string; parallel: string; definer: boolean; config: string[] | null; lang: string; args: number; anon: boolean; authenticated: boolean; service: boolean; everyone: boolean }>(sql`
      select p.provolatile::text as volatility, p.proparallel::text as parallel, p.prosecdef as definer, p.proconfig as config, l.lanname as lang, p.pronargs::int as args,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             has_function_privilege('service_role', p.oid, 'execute') as service,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as everyone
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.proname = 'fm_account_event_types'`);
    expect(live).toEqual([{ volatility: "i", parallel: "s", definer: false, config: ['search_path=""'], lang: "sql", args: 0, anon: false, authenticated: true, service: true, everyone: false }]);
  });

  it("account_events takes the two attribution types, each in its own person's rows, and still nothing else", async () => {
    const kim = await h.createUser("kim-account-events@test.local");
    const lou = await h.createUser("lou-account-events@test.local");
    // One sign-up, two people: the new person's row and the credited person's, both by the system, both a public address.
    const arrived = await write(kim, "signup.attributed", { sourceKind: "project_page", sourceRef: "bread-by-bike" }, { actor: { kind: "system", id: "attribution" }, key: "attribution:1:signup" });
    const credited = await write(lou, "referral.arrived", { sourceKind: "project_page", sourceRef: "bread-by-bike" }, { actor: { kind: "system", id: "attribution" }, key: "attribution:1:referral" });
    expect((await h.asUser(kim).run((tx) => tx.select(mine).from(s.accountEvents))).map((r) => [r.id, r.type, r.payload])).toEqual([[arrived.eventId, "signup.attributed", { sourceKind: "project_page", sourceRef: "bread-by-bike" }]]);
    expect((await h.asUser(lou).run((tx) => tx.select(mine).from(s.accountEvents))).map((r) => [r.id, r.type, r.payload])).toEqual([[credited.eventId, "referral.arrived", { sourceKind: "project_page", sourceRef: "bread-by-bike" }]]);
    // Neither reads the other's row, by its id or by the other's account; a third account and a visitor read neither.
    expect(await h.asUser(kim).execute(sql`select id from account_events where id = ${credited.eventId}::uuid or user_id = ${lou}::uuid`)).toEqual([]);
    expect(await h.asUser(lou).execute(sql`select id from account_events where id = ${arrived.eventId}::uuid or user_id = ${kim}::uuid`)).toEqual([]);
    expect(await h.asUser(cy).execute(sql`select id from account_events where id in (${arrived.eventId}::uuid, ${credited.eventId}::uuid)`)).toEqual([]);
    await expect(h.anon().execute(sql`select id from account_events where id = ${arrived.eventId}::uuid`)).rejects.toThrow(DENIED);
    // The guard holds for these types as for any: the credited person's row can never carry the new person's account id.
    await expect(write(lou, "referral.arrived", { sourceKind: "project_page", sourceRef: "bread-by-bike", who: kim }, { actor: { kind: "system", id: "attribution" } })).rejects.toThrow(/never names a person by their account id/);
    await expect(write(lou, "referral.arrived", { sourceKind: "project_page", sourceRef: kim.replace(/-/g, "") }, { actor: { kind: "system", id: "attribution" } })).rejects.toThrow(/never names a person by their account id/);
    await expect(write(lou, "referral.arrived", { sourceKind: "project_page", sourceRef: "bread-by-bike" }, { actor: { kind: "user", id: kim } })).rejects.toThrow(/account_events_actor_own/);
    // A name near the new ones is not one of them.
    for (const type of ["signup.created", "referral.credited", "signup.attributed ", "Referral.Arrived", "referral"]) {
      await expect(write(kim, type, { sourceKind: "project_page", sourceRef: "bread-by-bike" }), type).rejects.toThrow(/account_events_type_account_scoped/);
    }
  });

  it("a member of a business cannot put signup.attributed or referral.arrived into the business's events", async () => {
    // Named here as well as in the loop below, so the two attribution types cannot drop out of it unnoticed.
    expect([...ACCOUNT_EVENT_TYPES]).toEqual(expect.arrayContaining(["signup.attributed", "referral.arrived"]));
    for (const type of ["signup.attributed", "referral.arrived"]) {
      const insert = sql`insert into events (business_id, type, actor, payload) values (${A.businessId}::uuid, ${type}, ${JSON.stringify({ kind: "user", id: A.memberId })}::jsonb, '{"sourceKind":"project_page","sourceRef":"forged"}'::jsonb)`;
      for (const writer of [A.memberId, A.adminId, A.ownerId]) await expect(h.asUser(writer).execute(insert), `${type} as ${writer}`).rejects.toThrow(/events_not_account_scoped/);
      await expect(h.service().execute(insert), `${type} as service_role`).rejects.toThrow(/events_not_account_scoped/);
      await expect(asOwner(insert), `${type} on the owner connection`).rejects.toThrow(/events_not_account_scoped/);
    }
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from events where type in ('signup.attributed', 'referral.arrived')`)).toEqual([{ n: 0 }]);
  });

  it("the business events table refuses an account-scoped type, whoever writes: a member, an owner, the service role, the owner connection", async () => {
    const before = await truth<{ n: number }>(sql`select count(*)::int as n from events`);
    const refused = /events_not_account_scoped/;
    for (const type of ACCOUNT_EVENT_TYPES) {
      const insert = sql`insert into events (business_id, type, actor, payload) values (${A.businessId}::uuid, ${type}, ${JSON.stringify({ kind: "user", id: A.ownerId })}::jsonb, '{"handle":"forged"}'::jsonb)`;
      // As a signed-in member straight through RLS (what the review reproduced), and as every other writer.
      for (const member of [A.memberId, A.adminId, A.ownerId]) await expect(h.asUser(member).execute(insert), `${type} as ${member}`).rejects.toThrow(refused);
      await expect(h.service().execute(insert), `${type} as service_role`).rejects.toThrow(refused);
      await expect(asOwner(insert), `${type} on the owner connection`).rejects.toThrow(refused);
      // Not by renaming a row that is already there either.
      await expect(h.asUser(A.memberId).execute(sql`update events set type = ${type} where id = ${A.eventIds[0]!}::uuid`), `${type} by update`).rejects.toThrow(refused);
    }
    // A member still writes the business's own events, as before.
    const [ok] = await h.asUser(A.memberId).execute<{ id: string }>(sql`insert into events (business_id, type, payload) values (${A.businessId}::uuid, 'task.started', '{}'::jsonb) returning id`);
    expect(ok!.id).toMatch(/^[0-9a-f-]{36}$/);
    await h.db.execute(sql`delete from events where id = ${ok!.id}::uuid`);
    expect(await truth<{ n: number }>(sql`select count(*)::int as n from events`)).toEqual(before);
    for (const reader of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      expect(await h.asUser(reader).execute(sql`select id from events where type = any (${sql`array[${sql.join(ACCOUNT_EVENT_TYPES.map((t) => sql`${t}`), sql`, `)}]`})`), reader).toEqual([]);
    }
  });

  it("a business's archive never carries them, and the events repo refuses the account-scoped types before the database does", async () => {
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
