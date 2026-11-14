/**
 * 0099 — a collaborator reads only the business events a collaborator's sections cover. `events_select` admits a
 * collaborator to a row only when its type is on `fm_collaborator_event_types()` (the types apps/stream `EVENT_WALLS`
 * files only under sections a collaborator reads; apps/stream collaborator-event-types.test.ts holds the list to the
 * walls), and the outbox follows its event. Owners, cofounders, admins, members and viewers read as before; an ended
 * collaborator reads nothing; another business's people reach none of it. A collaborator's writes are held to the same
 * list: nothing they cannot read is written, changed or removed by them.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../../migrations";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let cofounder: string;
let collaborator: string;
let ended: string;
/** A's events by name, written by the service: a payment (Finance), a spec version (Product), a lead (Distribution). */
const ev: Record<"payment" | "spec" | "lead" | "bPayment" | "bSpec", string> = { payment: "", spec: "", lead: "", bPayment: "", bSpec: "" };

const rows = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const PAYMENT = { amount: { amountMinor: 4900, currency: "USD" }, customer: "cus_1", firstPayment: true };

/** The ids of the given events this person's own RLS connection can select. */
const sees = async (userId: string, ids: readonly string[]): Promise<string[]> =>
  (await h.asUser(userId).run((tx) => tx.select({ id: s.events.id }).from(s.events).where(inArray(s.events.id, [...ids])))).map((r) => r.id).sort();
const seesOutbox = async (userId: string, ids: readonly string[]): Promise<string[]> =>
  (await h.asUser(userId).run((tx) => tx.select({ eventId: s.outbox.eventId }).from(s.outbox).where(inArray(s.outbox.eventId, [...ids])))).map((r) => r.eventId).sort();
const writeAs = (userId: string, businessId: string, type: "payment.received" | "task.started" | "spec.version_published", payload: Record<string, unknown>) =>
  h.asUser(userId).run((tx) => repos.events.write(tx, businessId, { type, actor: { kind: "user", id: userId }, payload }));

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "ev-collab-a");
  B = await createBusinessFixture(h, "ev-collab-b");
  [cofounder, collaborator, ended] = await Promise.all([h.createUser("ev-cofounder@test.local"), h.createUser("ev-collaborator@test.local"), h.createUser("ev-ended@test.local")]);
  await h.db.insert(s.memberships).values([
    { businessId: A.businessId, userId: cofounder, role: "cofounder" },
    { businessId: A.businessId, userId: collaborator, role: "collaborator" },
    { businessId: A.businessId, userId: ended, role: "collaborator", expiresAt: new Date(Date.now() - 60_000) },
  ]);
  const write = (businessId: string, type: "payment.received" | "spec.version_published" | "lead.created", payload: Record<string, unknown>) =>
    h.service().run((tx) => repos.events.write(tx, businessId, { type, actor: { kind: "webhook", id: "stripe" }, payload }));
  ev.payment = (await write(A.businessId, "payment.received", PAYMENT)).id;
  ev.spec = (await write(A.businessId, "spec.version_published", { specId: crypto.randomUUID(), version: 2 })).id;
  ev.lead = (await write(A.businessId, "lead.created", { entityId: crypto.randomUUID(), source: "page" })).id;
  ev.bPayment = (await write(B.businessId, "payment.received", PAYMENT)).id;
  ev.bSpec = (await write(B.businessId, "spec.version_published", { specId: crypto.randomUUID(), version: 1 })).id;
}, 120_000);
afterAll(() => h?.close());

describe("events 0099: who reads which event", () => {
  it("a collaborator cannot read a payment.received event, and reads a Product and a Distribution event", async () => {
    expect(await sees(collaborator, [ev.payment, ev.spec, ev.lead])).toEqual([ev.spec, ev.lead].sort());
    // Not by its id either, nor by its type, nor through the repo's own reads.
    expect(await sees(collaborator, [ev.payment])).toEqual([]);
    const byType = await h.asUser(collaborator).run((tx) => tx.select({ id: s.events.id }).from(s.events).where(and(eq(s.events.businessId, A.businessId), eq(s.events.type, "payment.received"))));
    expect(byType).toEqual([]);
    const listed = await h.asUser(collaborator).run((tx) => repos.events.list(tx, A.businessId, { limit: 200 }));
    expect(listed.items.map((e) => e.type)).not.toContain("payment.received");
    expect(listed.items.map((e) => e.id)).toEqual(expect.arrayContaining([ev.spec, ev.lead]));
    await expect(h.asUser(collaborator).run((tx) => repos.events.get(tx, A.businessId, ev.payment))).rejects.toThrow(/not found/i);
  });

  it("an owner, a cofounder, an admin, a member and a viewer read both, as before", async () => {
    for (const id of [A.ownerId, cofounder, A.adminId, A.memberId, A.viewerId]) expect(await sees(id, [ev.payment, ev.spec, ev.lead]), id).toEqual([ev.payment, ev.spec, ev.lead].sort());
  });

  it("an ended collaborator reads nothing", async () => {
    expect(await sees(ended, [ev.payment, ev.spec, ev.lead])).toEqual([]);
    expect(await seesOutbox(ended, [ev.payment, ev.spec, ev.lead])).toEqual([]);
  });

  it("cross-tenant: another business's people read none of A's events, and A's collaborator none of B's", async () => {
    for (const id of [B.ownerId, B.adminId, B.memberId, B.viewerId]) expect(await sees(id, [ev.payment, ev.spec, ev.lead]), id).toEqual([]);
    expect(await sees(collaborator, [ev.bPayment, ev.bSpec])).toEqual([]);
    expect(await seesOutbox(collaborator, [ev.bPayment, ev.bSpec])).toEqual([]);
    expect(await sees(B.ownerId, [ev.bPayment, ev.bSpec])).toEqual([ev.bPayment, ev.bSpec].sort());
  });

  it("the outbox follows its event: a collaborator reads the queue row of an event they can read, not of the payment", async () => {
    expect(await seesOutbox(collaborator, [ev.payment, ev.spec, ev.lead])).toEqual([ev.spec, ev.lead].sort());
    for (const id of [A.ownerId, cofounder, A.adminId, A.memberId, A.viewerId]) expect(await seesOutbox(id, [ev.payment, ev.spec, ev.lead]), id).toEqual([ev.payment, ev.spec, ev.lead].sort());
  });
});

