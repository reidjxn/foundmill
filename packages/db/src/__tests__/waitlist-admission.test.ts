/**
 * The waitlist admits and emails (0111, WP-03 T2): `repos.waitlist.admitNext`, `admittedSince`, `toNotify`, `forEmail`
 * and `markNotified`. The order is sign-up time (`WAITLIST_ORDER`); an entry with no account is never admitted; nobody
 * is admitted twice; an account that already has an admission keeps its one row, is closed as told and takes no place.
 *
 * The row lock (`for update skip locked`, two sweeps at once) needs a real-Postgres run: PGlite has one connection, so
 * here the two calls run one after the other and the test shows the second admits nobody twice, as the invitation race
 * tests do.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { repos } from "../repos";
import { WAITLIST_ORDER } from "../repos/idea-drafts";
import * as s from "../schema";
import { createTestDb, type TestHarness } from "../testing/pglite";

let h: TestHarness;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(() => h?.close());

let n = 0;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const card = { id: "c", name: "Tutorlane", pitch: "Help for tutors", archetype: "b2b_saas", stars_current: 3, stars_potential: 4, attributes: [], citations: [], crest_seed: "t" };

/** A person on the waitlist who joined at `at`; `account: false` is an entry with no account yet. */
async function waiting(at: Date, opts: { account?: boolean; draft?: boolean } = {}) {
  const email = `wait-${++n}@test.local`;
  const userId = opts.account === false ? null : await h.createUser(email);
  const draft = opts.draft ? await repos.ideaDrafts.create(h.db, { tokenHash: hash(`t${n}`), claimHash: hash(`c${n}`), prompt: "", interest: null, card, modelMode: "mock", costMicro: 0, now: at }) : null;
  if (draft) await repos.ideaDrafts.hold(h.db, hash(`t${n}`), new Date(at.getTime() + 90 * 86_400_000), at);
  const [row] = await h.db.insert(s.waitlistEntries).values({ userId, email, ideaDraftId: draft?.id ?? null, createdAt: at, updatedAt: at }).returning();
  return row!;
}

/** docs/DEPLOY.md §4 "Admit people from the waitlist", the statement the operator runs, for one address. */
const handAdmission = (address: string) => `with admitted as (
    insert into account_admissions (user_id, how) select user_id, 'waitlist' from waitlist_entries
    where email = lower('${address}') and user_id is not null on conflict (user_id) do nothing returning user_id)
  update waitlist_entries set admitted_at = now(), notified_at = case when user_id in (select user_id from admitted) then null else now() end
  where email = lower('${address}') and user_id is not null and admitted_at is null;`;

/** Leaves only the given entries waiting, so each test sees its own. */
async function onlyThese() {
  await h.db.update(s.waitlistEntries).set({ admittedAt: new Date("2026-01-01T00:00:00Z"), notifiedAt: new Date("2026-01-01T00:00:00Z") });
}

