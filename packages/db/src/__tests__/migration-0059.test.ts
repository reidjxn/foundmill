/**
 * 0059 over data that already exists (audit FU-S-2): the connection requests and messages other founders sent were
 * written into the recipient's businesses as events and Inbox notes, readable by all of the business's staff. They leave
 * (notes, the Inbox events that announced them, the events themselves); every other event and note stays; and the events
 * table refuses these types from then on, whoever writes.
 */
import { PERSON_ADDRESSED_EVENT_TYPES } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

const TAG = "0059_private_network_events";
let h: TestHarness;
let A: BusinessFixture;
let ids: Record<"request" | "message" | "payment" | "requestNote" | "messageNote" | "ownNote" | "paymentNote" | "requestAnnounced" | "paymentAnnounced", string>;

const one = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows[0]!;
const count = async (table: "events" | "inbox_items", id: string) => (await one<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(table)} where id = ${id}::uuid`)).n;

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag < TAG) });
  A = await createBusinessFixture(h, "m56");
  const q = async (text: string, params: unknown[] = []) => (await h.pg.query<{ id: string }>(text, params)).rows[0]!.id;
  const event = (type: string, payload: object = {}) => q(`insert into events (business_id, type, payload) values ($1, $2, $3::jsonb) returning id`, [A.businessId, type, JSON.stringify(payload)]);
  const note = (subject: string, source: string[]) =>
    q(`insert into inbox_items (business_id, type, from_user_id, subject, body_md, source_event_ids) values ($1, 'human_message', $2, $3, 'Body', $4::uuid[]) returning id`, [A.businessId, A.memberId, subject, source]);
  const request = await event("connection.requested", { fromUserId: A.memberId, message: "Let's connect" });
  const message = await event("message.received", { preview: "Here is the term sheet" });
  const payment = await event("payment.received");
  // The relay publishes from the outbox: these rows would carry the words to the business stream.
  for (const eventId of [request, message]) await h.pg.query(`insert into outbox (business_id, event_id) values ($1, $2)`, [A.businessId, eventId]);
  // What 0027's delivery wrote: a human message per request or message, and the Inbox event that announced it.
  const requestNote = await note("Connection request from Ana", [request]);
  const messageNote = await note("Message from Ana", [message]);
  const requestAnnounced = await event("inbox.item_created", { inboxItemId: requestNote, subject: "Connection request from Ana", type: "human_message" });
  await event("inbox.item_created", { inboxItemId: messageNote, subject: "Message from Ana", type: "human_message" });
  // A business's own words, and a note made from a payment, stay.
  const ownNote = await note("Away until the 18th", []);
  const paymentNote = await q(`insert into inbox_items (business_id, type, subject, body_md, source_event_ids) values ($1, 'update', 'Payment in', 'Body', array[$2]::uuid[]) returning id`, [A.businessId, payment]);
  const paymentAnnounced = await event("inbox.item_created", { inboxItemId: paymentNote, subject: "Payment in", type: "update" });
  await h.pg.query(`insert into inbox_item_reads (business_id, inbox_item_id, user_id) values ($1, $2, $3)`, [A.businessId, requestNote, A.ownerId]);
  ids = { request, message, payment, requestNote, messageNote, ownNote, paymentNote, requestAnnounced, paymentAnnounced };
  await h.pg.exec(readMigrations().find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

describe("0059 applied over existing network deliveries", () => {
  it("the notes made from requests and messages are gone, with their read receipts and the events that announced them", async () => {
    expect(await count("inbox_items", ids.requestNote)).toBe(0);
    expect(await count("inbox_items", ids.messageNote)).toBe(0);
    expect((await one<{ n: number }>(sql`select count(*)::int as n from inbox_item_reads where inbox_item_id = ${ids.requestNote}::uuid`)).n).toBe(0);
    expect(await count("events", ids.requestAnnounced)).toBe(0);
    expect((await one<{ n: number }>(sql`select count(*)::int as n from events where type = 'inbox.item_created' and payload->>'subject' like '%Ana%'`)).n).toBe(0);
  });

  it("the requests and messages themselves are gone from the business's event log, outbox rows with them", async () => {
    expect(await count("events", ids.request)).toBe(0);
    expect(await count("events", ids.message)).toBe(0);
    expect((await one<{ n: number }>(sql`select count(*)::int as n from events where type in ('connection.requested', 'message.received')`)).n).toBe(0);
    expect((await one<{ n: number }>(sql`select count(*)::int as n from outbox where event_id in (${ids.request}::uuid, ${ids.message}::uuid)`)).n).toBe(0);
  });

  it("everything else stays: the business's own words, a payment, the note made from it and its Inbox event", async () => {
    expect(await count("inbox_items", ids.ownNote)).toBe(1);
    expect(await count("inbox_items", ids.paymentNote)).toBe(1);
    expect(await count("events", ids.payment)).toBe(1);
    expect(await count("events", ids.paymentAnnounced)).toBe(1);
  });

  it("the events table refuses these types from now on, from any writer", async () => {
    for (const type of PERSON_ADDRESSED_EVENT_TYPES) {
      await expect(h.pg.query(`insert into events (business_id, type, payload) values ($1, $2, '{}')`, [A.businessId, type])).rejects.toThrow(/events_not_person_addressed/);
    }
    // Another type is still fine, and the constraint names exactly the shared list.
    await h.pg.query(`insert into events (business_id, type, payload) values ($1, 'payment.received', '{}')`, [A.businessId]);
    const def = (await one<{ def: string }>(sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'events_not_person_addressed'`)).def;
    for (const type of PERSON_ADDRESSED_EVENT_TYPES) expect(def).toContain(`'${type}'`);
  });
});