describe("events 0099: a collaborator's writes are held to the same list", () => {
  it("a collaborator writes an event of their sections, with its outbox row, and reads it back", async () => {
    const row = await writeAs(collaborator, A.businessId, "task.started", { taskId: crypto.randomUUID() });
    expect(await sees(collaborator, [row.id])).toEqual([row.id]);
    expect(await seesOutbox(collaborator, [row.id])).toEqual([row.id]);
  });

  it("a collaborator cannot plant a payment event; the founders and members still write one", async () => {
    await expect(writeAs(collaborator, A.businessId, "payment.received", PAYMENT)).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(collaborator).execute(sql`insert into events (business_id, type, actor, payload) values (${A.businessId}::uuid, 'payment.received', '{"kind":"user","id":"x"}'::jsonb, '{}'::jsonb)`)).rejects.toThrow(RLS_DENIED);
    for (const id of [A.ownerId, cofounder, A.adminId, A.memberId]) expect((await writeAs(id, A.businessId, "payment.received", PAYMENT)).type, id).toBe("payment.received");
    await expect(writeAs(A.viewerId, A.businessId, "spec.version_published", { specId: crypto.randomUUID(), version: 3 })).rejects.toThrow(RLS_DENIED);
  });

  it("a collaborator cannot change or remove an event they cannot read, not even with a blind delete", async () => {
    const changed = await h.asUser(collaborator).run((tx) => tx.update(s.events).set({ narrated: true }).where(eq(s.events.id, ev.payment)).returning({ id: s.events.id }));
    expect(changed).toEqual([]);
    await h.asUser(collaborator).execute(sql`update events set narrated = true`);
    await h.asUser(collaborator).execute(sql`delete from outbox`);
    await h.asUser(collaborator).execute(sql`delete from events`);
    const left = await h.service().run((tx) => tx.select({ id: s.events.id, narrated: s.events.narrated }).from(s.events).where(inArray(s.events.id, [ev.payment, ev.bPayment, ev.bSpec])));
    expect(left.map((r) => [r.id, r.narrated]).sort()).toEqual([[ev.payment, false], [ev.bPayment, false], [ev.bSpec, false]].sort());
    const queued = await h.service().run((tx) => tx.select({ id: s.outbox.id }).from(s.outbox).where(eq(s.outbox.eventId, ev.payment)));
    expect(queued).toHaveLength(1);
    // A type a collaborator reads cannot be turned into one they cannot.
    const mine = await writeAs(collaborator, A.businessId, "task.started", { taskId: crypto.randomUUID() });
    await expect(h.asUser(collaborator).execute(sql`update events set type = 'payment.received' where id = ${mine.id}::uuid`)).rejects.toThrow(RLS_DENIED);
  });
});

describe("events 0099: the catalog", () => {
  it("the migrated database answers the list the latest migration spells", async () => {
    const definition = /create (?:or replace )?function fm_collaborator_event_types\(\) returns text\[\][^$]*?as \$\$\s*select array\[([^\]]*)\]::text\[\]\s*\$\$;/g;
    const latest = readMigrations().flatMap((m) => [...m.sql.matchAll(definition)].map((f) => [...f[1]!.matchAll(/'([^']*)'/g)].map((t) => t[1]!))).at(-1);
    const [{ types }] = await rows<{ types: string[] }>(sql`select fm_collaborator_event_types() as types`) as [{ types: string[] }];
    expect(types).toEqual(latest);
    expect(types).not.toContain("payment.received");
    expect(types).toContain("spec.version_published");
  });

  it("the list is immutable, reads nothing and is not security definer; anon cannot call it", async () => {
    const [fn] = await rows<{ prosecdef: boolean; provolatile: string; proconfig: string[] | null }>(sql`select prosecdef, provolatile::text, proconfig from pg_proc where proname = 'fm_collaborator_event_types' and pronamespace = 'public'::regnamespace`);
    expect(fn).toEqual({ prosecdef: false, provolatile: "i", proconfig: ["search_path=pg_catalog, public, pg_temp"] });
    const may = async (role: string) => (await rows<{ ok: boolean }>(sql`select has_function_privilege(${role}::name, 'fm_collaborator_event_types()', 'execute') as ok`))[0]?.ok;
    expect([await may("anon"), await may("authenticated"), await may("service_role")]).toEqual([false, true, true]);
  });

  it("events and outbox carry exactly the policies 0099 wrote", async () => {
    const policies = await rows<{ tablename: string; policyname: string; cmd: string }>(sql`select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('events', 'outbox') order by 1, 2`);
    expect(policies.map((p) => `${p.tablename}.${p.policyname}:${p.cmd}`)).toEqual([
      "events.events_delete:DELETE",
      "events.events_insert:INSERT",
      "events.events_select:SELECT",
      "events.events_update:UPDATE",
      "outbox.outbox_delete:DELETE",
      "outbox.outbox_insert:INSERT",
      "outbox.outbox_select:SELECT",
      "outbox.outbox_update:UPDATE",
    ]);
  });
});
