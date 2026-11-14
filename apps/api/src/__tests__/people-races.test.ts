/**
 * The races of the way in and of the grant rule, on a real Postgres with real connections (docs/DEPLOY.md §4, "Checking
 * grants on a real Postgres"). PGlite has one connection, so invitations-admission.test.ts and grant-access.test.ts
 * can only show the mechanism (the lock is taken before the count; the rows are read inside the transaction). Here two
 * transactions are made to overlap for certain: the first is held at the point that matters (a lock held by a third
 * transaction, or a demotion paused after its UPDATE) until the other is seen waiting in `pg_locks` or
 * `pg_stat_activity`, then let go.
 *
 *   a. Two accepts racing for the last place: past the open-mode ceiling (a trusted inviter's invitations, the 50 a day
 *      for everyone), and under an inviter's own number of the day. Exactly one wins.
 *   b. An accept racing a demotion of its inviter, and a role change racing the editor's own demotion. The stale one
 *      (judged on a read from before the demotion committed) is refused.
 *
 * Skipped unless the harness runs on Postgres (`RLS_TEST_DATABASE_URL`); the PGlite run of the api suite skips it.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallerUser } from "../context";
import { createCaller } from "../router";
import { forgetAdmittedMemo, INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY, INVITATION_ADMISSIONS_PER_INVITER_PER_DAY } from "../services/access";
import { createApiHarness, type ApiHarness } from "./harness";

const onPostgres = Boolean(process.env.RLS_TEST_DATABASE_URL?.trim());

let hz: ApiHarness;
beforeAll(async () => {
  if (!onPostgres) return;
  hz = await createApiHarness({ prefix: "races" });
  hz.deps.gateway.addressEmail = async () => ({ sent: true, simulated: true, eventId: null });
  hz.deps.gateway.notifyEmail = async () => ({ sent: true, simulated: true, eventId: null });
}, 180_000);
afterAll(() => hz?.close());
beforeEach(() => {
  if (!onPostgres) return;
  hz.limits.reset();
  forgetAdmittedMemo();
});
afterEach(() => vi.restoreAllMocks());

const callerIn = (env: Record<string, unknown>, user: CallerUser | null) => createCaller({ ...hz.deps, env: { ...hz.deps.env, ...env } }, user);
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    const cause = err.cause as { code?: string; details?: { reason?: string } } | undefined;
    return { code: err.code, appCode: cause?.code, reason: cause?.details?.reason, message: err.message };
  }
};
let n = 0;
const person = async (tag: string) => {
  n += 1;
  const email = `${tag}-${n}@races.test`;
  return { userId: await hz.h.createUser(email), email };
};
const tokenOf = (link: string) => link.split("/i/")[1]!;
const todayStart = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const collaboratorLink = async (inviterId: string, businessId = hz.A.businessId) => tokenOf((await hz.caller({ userId: inviterId }).invitation.create({ businessId, role: "collaborator" })).link);
const count = async (q: ReturnType<typeof sql>) => Number(((await hz.db.execute(q)) as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);

/** Waits until `check` answers at least `want`, polling on a connection of its own; fails after 10 s. */
async function until(what: string, check: () => Promise<number>, want: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const got = await check();
    if (got >= want) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}: ${got} of ${want}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
/** Backends of this test database waiting for the open sign-up count's advisory lock (`pg_advisory_xact_lock(7461, 89)`). */
const waitingForCountLock = () =>
  count(sql`select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
             where l.locktype = 'advisory' and l.classid = 7461 and l.objid = 89 and not l.granted and a.datname = current_database()`);
/** Backends of this test database waiting for any lock (a row lock, an advisory lock). */
const waitingForAnyLock = () => count(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);

/** Runs `contenders` while a third transaction holds the count's lock, until every one of them is waiting for it. */
async function releasedTogether<T>(contenders: (() => Promise<T>)[]): Promise<T[]> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let holding!: () => void;
  const isHeld = new Promise<void>((r) => (holding = r));
  const holder = hz.db.transaction(async (tx) => {
    await repos.admissions.lockOpenCount(tx);
    holding();
    await held;
  });
  await isHeld;
  const running = contenders.map((c) => c());
  try {
    await until("both accepts to wait for the count's lock", waitingForCountLock, contenders.length);
  } finally {
    release();
    await holder;
  }
  return Promise.all(running);
}

/**
 * Pauses the next `repos.memberships.setRole` for `userId` after its UPDATE, inside its transaction (the row stays
 * locked, and `team.humans.role` holds the business's owner lock), until `resume` is called.
 */
function pauseDemotionOf(userId: string) {
  const real = repos.memberships.setRole.bind(repos.memberships);
  let resume!: () => void;
  const resumed = new Promise<void>((r) => (resume = r));
  let updated!: () => void;
  const hasUpdated = new Promise<void>((r) => (updated = r));
  vi.spyOn(repos.memberships, "setRole").mockImplementation(async (db, businessId, uid, role) => {
    const row = await real(db, businessId, uid, role);
    if (uid === userId) {
      updated();
      await resumed;
    }
    return row;
  });
  return { hasUpdated, resume };
}

