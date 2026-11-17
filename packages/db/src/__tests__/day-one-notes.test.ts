/**
 * The unanswered day-one notes of quiet projects (WP-04 T16 step 2): which ones the script lists, and that applying it
 * archives them (never deletes), once, with one audit row; a project someone visited, a sample, a person's message, an
 * answered note and a used-up credits warning are left alone.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../repos";
import { createTestDb, type TestHarness } from "../testing/pglite";

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const COMMITTED = "2026-10-10T10:00:00Z";
let h: TestHarness;
let quiet = "";
let visited = "";
let sample = "";
const ids: Record<string, string> = {};

async function project(name: string, demo = false): Promise<string> {
  const b = await repos.businesses.create(h.db, { name, businessMode: "assisted" });
  await h.db.execute(sql`update businesses set committed_at = ${COMMITTED}::timestamptz, is_demo = ${demo} where id = ${b.id}`);
  return b.id;
}
async function note(businessId: string, key: string, type: string, subject: string, at: string, state = "unread"): Promise<void> {
  const r = await h.db.execute(sql`insert into inbox_items (business_id, type, subject, state, created_at) values (${businessId}, ${type}, ${subject}, ${state}, ${at}::timestamptz) returning id`);
  ids[key] = (r.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  h = await createTestDb();
  quiet = await project("Doorstep Bikes");
  visited = await project("Tutorlane");
  sample = await project("Sample Co", true);
  for (const b of [quiet, visited, sample]) await note(b, `update-${b}`, "update", "Research started", "2026-10-10T11:00:00Z");
  await note(quiet, "decision", "decision", "Approve the plan", "2026-10-10T12:00:00Z", "read");
  await note(quiet, "answered", "decision", "Pick a name", "2026-10-10T12:30:00Z", "answered");
  await note(quiet, "message", "human_message", "From Ana", "2026-10-10T13:00:00Z");
  await note(quiet, "credits", "warning", "Credits used up: team paused", "2026-10-10T14:00:00Z");
  await note(quiet, "later", "update", "Day three", "2026-10-13T10:00:00Z");
  const owner = await h.createUser("visitor@example.com");
  await repos.presence.ping(h.db, visited, owner, { now: new Date(NOW.getTime() - 3 * DAY) });
}, 120_000);
afterAll(() => h?.close());

describe("the day-one notes of quiet projects", () => {
  it("lists only the open day-one notes of a project nobody visited for 14 days", async () => {
    const list = await repos.dayOneNotes.toClear(h.db, { now: NOW, quietFor: 14 * DAY, olderThan: 14 * DAY });
    expect(list.map((p) => p.businessId)).toEqual([quiet]);
    expect(list[0]!.ids.sort()).toEqual([ids[`update-${quiet}`], ids.decision].sort());
    expect(list[0]!.oldest.toISOString()).toBe("2026-10-10T11:00:00.000Z");
    expect(list.flatMap((p) => p.ids)).not.toContain(ids[`update-${visited}`]);
    expect(list.flatMap((p) => p.ids)).not.toContain(ids[`update-${sample}`]);
  });

  it("archives them once, never deletes, and leaves one audit row", async () => {
    const [p] = await repos.dayOneNotes.toClear(h.db, { now: NOW, quietFor: 14 * DAY, olderThan: 14 * DAY });
    expect(await repos.dayOneNotes.archive(h.db, quiet, p!.ids)).toBe(2);
    expect(await repos.dayOneNotes.archive(h.db, quiet, p!.ids)).toBe(0);
    const states = await h.db.execute(sql`select id, state from inbox_items where business_id = ${quiet}`);
    const byId = Object.fromEntries((states.rows as { id: string; state: string }[]).map((r) => [r.id, r.state]));
    expect(Object.keys(byId)).toHaveLength(6);
    expect([byId[ids[`update-${quiet}`]!], byId[ids.decision!]]).toEqual(["archived", "archived"]);
    expect([byId[ids.answered!], byId[ids.message!], byId[ids.credits!], byId[ids.later!]]).toEqual(["answered", "unread", "unread", "unread"]);
    const audit = await h.db.execute(sql`select action, details from audit_log where business_id = ${quiet} and action = 'inbox.day_one_notes_archived'`);
    expect(audit.rows).toEqual([{ action: "inbox.day_one_notes_archived", details: { count: 2, reason: "quiet project, WP-04 T16" } }]);
    expect(await repos.dayOneNotes.toClear(h.db, { now: NOW, quietFor: 14 * DAY, olderThan: 14 * DAY })).toEqual([]);
  });
});