describe("the waitlist admits (repos.waitlist)", () => {
  it("admits the oldest sign-ups first, up to the limit, and records each admission as waitlist", async () => {
    await onlyThese();
    const now = new Date("2026-11-15T12:00:00Z");
    const third = await waiting(new Date("2026-11-03T00:00:00Z"));
    const first = await waiting(new Date("2026-11-01T00:00:00Z"));
    const second = await waiting(new Date("2026-11-02T00:00:00Z"));
    const admitted = await h.db.transaction((tx) => repos.waitlist.admitNext(tx, { limit: 2, now }));
    expect(admitted.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(admitted.every((r) => r.newAdmission)).toBe(true);
    for (const r of admitted) {
      expect(r.admittedAt?.toISOString()).toBe(now.toISOString());
      const admission = await repos.admissions.forUser(h.db, r.userId!);
      expect([admission?.how, admission?.createdAt.toISOString()]).toEqual(["waitlist", now.toISOString()]);
      expect(r.notifiedAt).toBeNull();
    }
    expect((await h.db.select().from(s.waitlistEntries).where(eq(s.waitlistEntries.id, third.id)))[0]!.admittedAt).toBeNull();
    expect(WAITLIST_ORDER).toBeDefined();
  });

  it("skips an entry with no account", async () => {
    await onlyThese();
    const now = new Date("2026-11-15T12:00:00Z");
    const noAccount = await waiting(new Date("2026-10-01T00:00:00Z"), { account: false });
    const person = await waiting(new Date("2026-10-02T00:00:00Z"));
    const admitted = await repos.waitlist.admitNext(h.db, { limit: 5, now });
    expect(admitted.map((r) => r.id)).toEqual([person.id]);
    expect((await h.db.select().from(s.waitlistEntries).where(eq(s.waitlistEntries.id, noAccount.id)))[0]!.admittedAt).toBeNull();
  });

  it("never admits anyone twice: a second call finds nobody new", async () => {
    await onlyThese();
    const now = new Date("2026-11-15T12:00:00Z");
    await waiting(new Date("2026-10-05T00:00:00Z"));
    expect(await repos.waitlist.admitNext(h.db, { limit: 5, now })).toHaveLength(1);
    expect(await repos.waitlist.admitNext(h.db, { limit: 5, now })).toHaveLength(0);
    expect(await repos.waitlist.admitNext(h.db, { limit: 0, now })).toHaveLength(0);
  });

  it("an account that already has an admission gets admitted_at, no second row, no email and no place of the day", async () => {
    await onlyThese();
    const now = new Date("2026-11-16T12:00:00Z");
    const day = new Date("2026-11-16T00:00:00Z");
    const before = await repos.waitlist.admittedSince(h.db, day);
    const entry = await waiting(new Date("2026-10-06T00:00:00Z"));
    await repos.admissions.record(h.db, { userId: entry.userId!, how: "existing" });
    const [r] = await repos.waitlist.admitNext(h.db, { limit: 5, now });
    expect([r!.id, r!.newAdmission]).toEqual([entry.id, false]);
    expect(r!.notifiedAt?.toISOString()).toBe(now.toISOString());
    const rows = await h.db.select().from(s.accountAdmissions).where(eq(s.accountAdmissions.userId, entry.userId!));
    expect(rows.map((a) => a.how)).toEqual(["existing"]);
    expect(await repos.waitlist.admittedSince(h.db, day)).toBe(before);
    expect(await repos.waitlist.toNotify(h.db, { since: day, limit: 50 })).toEqual([]);
  });

  it("counts the day's new waitlist admissions, the sweep's and the operator's alike, and no other kind", async () => {
    await onlyThese();
    const day = new Date("2026-11-20T00:00:00Z");
    const before = await repos.waitlist.admittedSince(h.db, day);
    const openBefore = await repos.admissions.openSince(h.db, day);
    const bySweep = await waiting(new Date("2026-11-19T00:00:00Z"));
    const byHand = await waiting(new Date("2026-11-19T00:01:00Z"));
    const other = await waiting(new Date("2026-11-19T00:02:00Z"));
    await h.db.transaction((tx) => repos.waitlist.admitNext(tx, { limit: 1, now: new Date("2026-11-20T08:00:00Z") }));
    expect((await h.db.select().from(s.waitlistEntries).where(eq(s.waitlistEntries.id, bySweep.id)))[0]!.admittedAt).not.toBeNull();
    // docs/DEPLOY.md §4's hand admission writes `waitlist` too (the statement as written there, then its time moved).
    await h.pg.query(handAdmission(byHand.email));
    await h.db.update(s.accountAdmissions).set({ createdAt: new Date("2026-11-20T09:00:00Z") }).where(eq(s.accountAdmissions.userId, byHand.userId!));
    expect((await h.db.select().from(s.waitlistEntries).where(eq(s.waitlistEntries.id, byHand.id)))[0]).toMatchObject({ notifiedAt: null });
    await h.db.insert(s.accountAdmissions).values({ userId: other.userId!, how: "existing", createdAt: new Date("2026-11-20T09:00:00Z") });
    expect((await repos.waitlist.admittedSince(h.db, day)) - before).toBe(2);
    expect(await repos.waitlist.admittedSince(h.db, new Date("2026-11-21T00:00:00Z"))).toBe(0);
    // Under open sign-up the ceiling counts them as well (and never `existing`).
    expect((await repos.admissions.openSince(h.db, day)) - openBefore).toBe(2);
  });

  it("the hand admission of docs/DEPLOY.md §4 closes as told, without an email, an entry whose account was already in", async () => {
    const entry = await waiting(new Date("2026-11-19T00:03:00Z"));
    await repos.admissions.record(h.db, { userId: entry.userId!, how: "invitation" });
    await h.pg.query(handAdmission(entry.email));
    const [row] = await h.db.select().from(s.waitlistEntries).where(eq(s.waitlistEntries.id, entry.id));
    expect(row!.admittedAt).not.toBeNull();
    expect(row!.notifiedAt).not.toBeNull();
    expect((await repos.admissions.forUser(h.db, entry.userId!))?.how).toBe("invitation");
  });

  it("the how check takes waitlist and still refuses an unknown kind", async () => {
    const userId = await h.createUser(`kind-${++n}@test.local`);
    await expect(h.pg.query("insert into account_admissions (user_id, how) values ($1, 'list')", [userId])).rejects.toThrow(/account_admissions_how_value/);
    expect((await repos.admissions.record(h.db, { userId, how: "waitlist" }))?.how).toBe("waitlist");
  });
});

describe("the waitlist emails (repos.waitlist)", () => {
  it("lists the admitted who were not told, within the window; marks them told once", async () => {
    await onlyThese();
    const now = new Date("2026-11-15T12:00:00Z");
    const told = await waiting(new Date("2026-11-01T00:00:00Z"));
    const fresh = await waiting(new Date("2026-11-02T00:00:00Z"));
    const old = await waiting(new Date("2026-10-01T00:00:00Z"));
    await h.db.update(s.waitlistEntries).set({ admittedAt: now }).where(eq(s.waitlistEntries.id, fresh.id));
    await h.db.update(s.waitlistEntries).set({ admittedAt: now, notifiedAt: now }).where(eq(s.waitlistEntries.id, told.id));
    await h.db.update(s.waitlistEntries).set({ admittedAt: new Date("2026-10-02T00:00:00Z") }).where(eq(s.waitlistEntries.id, old.id));
    const since = new Date(now.getTime() - 7 * 86_400_000);
    expect(await repos.waitlist.toNotify(h.db, { since, limit: 50 })).toEqual([{ id: fresh.id, userId: fresh.userId }]);
    expect(await repos.waitlist.markNotified(h.db, fresh.id, now)).toBe(true);
    expect(await repos.waitlist.markNotified(h.db, fresh.id, now)).toBe(false);
    expect(await repos.waitlist.toNotify(h.db, { since, limit: 50 })).toEqual([]);
  });

  it("reads one entry for its email: who, whether it waits for the email, and the kept card's name while it is kept", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const withCard = await waiting(new Date("2026-11-10T00:00:00Z"), { draft: true });
    const plain = await waiting(new Date("2026-11-10T00:00:00Z"));
    expect(await repos.waitlist.forEmail(h.db, withCard.id, now)).toMatchObject({ id: withCard.id, userId: withCard.userId, admittedAt: null, notifiedAt: null, cardName: "Tutorlane" });
    expect((await repos.waitlist.forEmail(h.db, plain.id, now))?.cardName).toBeNull();
    // Past the hold, the card is gone and not named.
    expect((await repos.waitlist.forEmail(h.db, withCard.id, new Date(now.getTime() + 200 * 86_400_000)))?.cardName).toBeNull();
    expect(await repos.waitlist.forEmail(h.db, "00000000-0000-0000-0000-000000000000", now)).toBeNull();
  });
});
