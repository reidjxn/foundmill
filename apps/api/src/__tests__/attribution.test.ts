/**
 * Who or what brought a new person (services/attribution.ts; migration 0088; docs/NETWORK.md §5, §11):
 * `founder.profile.update` takes `via` on the save that creates the profile and records it once.
 *
 * Recorded for a public project page (the business and its longest-standing owner) and for a public person profile
 * (that person); ignored, silently, when the value is not a reference, names nothing public (unknown, a draft, a
 * private profile, a sample business), names the person themselves, or arrives a second time; the answer is the same
 * in every case; the value is never logged.
 *
 * With each row, in its transaction, two account events (docs/ARCHITECTURE.md §5 "Account events"): `signup.attributed`
 * in the new person's own store and `referral.arrived` in the credited person's, each `{ sourceKind, sourceRef }` and
 * nothing else. Nothing goes to a business's `events` or `outbox`; the credited person's row says nothing about who
 * signed up; nobody but its own person reads either row; nothing is written when no row is; and a row whose events
 * cannot be written is kept without them.
 */
import { repos, type Db } from "@foundmill/db";
import { EVENTS, writeAccountEvents } from "@foundmill/events";
import { VIA_MAX_LENGTH } from "@foundmill/shared/via";
import { ACCOUNT_EVENT_TYPES, type PersonProfileContent, type ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATTRIBUTION_ACTOR, attributionEventKeys, attributionEvents, recordSignupAttribution } from "../services/attribution";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
/** A person with a public profile at /u/sam-lee. */
let sam: string;

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Bread by bike", about: "Fresh bread delivered.", forWhom: "", stage: "building", showFounders: false, followForm: false, ...over });
const person = (over: Partial<PersonProfileContent> = {}): PersonProfileContent => ({ headline: "Baker", about: "I bake bread.", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "", ...over });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await hz.db.execute(q)) as unknown as { rows: T[] }).rows;
const eventCounts = async () => (await rows<{ events: number; outbox: number }>(sql`select (select count(*)::int from events) as events, (select count(*)::int from outbox) as outbox`))[0]!;
// Every new account also gets the funnel's facts (WP-02 T9); the counts here are of everything else.
const FUNNEL = sql`('account.admitted', 'profile.created', 'idea.kept', 'idea.drafted')`;
const accountCounts = async () => (await rows<{ events: number; queued: number }>(sql`select (select count(*)::int from account_events where type not in ${FUNNEL}) as events, (select count(*)::int from account_outbox o join account_events e on e.id = o.event_id where e.type not in ${FUNNEL}) as queued`))[0]!;
interface StoredEvent {
  id: string;
  user_id: string;
  type: string;
  actor: unknown;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
  idempotency_key: string | null;
  queued: number;
}
/** Every column of a person's account events, as the services see them, with the number of queue rows of each. */
const accountEvents = (userId: string) =>
  rows<StoredEvent>(sql`
    select e.id, e.user_id, e.type, e.actor, e.payload, e.occurred_at, e.idempotency_key, (select count(*)::int from account_outbox o where o.event_id = e.id and o.user_id = e.user_id) as queued
      from account_events e where e.user_id = ${userId}::uuid and e.type not in ${FUNNEL} order by e.created_at, e.id`);
/** The two attribution types of a person (the fixtures' owners also publish nothing here, so these are all their rows). */
const attributionEventsOf = async (userId: string) => (await accountEvents(userId)).filter((e) => e.type === "signup.attributed" || e.type === "referral.arrived");
/** The columns a person may read of their own events (the grant of the migration). */
const readable = sql`select id, user_id, type, occurred_at, payload, created_at from account_events`;
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");

let n = 0;
/** A signed-in account with no profile yet. */
async function newcomer() {
  n += 1;
  const userId = await hz.h.createUser(`attribution-${n}@test.local`);
  return { userId, me: hz.caller({ userId, email: `attribution-${n}@test.local` }) };
}
const answer = { displayName: "Newcomer", experience: "first_time", skills: { marketing: 8 }, targetMarkets: ["US"], riskAppetite: "medium" };
/** The mutation's answer without what differs per account. */
const comparable = (result: Record<string, unknown>) => Object.fromEntries(Object.entries(result).filter(([key]) => !["id", "userId", "createdAt", "updatedAt"].includes(key)));

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "attribution" });
  await hz.db.execute(sql`update businesses set committed_at = '2026-10-01T00:00:00Z'::timestamptz where id in (${hz.A.businessId}, ${hz.B.businessId})`);
  await repos.pages.publish(hz.db, hz.A.businessId, { content: page(), slug: "bread-by-bike", userId: hz.A.ownerId });
  // B's page is a draft only.
  await repos.pages.saveDraft(hz.db, hz.B.businessId, { draft: page(), slug: "still-a-draft", userId: hz.B.ownerId });
  sam = await hz.h.createUser("attribution-sam@test.local");
  // A public profile is public once its person confirmed 18 or older (0100).
  await repos.adults.confirm(hz.db, sam);
  await repos.founders.upsert(hz.db, sam, { displayName: "Sam Lee" });
  await repos.personProfiles.save(hz.db, sam, { handle: "sam-lee", content: person() });
  await repos.personProfiles.publish(hz.db, sam);
}, 120_000);
afterAll(() => hz?.close());