describe.skipIf(!onPostgres)("on a real Postgres", () => {
  it("runs on Postgres, with more than one connection", async () => {
    expect(hz.h.driver).toBe("postgres");
    // Two transactions at once see two backends of their own.
    const pids = await Promise.all([0, 1].map(() => hz.db.transaction(async (tx) => ((await tx.execute(sql`select pg_backend_pid()::int as pid, pg_sleep(0.2)`)) as unknown as { rows: { pid: number }[] }).rows[0]!.pid)));
    expect(new Set(pids).size).toBe(2);
  });

  describe("a. two accepts racing for the last place: exactly one wins", () => {
    it(`the last of the ${INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY} invitation admissions a day past the open-mode ceiling`, async () => {
      // A trusted inviter (on the list) goes past the ceiling, within 50 a day for everyone together. The day's count is
      // made exactly one short of the ceiling plus 50, so one place is left past it.
      const inviter = await person("past-ceiling-inviter");
      await repos.memberships.add(hz.db, hz.A.businessId, { userId: inviter.userId, role: "admin" });
      const already = await repos.admissions.openSince(hz.db, todayStart());
      const ceiling = 5;
      for (let i = already; i < ceiling + INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY - 1; i++) await repos.admissions.record(hz.db, { userId: (await person("day-filler")).userId, how: "open" });
      expect(await repos.admissions.openSince(hz.db, todayStart())).toBe(ceiling + INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY - 1);
      const OPEN = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: ceiling, SIGNUP_ALLOWLIST: inviter.email };
      const [tokenA, tokenB] = [await collaboratorLink(inviter.userId), await collaboratorLink(inviter.userId)];
      const [a, b] = [await person("past-ceiling-a"), await person("past-ceiling-b")];
      const answers = await releasedTogether([() => refusal(callerIn(OPEN, a).invitation.accept({ token: tokenA })), () => refusal(callerIn(OPEN, b).invitation.accept({ token: tokenB }))]);
      expect(answers.filter((x) => x === null)).toHaveLength(1);
      expect(answers.filter((x) => x?.appCode === "on_waitlist" && x.reason === "ceiling")).toHaveLength(1);
      const admitted = [await repos.admissions.has(hz.db, a.userId), await repos.admissions.has(hz.db, b.userId)];
      expect(admitted.filter(Boolean)).toHaveLength(1);
      expect(await repos.admissions.openSince(hz.db, todayStart())).toBe(ceiling + INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY);
      // The one who waits is not a member, and their invitation is still pending for when there is room.
      const loser = admitted[0] ? b : a;
      expect(await repos.memberships.get(hz.db, hz.A.businessId, loser.userId)).toBeNull();
      expect(await hz.caller(null).invitation.byToken({ token: admitted[0] ? tokenB : tokenA })).toMatchObject({ state: "pending" });
    });

    it(`the last of an inviter's ${INVITATION_ADMISSIONS_PER_INVITER_PER_DAY} new accounts a day (invite-only)`, async () => {
      const inviter = await person("cap-inviter");
      await repos.memberships.add(hz.db, hz.B.businessId, { userId: inviter.userId, role: "admin" });
      const INVITE_ONLY = { SIGNUP_ALLOWLIST: inviter.email };
      for (let i = 1; i < INVITATION_ADMISSIONS_PER_INVITER_PER_DAY; i++) {
        expect(await callerIn(INVITE_ONLY, await person("cap-earlier")).invitation.accept({ token: await collaboratorLink(inviter.userId, hz.B.businessId) })).toMatchObject({ already: false });
      }
      expect(await repos.admissions.admittedByInviterSince(hz.db, inviter.userId, todayStart())).toBe(INVITATION_ADMISSIONS_PER_INVITER_PER_DAY - 1);
      const [tokenA, tokenB] = [await collaboratorLink(inviter.userId, hz.B.businessId), await collaboratorLink(inviter.userId, hz.B.businessId)];
      const [a, b] = [await person("cap-a"), await person("cap-b")];
      const answers = await releasedTogether([() => refusal(callerIn(INVITE_ONLY, a).invitation.accept({ token: tokenA })), () => refusal(callerIn(INVITE_ONLY, b).invitation.accept({ token: tokenB }))]);
      expect(answers.filter((x) => x === null)).toHaveLength(1);
      expect(answers.filter((x) => x?.code === "TOO_MANY_REQUESTS" && x.appCode === "invitation_admissions_limit")).toHaveLength(1);
      expect(await repos.admissions.admittedByInviterSince(hz.db, inviter.userId, todayStart())).toBe(INVITATION_ADMISSIONS_PER_INVITER_PER_DAY);
      const members = [await repos.memberships.get(hz.db, hz.B.businessId, a.userId), await repos.memberships.get(hz.db, hz.B.businessId, b.userId)];
      expect(members.filter((m) => m !== null)).toHaveLength(1);
    });
  });

  describe("b. a change racing a demotion of the person it rests on: the stale one is refused", () => {
    it("an accept that read its inviter before the inviter's demotion committed is refused once it commits", async () => {
      const { businessId } = hz.A;
      const inviter = await person("demoted-inviter");
      await repos.memberships.add(hz.db, businessId, { userId: inviter.userId, role: "admin" });
      const token = await collaboratorLink(inviter.userId);
      const invitee = await person("demoted-invitee");
      // The owner demotes the inviter; the demotion is held after its UPDATE, its transaction open.
      const pause = pauseDemotionOf(inviter.userId);
      const demotion = hz.caller({ userId: hz.A.ownerId }).team.humans.role({ businessId, userId: inviter.userId, role: "member" });
      await pause.hasUpdated;
      // The accept reads the inviter before its transaction (still an admin: the demotion has not committed), then
      // waits for the inviter's row, locked by the demotion.
      const accept = refusal(hz.caller(invitee).invitation.accept({ token }));
      try {
        await until("the accept to wait for the inviter's row", waitingForAnyLock, 1);
      } finally {
        pause.resume();
      }
      expect((await demotion).role).toBe("member");
      expect(await accept).toMatchObject({ code: "NOT_FOUND", appCode: "invitation_unavailable" });
      // Nothing of the accept stayed: no membership, no admission, the invitation still pending (and dead to read).
      expect(await repos.memberships.get(hz.db, businessId, invitee.userId)).toBeNull();
      expect(await repos.admissions.has(hz.db, invitee.userId)).toBe(false);
      const state = await count(sql`select count(*)::int as n from invitations where business_id = ${businessId}::uuid and invited_by_user_id = ${inviter.userId}::uuid and state = 'pending'`);
      expect(state).toBe(1);
      expect(await hz.caller(null).invitation.byToken({ token })).toEqual({ state: "unavailable" });
    });

    it("a role change by an admin whose own demotion commits first is judged on their row as it is then, and refused", async () => {
      const { businessId } = hz.A;
      const editor = await person("demoted-editor");
      await repos.memberships.add(hz.db, businessId, { userId: editor.userId, role: "admin" });
      const subject = await person("subject");
      await repos.memberships.add(hz.db, businessId, { userId: subject.userId, role: "member" });
      // The owner demotes the editor; held after its UPDATE, with the business's owner lock and the row lock.
      const pause = pauseDemotionOf(editor.userId);
      const demotion = hz.caller({ userId: hz.A.ownerId }).team.humans.role({ businessId, userId: editor.userId, role: "member" });
      await pause.hasUpdated;
      // The editor's request passes the access check before its transaction (still an admin), then waits for the lock.
      const change = refusal(hz.caller({ userId: editor.userId }).team.humans.role({ businessId, userId: subject.userId, role: "viewer" }));
      try {
        await until("the editor's change to wait behind the demotion", waitingForAnyLock, 1);
      } finally {
        pause.resume();
      }
      expect((await demotion).role).toBe("member");
      expect(await change).toMatchObject({ code: "FORBIDDEN", message: "You can no longer change people's access in this business" });
      expect(await repos.memberships.get(hz.db, businessId, subject.userId)).toMatchObject({ role: "member" });
      expect(await repos.memberships.get(hz.db, businessId, editor.userId)).toMatchObject({ role: "member" });
    });

    it("the same change, when it commits before the demotion, stands, and the demotion waits for it", async () => {
      // The other order, for contrast: nothing stale, nothing refused.
      const { businessId } = hz.A;
      const editor = await person("first-editor");
      await repos.memberships.add(hz.db, businessId, { userId: editor.userId, role: "admin" });
      const subject = await person("first-subject");
      await repos.memberships.add(hz.db, businessId, { userId: subject.userId, role: "member" });
      const pause = pauseDemotionOf(subject.userId);
      const change = hz.caller({ userId: editor.userId }).team.humans.role({ businessId, userId: subject.userId, role: "viewer" });
      await pause.hasUpdated;
      const demotion = refusal(hz.caller({ userId: hz.A.ownerId }).team.humans.role({ businessId, userId: editor.userId, role: "member" }));
      try {
        await until("the owner's demotion to wait behind the change", waitingForAnyLock, 1);
      } finally {
        pause.resume();
      }
      expect((await change).role).toBe("viewer");
      expect(await demotion).toBeNull();
      expect(await repos.memberships.get(hz.db, businessId, editor.userId)).toMatchObject({ role: "member" });
    });
  });
});

describe.skipIf(onPostgres)("on PGlite", () => {
  it("is skipped: the races need a real Postgres (RLS_TEST_DATABASE_URL, docs/DEPLOY.md §4)", () => {
    expect(onPostgres).toBe(false);
  });
});
