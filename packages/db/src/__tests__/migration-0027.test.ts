/**
 * 0027 over data that already exists: threads get their kind, a standing mute is remembered, and the requester-side
 * `connection.requested` events and the "Message from a contact" notes the composer wrote from them leave the Inbox.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./rls/fixtures";

const TAG = "0027_live_social_delivery";
let h: TestHarness;
let A: BusinessFixture;
let ids: { direct: string; group: string; community: string; requested: string; other: string; wrongNote: string; rightNote: string };

const one = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows[0]!;

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag !== TAG) });
  A = await createBusinessFixture(h, "m27");
  const [x, y] = [A.memberId, A.viewerId];
  const q = async (text: string, params: unknown[] = []) => (await h.pg.query<{ id: string }>(text, params)).rows[0]!.id;
  const direct = await q(`insert into message_threads (participant_ids) values (array[$1, $2]::uuid[]) returning id`, [A.ownerId, x]);
  const group = await q(`insert into message_threads (participant_ids) values (array[$1, $2, $3]::uuid[]) returning id`, [A.ownerId, x, y]);
  const community = await q(`insert into communities (name, slug) values ('Old room', 'old-room-27') returning id`);
  await h.pg.query(`insert into community_members (community_id, user_id, status) values ($1, $2, 'muted'), ($1, $3, 'active')`, [community, x, y]);
  // Before the fix, a request was filed in the requester's business and narrated back to them as an incoming message.
  const requested = await q(`insert into events (business_id, type, payload) values ($1, 'connection.requested', '{}') returning id`, [A.businessId]);
  const other = await q(`insert into events (business_id, type, payload) values ($1, 'payment.received', '{}') returning id`, [A.businessId]);
  const note = (subject: string, source: string) =>
    q(`insert into inbox_items (business_id, type, subject, body_md, source_event_ids) values ($1, 'human_message', $2, 'Body', array[$3]::uuid[]) returning id`, [A.businessId, subject, source]);
  const wrongNote = await note("Message from a contact", requested);
  const rightNote = await note("A real message", other);
  ids = { direct, group, community, requested, other, wrongNote, rightNote };
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

describe("0027 applied over existing LIVE data", () => {
  it("threads of three or more people become groups; pairs stay direct", async () => {
    expect(await one<{ kind: string }>(sql`select kind from message_threads where id = ${ids.direct}::uuid`)).toEqual({ kind: "direct" });
    expect(await one<{ kind: string }>(sql`select kind from message_threads where id = ${ids.group}::uuid`)).toEqual({ kind: "group" });
  });

  it("a member muted before the change stays muted after leaving and coming back (muted_at is recorded)", async () => {
    const muted = await one<{ muted: boolean }>(sql`select muted_at is not null as muted from community_members where community_id = ${ids.community}::uuid and user_id = ${A.memberId}::uuid`);
    const active = await one<{ muted: boolean }>(sql`select muted_at is not null as muted from community_members where community_id = ${ids.community}::uuid and user_id = ${A.viewerId}::uuid`);
    expect([muted.muted, active.muted]).toEqual([true, false]);
  });

  it("requester-side connection.requested events are never narrated, and the notes made from them are archived", async () => {
    expect(await one<{ narrated: boolean }>(sql`select narrated from events where id = ${ids.requested}::uuid`)).toEqual({ narrated: true });
    expect(await one<{ narrated: boolean }>(sql`select narrated from events where id = ${ids.other}::uuid`)).toEqual({ narrated: false });
    expect(await one<{ state: string }>(sql`select state from inbox_items where id = ${ids.wrongNote}::uuid`)).toEqual({ state: "archived" });
    expect(await one<{ state: string }>(sql`select state from inbox_items where id = ${ids.rightNote}::uuid`)).toEqual({ state: "unread" });
  });
});