describe("founder.profile.update records who or what brought a new person", () => {
  it("a project's public page: the business and its longest-standing owner", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ userId: p.userId, sourceKind: "project_page", sourceRef: "bread-by-bike", sourceBusinessId: hz.A.businessId, referrerUserId: hz.A.ownerId });
  });

  it("a person's public profile: that person, and no business", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.sam-lee" });
    expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ sourceKind: "person_profile", sourceRef: "sam-lee", sourceBusinessId: null, referrerUserId: sam });
  });

  it("no reference, nothing recorded", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ ...answer, confirmAdult: true });
    expect(await repos.attributions.forUser(hz.db, p.userId)).toBeNull();
  });

  it("a value that is not a reference is ignored without an error", async () => {
    for (const via of ["", "bread-by-bike", "x.bread-by-bike", "p.", "p.Bread-By-Bike", "p.bread by bike", "p.-bread", "u.sam_lee", "p.bread-by-bike?x=1", "p.x'; drop table attributions; --"]) {
      const p = await newcomer();
      await p.me.founder.profile.update({ confirmAdult: true, ...answer, via });
      expect(await repos.attributions.forUser(hz.db, p.userId), via).toBeNull();
    }
  });

  it("a reference that names nothing public is ignored: unknown, a draft page, a private profile, the wrong kind", async () => {
    const priv = await hz.h.createUser("attribution-private@test.local");
    await repos.founders.upsert(hz.db, priv, { displayName: "Pat Private" });
    await repos.personProfiles.save(hz.db, priv, { handle: "pat-private", content: person() });
    for (const via of ["p.no-such-page", "u.no-such-person", "p.still-a-draft", "u.pat-private", "u.bread-by-bike", "p.sam-lee"]) {
      const p = await newcomer();
      await p.me.founder.profile.update({ confirmAdult: true, ...answer, via });
      expect(await repos.attributions.forUser(hz.db, p.userId), via).toBeNull();
    }
  });

  it("a sample business never resolves, even with a published page", async () => {
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${hz.A.businessId}`);
    try {
      const p = await newcomer();
      await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
      expect(await repos.attributions.forUser(hz.db, p.userId)).toBeNull();
    } finally {
      await hz.db.execute(sql`update businesses set is_demo = false where id = ${hz.A.businessId}`);
    }
  });

  it("nobody brings themselves: the page's own longest-standing owner records nothing", async () => {
    // The fixture's owner has a business and a published page, and no profile yet.
    const owner = hz.caller({ userId: hz.A.ownerId, email: "attribution-a-owner@test.local" });
    const before = await accountCounts();
    await owner.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, hz.A.ownerId)).toBeNull();
    // And no account event: not for the owner as a new person, not for the owner as the person credited.
    expect(await accountCounts()).toEqual(before);
    // Another member of the same project was brought by it, and its first owner is credited.
    const member = hz.caller({ userId: hz.A.memberId, email: "attribution-a-member@test.local" });
    await member.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, hz.A.memberId)).toMatchObject({ sourceBusinessId: hz.A.businessId, referrerUserId: hz.A.ownerId });
  });

  it("only once: a later save ignores a reference, and an account that already has one keeps it", async () => {
    // Created with no reference: a later save that carries one records nothing (the profile already exists).
    const late = await newcomer();
    await late.me.founder.profile.update({ ...answer, confirmAdult: true });
    await late.me.founder.profile.update({ confirmAdult: true, displayName: "Later", via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, late.userId)).toBeNull();

    // Created through the page: a later save naming a person changes nothing.
    const first = await newcomer();
    await first.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    const recorded = await repos.attributions.forUser(hz.db, first.userId);
    const edited = await first.me.founder.profile.update({ confirmAdult: true, displayName: "Renamed", via: "u.sam-lee" });
    expect(edited).toMatchObject({ displayName: "Renamed" });
    expect(edited).not.toHaveProperty("via");
    expect(await repos.attributions.forUser(hz.db, first.userId)).toEqual(recorded);

    // An account that somehow has an attribution before its profile keeps the first.
    const early = await newcomer();
    await repos.attributions.record(hz.db, early.userId, { kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: sam });
    await early.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, early.userId)).toMatchObject({ sourceKind: "person_profile", sourceRef: "sam-lee" });
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from attributions where user_id = ${early.userId}`))[0]!.n).toBe(1);
  });

  it("the answer is the same whether a reference was given, was one, resolved, or was recorded", async () => {
    const answers: Record<string, unknown>[] = [];
    for (const via of [undefined, "", "not a reference", "p.no-such-page", "u.no-such-person", "p.still-a-draft", "p.bread-by-bike", "u.sam-lee"]) {
      const p = await newcomer();
      answers.push(comparable(await p.me.founder.profile.update({ confirmAdult: true, ...answer, ...(via === undefined ? {} : { via }) })));
    }
    for (const other of answers.slice(1)) expect(other).toEqual(answers[0]);
    expect(answers[0]).toMatchObject({ displayName: "Newcomer", guidanceTurnedOff: false });
    expect(JSON.stringify(answers)).not.toMatch(/via|bread-by-bike|sam-lee|attribut/);
  });

  it("the input is bounded: a value longer than any reference is refused before anything is read", async () => {
    const p = await newcomer();
    expect(await code(p.me.founder.profile.update({ confirmAdult: true, ...answer, via: `p.${"a".repeat(VIA_MAX_LENGTH)}` }))).toBe("BAD_REQUEST");
    // The longest reference there can be is accepted (and names nothing here).
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: `p.${"a".repeat(VIA_MAX_LENGTH - 2)}` });
    expect(await repos.attributions.forUser(hz.db, p.userId)).toBeNull();
  });

  it("signed out is refused", async () => {
    expect(await code(hz.caller(null).founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" }))).toBe("UNAUTHORIZED");
  });
});

const capture = () => {
  const lines: string[] = [];
  return { lines, log: pino({ level: "debug" }, { write: (line: string) => void lines.push(line) }) };
};

describe("signup.attributed and referral.arrived", () => {
  const FACT_KEYS = ["sourceKind", "sourceRef"];
  /** The new person's row and the credited person's row of one attribution, found by the keys built from its id. */
  async function eventsOf(newPerson: string, credited: string) {
    const row = (await repos.attributions.forUser(hz.db, newPerson))!;
    const keys = attributionEventKeys(row.id);
    const mine = (await accountEvents(newPerson)).filter((e) => e.idempotency_key === keys.signup);
    const theirs = (await accountEvents(credited)).filter((e) => e.idempotency_key === keys.referral);
    return { row, keys, mine, theirs };
  }

  it("are declared as account events, each a public address and nothing else", () => {
    for (const type of ["signup.attributed", "referral.arrived"] as const) {
      expect(ACCOUNT_EVENT_TYPES as readonly string[]).toContain(type);
      expect(EVENTS[type]).toMatchObject({ scope: "account", narratable: false, recordIds: [] });
      expect(EVENTS[type].schema.safeParse({ sourceKind: "project_page", sourceRef: "bread-by-bike" }).success).toBe(true);
      // What the business-scoped declaration carried is refused: both accounts and the project.
      for (const extra of [{ userId: sam }, { referrerUserId: sam }, { sourceBusinessId: hz.A.businessId }]) expect(EVENTS[type].schema.safeParse({ sourceKind: "project_page", sourceRef: "bread-by-bike", ...extra }).success).toBe(false);
    }
  });

  it("a project's page: one row for the new person and one for the page's longest-standing owner, written with the attribution", async () => {
    const business = await eventCounts();
    const account = await accountCounts();
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    const { row, keys, mine, theirs } = await eventsOf(p.userId, hz.A.ownerId);
    expect(row).toMatchObject({ sourceKind: "project_page", sourceRef: "bread-by-bike", sourceBusinessId: hz.A.businessId, referrerUserId: hz.A.ownerId });

    // The new person's own store holds exactly this one row: "you arrived through this public page".
    expect(await accountEvents(p.userId)).toHaveLength(1);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ user_id: p.userId, type: "signup.attributed", actor: ATTRIBUTION_ACTOR, payload: { sourceKind: "project_page", sourceRef: "bread-by-bike" }, idempotency_key: keys.signup, queued: 1 });
    expect(Object.keys(mine[0]!.payload).sort()).toEqual(FACT_KEYS);
    // The credited person's: "someone signed up through your page".
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ user_id: hz.A.ownerId, type: "referral.arrived", actor: ATTRIBUTION_ACTOR, payload: { sourceKind: "project_page", sourceRef: "bread-by-bike" }, idempotency_key: keys.referral, queued: 1 });
    expect(Object.keys(theirs[0]!.payload).sort()).toEqual(FACT_KEYS);
    // Two rows and two queue rows for one sign-up, and nothing for anyone else.
    expect(await accountCounts()).toEqual({ events: account.events + 2, queued: account.queued + 2 });
    // Both at the attribution's own time, and two events of their own.
    expect(new Date(mine[0]!.occurred_at).toISOString()).toBe(row.createdAt.toISOString());
    expect(new Date(theirs[0]!.occurred_at).toISOString()).toBe(row.createdAt.toISOString());
    expect(mine[0]!.id).not.toBe(theirs[0]!.id);
    // The page's other people (an admin, a member, a viewer) are credited with nothing.
    for (const other of [hz.A.adminId, hz.A.viewerId]) expect((await accountEvents(other)).filter((e) => e.type === "referral.arrived"), other).toEqual([]);
    // Nothing was written to a business.
    expect(await eventCounts()).toEqual(business);
  });

  it("a person's profile: one row for the new person and one for that person", async () => {
    const account = await accountCounts();
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.sam-lee" });
    const { row, keys, mine, theirs } = await eventsOf(p.userId, sam);
    expect(row).toMatchObject({ sourceKind: "person_profile", sourceRef: "sam-lee", sourceBusinessId: null, referrerUserId: sam });
    expect(await accountEvents(p.userId)).toHaveLength(1);
    expect(mine.map((e) => [e.user_id, e.type, e.actor, e.payload, e.idempotency_key, e.queued])).toEqual([[p.userId, "signup.attributed", ATTRIBUTION_ACTOR, { sourceKind: "person_profile", sourceRef: "sam-lee" }, keys.signup, 1]]);
    expect(theirs.map((e) => [e.user_id, e.type, e.actor, e.payload, e.idempotency_key, e.queued])).toEqual([[sam, "referral.arrived", ATTRIBUTION_ACTOR, { sourceKind: "person_profile", sourceRef: "sam-lee" }, keys.referral, 1]]);
    expect(await accountCounts()).toEqual({ events: account.events + 2, queued: account.queued + 2 });
  });

  it("nothing reaches a business's `events` or `outbox`, for a page or for a person, and no writer can put either type there", async () => {
    const before = await eventCounts();
    const viaPage = await newcomer();
    await viaPage.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    const viaPerson = await newcomer();
    await viaPerson.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.sam-lee" });
    expect(await attributionEventsOf(viaPage.userId)).toHaveLength(1);
    expect(await attributionEventsOf(viaPerson.userId)).toHaveLength(1);
    expect(await eventCounts()).toEqual(before);
    expect(await rows(sql`select 1 from events where type in ('signup.attributed', 'referral.arrived')`)).toEqual([]);
    expect(await rows(sql`select 1 from outbox o join events e on e.id = o.event_id where e.type in ('signup.attributed', 'referral.arrived')`)).toEqual([]);
    // Nothing about either new person sits in the source project's events, which its members read.
    for (const userId of [viaPage.userId, viaPerson.userId]) {
      expect(await rows(sql`select 1 from events where business_id = ${hz.A.businessId} and (payload::text like ${`%${userId}%`} or actor::text like ${`%${userId}%`})`)).toEqual([]);
    }
    expect(await rows(sql`select 1 from audit_log where action like 'signup.%' or action like 'referral.%' or action like '%attribut%'`)).toEqual([]);
    // The business writers refuse both types, and so does the table for a member's own insert.
    for (const type of ["signup.attributed", "referral.arrived"] as const) {
      await expect(repos.events.write(hz.db, hz.A.businessId, { type, actor: { kind: "user", id: hz.A.ownerId }, payload: { sourceKind: "project_page", sourceRef: "bread-by-bike" } })).rejects.toThrow(/account-scoped/);
      await expect(
        hz.h.asUser(hz.A.memberId).execute(sql`insert into events (business_id, type, actor, payload) values (${hz.A.businessId}::uuid, ${type}, ${JSON.stringify({ kind: "user", id: hz.A.memberId })}::jsonb, '{"sourceKind":"project_page","sourceRef":"forged"}'::jsonb)`),
      ).rejects.toThrow(/events_not_account_scoped/);
    }
    expect(await eventCounts()).toEqual(before);
  });

  it("the credited person's row says nothing about who signed up: no id in any spelling, no name, no address, no time of its own", async () => {
    const p = await newcomer();
    const email = `attribution-${n}@test.local`;
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, displayName: "Zed Quillfeather", via: "u.sam-lee" });
    const { row, keys, mine, theirs } = await eventsOf(p.userId, sam);
    expect(theirs).toHaveLength(1);
    // Every column of the row and of its queue row, the ones the person cannot read included.
    const [stored] = await rows<{ event: string; queue: string }>(sql`
      select to_jsonb(e)::text as event, (select to_jsonb(o)::text from account_outbox o where o.event_id = e.id) as queue from account_events e where e.id = ${theirs[0]!.id}::uuid`);
    const text = `${stored!.event}\n${stored!.queue}`.toLowerCase();
    const compact = p.userId.replace(/-/g, "");
    for (const said of [p.userId, compact, compact.slice(0, 16), email, `attribution-${n}`, "zed", "quillfeather", "newcomer"]) expect(text, said).not.toContain(said.toLowerCase());
    // Exactly the two public fields, by the system, under a key built from the attribution's id and not from an account's.
    expect(Object.keys(theirs[0]!.payload).sort()).toEqual(FACT_KEYS);
    expect(theirs[0]!.payload).toEqual({ sourceKind: "person_profile", sourceRef: "sam-lee" });
    expect(theirs[0]!.actor).toEqual({ kind: "system", id: "attribution" });
    expect(theirs[0]!.idempotency_key).toBe(`attribution:${row.id}:referral`);
    expect(keys.referral).not.toContain(p.userId);
    expect(row.id).not.toBe(p.userId);
    // No time finer than the event's own, which is the attribution's; and not the new person's event under another owner.
    expect(new Date(theirs[0]!.occurred_at).toISOString()).toBe(row.createdAt.toISOString());
    expect(JSON.stringify(theirs[0]!.payload)).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{10,}/);
    expect(theirs[0]!.id).not.toBe(mine[0]!.id);
    // What the credited person reads of it themselves: the six granted columns, and the same nothing.
    const seen = await hz.h.asUser(sam).execute<Record<string, unknown>>(sql`${readable} where id = ${theirs[0]!.id}::uuid`);
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]!).sort()).toEqual(["created_at", "id", "occurred_at", "payload", "type", "user_id"]);
    expect(seen[0]).toMatchObject({ user_id: sam, type: "referral.arrived", payload: { sourceKind: "person_profile", sourceRef: "sam-lee" } });
    expect(JSON.stringify(seen).toLowerCase()).not.toContain(compact.slice(0, 16));
    expect(JSON.stringify(seen)).not.toContain(p.userId);
  });

  it("the new person's row names the address they opened, never the project by id or the person credited", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    const { mine } = await eventsOf(p.userId, hz.A.ownerId);
    const [stored] = await rows<{ event: string; queue: string }>(sql`
      select to_jsonb(e)::text as event, (select to_jsonb(o)::text from account_outbox o where o.event_id = e.id) as queue from account_events e where e.id = ${mine[0]!.id}::uuid`);
    const text = `${stored!.event}\n${stored!.queue}`.toLowerCase();
    // The page does not name its founders (`showFounders: false`): who is credited is not the new person's to learn.
    for (const said of [hz.A.ownerId, hz.A.ownerId.replace(/-/g, ""), hz.A.businessId, hz.A.businessId.replace(/-/g, "")]) expect(text, said).not.toContain(said);
    expect(mine[0]!.payload).toEqual({ sourceKind: "project_page", sourceRef: "bread-by-bike" });
  });

  it("nobody but its own person reads either row: not the other of the two, not the project's people, not a stranger, not a visitor", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    const stranger = await newcomer();
    const { mine, theirs } = await eventsOf(p.userId, hz.A.ownerId);
    const mineId = mine[0]!.id;
    const theirsId = theirs[0]!.id;

    // Each reads their own row.
    expect((await hz.h.asUser(p.userId).execute<{ id: string; type: string; payload: unknown }>(readable)).filter((r) => r.type === "signup.attributed").map((r) => [r.id, r.type, r.payload])).toEqual([[mineId, "signup.attributed", { sourceKind: "project_page", sourceRef: "bread-by-bike" }]]);
    const ownerSees = await hz.h.asUser(hz.A.ownerId).execute<{ id: string; user_id: string; type: string }>(readable);
    expect(ownerSees.map((r) => r.id)).toContain(theirsId);
    expect(ownerSees.every((r) => r.user_id === hz.A.ownerId)).toBe(true);
    // Neither reads the other's: the credited person cannot look up who arrived, the new person cannot look up who is credited.
    expect(ownerSees.map((r) => r.id)).not.toContain(mineId);
    expect(await hz.h.asUser(hz.A.ownerId).execute(sql`select id from account_events where id = ${mineId}::uuid or user_id = ${p.userId}::uuid`)).toEqual([]);
    expect(await hz.h.asUser(p.userId).execute(sql`select id from account_events where id = ${theirsId}::uuid or user_id = ${hz.A.ownerId}::uuid`)).toEqual([]);
    expect((await hz.h.asUser(hz.A.ownerId).run((tx) => repos.accountEvents.list(tx, p.userId))).items).toEqual([]);
    expect((await hz.h.asUser(p.userId).run((tx) => repos.accountEvents.list(tx, hz.A.ownerId))).items).toEqual([]);

    // Nobody else reads either: the project's other people, another project's owner, another credited person, a stranger.
    for (const other of [hz.A.adminId, hz.A.memberId, hz.A.viewerId, hz.B.ownerId, sam, stranger.userId]) {
      expect(await hz.h.asUser(other).execute(sql`select id from account_events where id in (${mineId}::uuid, ${theirsId}::uuid)`), other).toEqual([]);
      expect(await hz.h.asUser(other).execute(sql`select id from account_events where user_id in (${p.userId}::uuid, ${hz.A.ownerId}::uuid)`), other).toEqual([]);
      expect((await hz.h.asUser(other).run((tx) => repos.accountEvents.list(tx, p.userId))).items, other).toEqual([]);
      expect((await hz.h.asUser(other).run((tx) => repos.accountEvents.get(tx, hz.A.ownerId, theirsId))), other).toBeNull();
      await expect(hz.h.asUser(other).execute(sql`select * from account_events`), other).rejects.toThrow(/permission denied/);
      await expect(hz.h.asUser(other).execute(sql`select id from account_outbox`), other).rejects.toThrow(/permission denied/);
      await expect(hz.h.asUser(other).execute(sql`select id from attributions`), other).rejects.toThrow(/permission denied/);
    }
    // The two people themselves read no hidden column, no queue and no attribution row either.
    for (const one of [p.userId, hz.A.ownerId]) {
      await expect(hz.h.asUser(one).execute(sql`select idempotency_key from account_events`), one).rejects.toThrow(/permission denied/);
      await expect(hz.h.asUser(one).execute(sql`select actor from account_events`), one).rejects.toThrow(/permission denied/);
      await expect(hz.h.asUser(one).execute(sql`select id from attributions`), one).rejects.toThrow(/permission denied/);
    }
    await expect(hz.h.anon().execute(readable)).rejects.toThrow(/permission denied/);
    await expect(hz.h.anon().execute(sql`select id from account_events where id = ${theirsId}::uuid`)).rejects.toThrow(/permission denied/);
  });

  it("writes nothing when no attribution is recorded: no reference, not a reference, nothing public, the person themselves", async () => {
    const before = await accountCounts();
    for (const via of [undefined, "", "not a reference", "p.no-such-page", "u.no-such-person", "p.still-a-draft", "u.bread-by-bike", "p.sam-lee"]) {
      const p = await newcomer();
      await p.me.founder.profile.update({ confirmAdult: true, ...answer, ...(via === undefined ? {} : { via }) });
      expect(await repos.attributions.forUser(hz.db, p.userId), String(via)).toBeNull();
      expect(await accountEvents(p.userId), String(via)).toEqual([]);
    }
    // Nobody brings themselves: the profile's own person, and the page's own longest-standing owner.
    const { lines, log } = capture();
    await recordSignupAttribution({ db: hz.db, log }, sam, "u.sam-lee");
    await recordSignupAttribution({ db: hz.db, log }, hz.A.ownerId, "p.bread-by-bike");
    expect(await repos.attributions.forUser(hz.db, sam)).toBeNull();
    expect(await repos.attributions.forUser(hz.db, hz.A.ownerId)).toBeNull();
    expect((await accountEvents(sam)).filter((e) => e.type === "signup.attributed")).toEqual([]);
    expect((await accountEvents(hz.A.ownerId)).filter((e) => e.type === "signup.attributed")).toEqual([]);
    expect(lines).toEqual([]);
    expect(await accountCounts()).toEqual(before);
  });

  it("writes nothing a second time: a later save, a second reference, a repeat, and an account that already has its row", async () => {
    // Created with no reference: a later save that carries one writes nothing.
    const late = await newcomer();
    await late.me.founder.profile.update({ ...answer, confirmAdult: true });
    const before = await accountCounts();
    await late.me.founder.profile.update({ confirmAdult: true, displayName: "Later", via: "p.bread-by-bike" });
    expect(await accountEvents(late.userId)).toEqual([]);
    expect(await accountCounts()).toEqual(before);

    // Created through the page: two rows, once. A later save naming a person, and the service called again, add none.
    const first = await newcomer();
    await first.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    const after = await accountCounts();
    expect(after).toEqual({ events: before.events + 2, queued: before.queued + 2 });
    const samBefore = (await accountEvents(sam)).length;
    await first.me.founder.profile.update({ confirmAdult: true, displayName: "Renamed", via: "u.sam-lee" });
    const { lines, log } = capture();
    await recordSignupAttribution({ db: hz.db, log }, first.userId, "u.sam-lee");
    await recordSignupAttribution({ db: hz.db, log }, first.userId, "p.bread-by-bike");
    expect(lines).toEqual([]);
    expect(await accountCounts()).toEqual(after);
    expect((await accountEvents(first.userId)).map((e) => [e.type, e.payload])).toEqual([["signup.attributed", { sourceKind: "project_page", sourceRef: "bread-by-bike" }]]);
    expect((await accountEvents(sam)).length).toBe(samBefore);

    // An account whose row is already there: the first stays and no event is written for the later reference.
    const early = await newcomer();
    await repos.attributions.record(hz.db, early.userId, { kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: sam });
    await early.me.founder.profile.update({ confirmAdult: true, ...answer, via: "p.bread-by-bike" });
    expect(await accountEvents(early.userId)).toEqual([]);
    expect(await accountCounts()).toEqual(after);

    // Two saves at once for one account write one row and its two events between them.
    const twice = await newcomer();
    await Promise.all([recordSignupAttribution({ db: hz.db, log }, twice.userId, "u.sam-lee"), recordSignupAttribution({ db: hz.db, log }, twice.userId, "u.sam-lee")]);
    expect(await accountEvents(twice.userId)).toHaveLength(1);
    expect(await accountCounts()).toEqual({ events: after.events + 2, queued: after.queued + 2 });
  });

  it("attributionEvents: the row's own id makes the keys, the row's own time is the events', and nobody credited means one row", () => {
    const row = { id: "7b0c5e0e-0000-4000-8000-0000000000a1", userId: "7b0c5e0e-0000-4000-8000-0000000000b2", sourceKind: "project_page" as const, sourceRef: "bread-by-bike", createdAt: new Date("2026-11-12T09:00:00.000Z") };
    const referrerUserId = "7b0c5e0e-0000-4000-8000-0000000000c3";
    const facts = { sourceKind: "project_page", sourceRef: "bread-by-bike" };
    // A page with no owner to name: the new person's row alone.
    expect(attributionEvents({ ...row, referrerUserId: null })).toEqual([{ userId: row.userId, type: "signup.attributed", actor: ATTRIBUTION_ACTOR, payload: facts, occurredAt: row.createdAt, idempotencyKey: `attribution:${row.id}:signup` }]);
    const [signup, referral] = attributionEvents({ ...row, referrerUserId });
    expect(referral).toEqual({ userId: referrerUserId, type: "referral.arrived", actor: ATTRIBUTION_ACTOR, payload: facts, occurredAt: row.createdAt, idempotencyKey: `attribution:${row.id}:referral` });
    // Neither input carries the other person anywhere: not in the payload, the actor or the key.
    expect(JSON.stringify(referral)).not.toContain(row.userId);
    expect(JSON.stringify(signup)).not.toContain(referrerUserId);
    // The keys cannot collide, and hold no account id.
    const keys = attributionEventKeys(row.id);
    expect(keys.signup).not.toBe(keys.referral);
    for (const key of Object.values(keys)) {
      expect(key).not.toContain(row.userId);
      expect(key).not.toContain(referrerUserId);
      expect(key.length).toBeLessThanOrEqual(200);
    }
    expect(attributionEventKeys("7b0c5e0e-0000-4000-8000-0000000000a2").referral).not.toBe(keys.referral);
  });

  it("the events can be written again from the row, and a repeat writes nothing", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.sam-lee" });
    const { row, mine, theirs } = await eventsOf(p.userId, sam);
    const before = await accountCounts();
    const ids = await hz.db.transaction((tx) => writeAccountEvents(tx, attributionEvents(row)));
    expect(ids).toEqual([mine[0]!.id, theirs[0]!.id]);
    expect(await accountCounts()).toEqual(before);
  });

  it("the attribution never depends on its events: an address shaped like an id keeps the row and skips both events", async () => {
    // A slug may be 32 letters a to f and digits; no account event carries anything shaped like an id.
    const address = "0123456789abcdef0123456789abcdef";
    await repos.pages.setSlug(hz.db, hz.B.businessId, { slug: address, draft: page(), userId: hz.B.ownerId });
    await repos.pages.publish(hz.db, hz.B.businessId, { content: page(), slug: address, userId: hz.B.ownerId });
    try {
      const { lines, log } = capture();
      const p = await newcomer();
      const before = await accountCounts();
      await expect(recordSignupAttribution({ db: hz.db, log }, p.userId, `p.${address}`)).resolves.toBeUndefined();
      expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ sourceKind: "project_page", sourceRef: address, sourceBusinessId: hz.B.businessId, referrerUserId: hz.B.ownerId });
      expect(await accountCounts()).toEqual(before);
      // One line: the new person's account id and a reason code. Not the address, not the credited person, not the project.
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ level: 40, userId: p.userId, reason: "id_shaped", msg: "signup attribution recorded without its account events" });
      for (const said of [address, hz.B.ownerId, hz.B.businessId]) expect(lines[0], said).not.toContain(said);
      // Through the save itself: it answers as ever, and the row is there.
      const q = await newcomer();
      expect(await q.me.founder.profile.update({ confirmAdult: true, ...answer, via: `p.${address}` })).toMatchObject({ displayName: "Newcomer" });
      expect(await repos.attributions.forUser(hz.db, q.userId)).toMatchObject({ sourceRef: address });
      expect(await accountEvents(q.userId)).toEqual([]);
      expect(await accountCounts()).toEqual(before);
    } finally {
      await repos.pages.unpublish(hz.db, hz.B.businessId, { userId: hz.B.ownerId });
      await repos.pages.setSlug(hz.db, hz.B.businessId, { slug: "still-a-draft", draft: page(), userId: hz.B.ownerId });
    }
  });

  it("a failed write of the second event takes back the first and keeps the row; the events are then written from it", async () => {
    // The database refuses the credited person's row only: the new person's row is inserted first, in the same savepoint.
    await hz.db.execute(sql`create function test_refuse_referral_arrived() returns trigger language plpgsql as $$ begin if new.type = 'referral.arrived' then raise exception 'refused for the test'; end if; return new; end; $$`);
    await hz.db.execute(sql`create trigger test_refuse_referral_arrived before insert on account_events for each row execute function test_refuse_referral_arrived()`);
    const { lines, log } = capture();
    const p = await newcomer();
    const before = await accountCounts();
    try {
      await expect(recordSignupAttribution({ db: hz.db, log }, p.userId, "u.sam-lee")).resolves.toBeUndefined();
    } finally {
      await hz.db.execute(sql`drop trigger test_refuse_referral_arrived on account_events`);
      await hz.db.execute(sql`drop function test_refuse_referral_arrived()`);
    }
    const row = (await repos.attributions.forUser(hz.db, p.userId))!;
    expect(row).toMatchObject({ sourceKind: "person_profile", sourceRef: "sam-lee", referrerUserId: sam });
    // Both events or neither: the new person's row did not stay behind without the credited person's.
    expect(await accountEvents(p.userId)).toEqual([]);
    expect(await accountCounts()).toEqual(before);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 40, userId: p.userId, reason: "write_failed", msg: "signup attribution recorded without its account events" });
    for (const said of ["sam-lee", sam, "refused for the test", "account_events"]) expect(lines[0], said).not.toContain(said);
    // The row holds everything the events carry, so they are written from it afterwards, once.
    await hz.db.transaction((tx) => writeAccountEvents(tx, attributionEvents(row)));
    await hz.db.transaction((tx) => writeAccountEvents(tx, attributionEvents(row)));
    const { mine, theirs } = await eventsOf(p.userId, sam);
    expect([mine.length, theirs.length]).toEqual([1, 1]);
    expect(await accountCounts()).toEqual({ events: before.events + 2, queued: before.queued + 2 });
  });
});

describe("recordSignupAttribution", () => {
  it("never logs the value: not when it records, not when it ignores, not when the database fails", async () => {
    const { lines, log } = capture();
    const p = await newcomer();
    await recordSignupAttribution({ db: hz.db, log }, p.userId, "p.bread-by-bike");
    expect(await repos.attributions.forUser(hz.db, p.userId)).not.toBeNull();
    expect(await attributionEventsOf(p.userId)).toHaveLength(1);
    await recordSignupAttribution({ db: hz.db, log }, (await newcomer()).userId, "p.no-such-page");
    await recordSignupAttribution({ db: hz.db, log }, (await newcomer()).userId, "<script>alert(1)</script>");
    expect(lines).toEqual([]);

    // A failing database: the save that called it must carry on, and the line names the account, not the reference.
    const failing = { transaction: async () => Promise.reject(new Error("Failed query: select … params: bread-by-bike")) } as unknown as Db;
    const q = await newcomer();
    await expect(recordSignupAttribution({ db: failing, log }, q.userId, "p.bread-by-bike")).resolves.toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ userId: q.userId, error: "Error", msg: "signup attribution was not recorded" });
    expect(lines[0]).not.toContain("bread-by-bike");
  });

  it("reads nothing at all for a value that is not a reference", async () => {
    const touched = { transaction: () => Promise.reject(new Error("must not be called")) } as unknown as Db;
    const { lines, log } = capture();
    for (const via of [undefined, null, 42, {}, "", "nope", "p.x"]) await recordSignupAttribution({ db: touched, log }, (await newcomer()).userId, via);
    expect(lines).toEqual([]);
  });
});
