/**
 * The way in (THESIS_REVIEW packages 2.2, 3.1 and 3.3; docs/NETWORK.md F5; 0091, 0092, 0093): the admit decision in
 * every mode (services/access.ts), invitations to a project (services/invitations.ts) with the attribution an accepted
 * invitation brings, and what the two roles an invitation offers may then do. The security review of 2026-11-13 added:
 * an invitation to an address is that address's only, a cofounder invitation always names one, an account an invitation
 * let in cannot let others in and an inviter lets in a few new accounts a day, open sign-up counts invitations, the
 * cutover for a person from before, the Team permission re-checked, an ended collaborator invited again, and the races
 * (marked "needs a real-Postgres run" where PGlite's one connection can only show the mechanism).
 */
import { createHash, randomBytes } from "node:crypto";
import { repos, routeApproval } from "@foundmill/db";
import { INVITATION_OTHER_ADDRESS_WORDS, ON_WAITLIST_WORDS, type ProjectPageContent } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { founderProfiles, invitations as invitationsTable, memberships as membershipsTable } from "@foundmill/db";
import type { CallerUser } from "../context";
import { createCaller } from "../router";
import {
  decideAdmission,
  existingBefore,
  forgetAdmittedMemo,
  INVITATION_ADMISSIONS_LIMIT_MESSAGE,
  INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY,
  INVITATION_ADMISSIONS_PER_INVITER_PER_DAY,
  INVITATION_CANNOT_ADMIT_MESSAGE,
  ON_WAITLIST_MESSAGE,
  type AdmissionFacts,
} from "../services/access";
import { INVITATION_LIMITS, INVITATION_UNAVAILABLE_MESSAGE, invitationByToken } from "../services/invitations";
import type { GatewayAddressEmailRequest, GatewayNotifyEmailRequest } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const addressed: GatewayAddressEmailRequest[] = [];
const notified: GatewayNotifyEmailRequest[] = [];
/** The owners of A and B, on the list in the restricted modes below (a listed inviter's invitation admits). */
let ownerEmail = "";
let bOwnerEmail = "";
let INVITE_ONLY: Record<string, unknown> = {};

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "people" });
  hz.deps.gateway.addressEmail = async (input) => (addressed.push(input), { sent: true, simulated: true, eventId: null });
  hz.deps.gateway.notifyEmail = async (input) => (notified.push(input), { sent: true, simulated: true, eventId: null });
  ownerEmail = (await repos.founders.emailOf(hz.db, hz.A.ownerId))!;
  bOwnerEmail = (await repos.founders.emailOf(hz.db, hz.B.ownerId))!;
  INVITE_ONLY = { SIGNUP_ALLOWLIST: `listed@people.test listed2@people.test ${ownerEmail} ${bOwnerEmail}` };
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => {
  hz.limits.reset();
  addressed.length = 0;
  notified.length = 0;
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
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
let n = 0;
const person = async (tag: string) => {
  n += 1;
  const email = `${tag}-${n}@people.test`;
  return { userId: await hz.h.createUser(email), email };
};
const tokenOf = (link: string) => link.split("/i/")[1]!;
const todayStart = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
/** A person whose founder profile was made long before 0093's cutover (a person from before open sign-up). */
const fromBeforeCutover = async (userId: string, name: string) => {
  await repos.founders.upsert(hz.db, userId, { displayName: name });
  await hz.db.update(founderProfiles).set({ createdAt: new Date("2026-01-05T00:00:00Z") }).where(eq(founderProfiles.userId, userId));
};
const membershipOf = (businessId: string, userId: string) => repos.memberships.get(hz.db, businessId, userId);
/** A new admin of A (so their invitations have a daily number of their own), admitted as `how` when given. */
const freshInviter = async (tag: string, how?: "open" | "existing") => {
  const p = await person(tag);
  await repos.memberships.add(hz.db, hz.A.businessId, { userId: p.userId, role: "admin" });
  if (how) await repos.admissions.record(hz.db, { userId: p.userId, how });
  return p;
};
const collaboratorLink = async (inviterId: string) => tokenOf((await hz.caller({ userId: inviterId }).invitation.create({ businessId: hz.A.businessId, role: "collaborator" })).link);

describe("decideAdmission: admit now or wait, every mode", () => {
  const base: AdmissionFacts = { mode: "invite_only", devUser: false, listed: false, emailConfirmed: true, admitted: false, existingPerson: false, admittedToday: 0, ceiling: 200 };
  const cases: [string, Partial<AdmissionFacts>, ReturnType<typeof decideAdmission>][] = [
    ["unrestricted: everyone", { mode: "unrestricted", emailConfirmed: false }, { outcome: "admit", record: null }],
    ["the development bypass user", { devUser: true, emailConfirmed: false }, { outcome: "admit", record: null }],
    ["invite-only, listed and confirmed", { listed: true }, { outcome: "admit", record: null }],
    ["invite-only, listed but not confirmed", { listed: true, emailConfirmed: false }, { outcome: "refuse", reason: "email_unconfirmed" }],
    ["invite-only, admitted through an invitation", { admitted: true }, { outcome: "admit", record: null }],
    ["invite-only, anyone else: not listed", {}, { outcome: "refuse", reason: "not_listed" }],
    ["invite-only, not listed and not confirmed: not listed, as before", { emailConfirmed: false }, { outcome: "refuse", reason: "not_listed" }],
    ["invite-only ignores the ceiling and a profile", { existingPerson: true, admittedToday: 0 }, { outcome: "refuse", reason: "not_listed" }],
    ["open, listed: admitted without counting", { mode: "open", listed: true, admittedToday: 500 }, { outcome: "admit", record: null }],
    ["open, admitted before", { mode: "open", admitted: true, admittedToday: 500 }, { outcome: "admit", record: null }],
    ["open, a person from before open sign-up", { mode: "open", existingPerson: true, admittedToday: 500 }, { outcome: "admit", record: "existing" }],
    ["open, under the ceiling", { mode: "open", admittedToday: 199 }, { outcome: "admit", record: "open" }],
    ["open, at the ceiling: on_waitlist", { mode: "open", admittedToday: 200 }, { outcome: "wait", reason: "ceiling" }],
    ["open, a ceiling of 0 admits nobody new", { mode: "open", ceiling: 0 }, { outcome: "wait", reason: "ceiling" }],
    ["open, not confirmed: never counted, never admitted", { mode: "open", emailConfirmed: false }, { outcome: "refuse", reason: "email_unconfirmed" }],
  ];
  it.each(cases)("%s", (_name, over, want) => expect(decideAdmission({ ...base, ...over })).toEqual(want));
});

describe("admitOrWait: invite-only", () => {
  it("an account the list does not name is refused as before (not listed); the list's people pass with nothing written", async () => {
    const p = await person("unlisted");
    expect(await refusal(callerIn(INVITE_ONLY, p).founder.preferences.get())).toMatchObject({ code: "FORBIDDEN", appCode: "not_invited", reason: "not_listed" });
    expect(await repos.admissions.has(hz.db, p.userId)).toBe(false);
    const listed = { userId: await hz.h.createUser("listed@people.test"), email: "listed@people.test" };
    expect(await refusal(callerIn(INVITE_ONLY, listed).founder.preferences.get())).toBeNull();
    expect(await repos.admissions.has(hz.db, listed.userId)).toBe(false);
    expect(await refusal(callerIn(INVITE_ONLY, { ...listed, emailConfirmed: false }).founder.preferences.get())).toMatchObject({ reason: "email_unconfirmed" });
  });

  it("a listed inviter's invitation is an admission: an account the list does not name accepts it and is in, its live channels too", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { link } = await owner.invitation.create({ businessId: hz.A.businessId, role: "collaborator" });
    const p = await person("invited");
    const me = callerIn(INVITE_ONLY, p);
    expect(await refusal(me.founder.preferences.get())).toMatchObject({ reason: "not_listed" });
    // The invitation's own page and accept do not need an admission; an anonymous sign-in never accepts.
    expect(await callerIn(INVITE_ONLY, null).invitation.byToken({ token: tokenOf(link) })).toMatchObject({ state: "pending", role: "collaborator" });
    expect(await refusal(callerIn(INVITE_ONLY, { ...p, emailConfirmed: false }).invitation.accept({ token: tokenOf(link) }))).toMatchObject({ reason: "email_unconfirmed" });
    expect(await me.invitation.accept({ token: tokenOf(link) })).toEqual({ businessId: hz.A.businessId, already: false });
    forgetAdmittedMemo();
    expect(await refusal(me.founder.preferences.get())).toBeNull();
    expect(await refusal(me.inbox.list({ businessId: hz.A.businessId }))).toBeNull();
    expect(await repos.admissions.forUser(hz.db, p.userId)).toMatchObject({ how: "invitation" });
  });

  it("an account an invitation let in cannot let a new account in; its invitation still adds someone who is already in", async () => {
    const { businessId } = hz.A;
    // p joins by the listed owner's invitation, then the owner makes them an admin, so they may invite collaborators.
    const { link } = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId, role: "collaborator" });
    const p = await person("invited-admin");
    await callerIn(INVITE_ONLY, p).invitation.accept({ token: tokenOf(link) });
    await hz.caller({ userId: hz.A.ownerId }).team.humans.role({ businessId, userId: p.userId, role: "admin" });
    const second = await callerIn(INVITE_ONLY, p).invitation.create({ businessId, role: "collaborator" });
    // A new account: refused, nothing written, the link still waits.
    const fresh = await person("second-hop");
    expect(await refusal(callerIn(INVITE_ONLY, fresh).invitation.accept({ token: tokenOf(second.link) }))).toMatchObject({ code: "FORBIDDEN", appCode: "invitation_cannot_admit", message: INVITATION_CANNOT_ADMIT_MESSAGE });
    expect(await repos.admissions.has(hz.db, fresh.userId)).toBe(false);
    expect(await membershipOf(businessId, fresh.userId)).toBeNull();
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(second.link) })).toMatchObject({ state: "pending" });
    // An account the list already admits: the same link adds them.
    const listed = { userId: await hz.h.createUser("listed2@people.test"), email: "listed2@people.test" };
    expect(await callerIn(INVITE_ONLY, listed).invitation.accept({ token: tokenOf(second.link) })).toEqual({ businessId, already: false });
    expect(await membershipOf(businessId, listed.userId)).toMatchObject({ role: "collaborator" });
    expect(await repos.admissions.has(hz.db, listed.userId)).toBe(false);
  });

  it(`one inviter's invitations let in at most ${INVITATION_ADMISSIONS_PER_INVITER_PER_DAY} new accounts a UTC day; someone already in still joins`, async () => {
    const { businessId } = hz.B;
    const owner = hz.caller({ userId: hz.B.ownerId });
    expect(INVITATION_ADMISSIONS_PER_INVITER_PER_DAY).toBe(3);
    const links: string[] = [];
    for (let i = 0; i < INVITATION_ADMISSIONS_PER_INVITER_PER_DAY + 2; i++) links.push((await owner.invitation.create({ businessId, role: "collaborator" })).link);
    for (let i = 0; i < INVITATION_ADMISSIONS_PER_INVITER_PER_DAY; i++) {
      const p = await person(`cap-${i}`);
      expect(await callerIn(INVITE_ONLY, p).invitation.accept({ token: tokenOf(links[i]!) })).toEqual({ businessId, already: false });
    }
    expect(await repos.admissions.admittedByInviterSince(hz.db, hz.B.ownerId, todayStart())).toBe(INVITATION_ADMISSIONS_PER_INVITER_PER_DAY);
    const over = await person("cap-over");
    expect(await refusal(callerIn(INVITE_ONLY, over).invitation.accept({ token: tokenOf(links[INVITATION_ADMISSIONS_PER_INVITER_PER_DAY]!) }))).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "invitation_admissions_limit", message: INVITATION_ADMISSIONS_LIMIT_MESSAGE });
    expect(await repos.admissions.has(hz.db, over.userId)).toBe(false);
    expect(await membershipOf(businessId, over.userId)).toBeNull();
    // Someone already in is never counted: an account an earlier invitation let in joins with the next link.
    const already = await person("cap-already");
    await repos.admissions.record(hz.db, { userId: already.userId, how: "open" });
    expect(await callerIn(INVITE_ONLY, already).invitation.accept({ token: tokenOf(links[INVITATION_ADMISSIONS_PER_INVITER_PER_DAY + 1]!) })).toEqual({ businessId, already: false });
  });

  it("the advisory lock is taken before the counts it guards (the mechanism; the race itself needs a real-Postgres run)", async () => {
    const order: string[] = [];
    const lock = repos.admissions.lockOpenCount.bind(repos.admissions);
    const perInviter = repos.admissions.admittedByInviterSince.bind(repos.admissions);
    const record = repos.admissions.record.bind(repos.admissions);
    vi.spyOn(repos.admissions, "lockOpenCount").mockImplementation(async (tx) => (order.push("lock"), lock(tx)));
    vi.spyOn(repos.admissions, "admittedByInviterSince").mockImplementation(async (db, id, since) => (order.push("count"), perInviter(db, id, since)));
    vi.spyOn(repos.admissions, "record").mockImplementation(async (db, input) => (order.push("record"), record(db, input)));
    const { link } = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId: hz.A.businessId, role: "collaborator" });
    const p = await person("lock-order");
    await callerIn(INVITE_ONLY, p).invitation.accept({ token: tokenOf(link) });
    expect(order).toEqual(["lock", "count", "record"]);
  });
});

describe("admitOrWait: open sign-up with a daily ceiling", () => {
  it("admits new accounts until the day's ceiling, then refuses with on_waitlist; people from before and the list never count", async () => {
    const before = await repos.admissions.openSince(hz.db, todayStart());
    const OPEN = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: before + 2, SIGNUP_ALLOWLIST: "listed-open@people.test" };
    const [a, b, c] = [await person("open-a"), await person("open-b"), await person("open-c")];
    expect(await refusal(callerIn(OPEN, a).founder.preferences.get())).toBeNull();
    expect(await refusal(callerIn(OPEN, b).founder.preferences.get())).toBeNull();
    expect(await refusal(callerIn(OPEN, c).founder.preferences.get())).toEqual({ code: "FORBIDDEN", appCode: "on_waitlist", reason: "ceiling", message: ON_WAITLIST_MESSAGE });
    expect(ON_WAITLIST_MESSAGE).toBe(`${ON_WAITLIST_WORDS.title} ${ON_WAITLIST_WORDS.body}`);
    expect(await repos.admissions.has(hz.db, c.userId)).toBe(false);
    // An unconfirmed sign-in is never counted or admitted.
    const u = await person("open-unconfirmed");
    expect(await refusal(callerIn(OPEN, { ...u, emailConfirmed: false }).founder.preferences.get())).toMatchObject({ reason: "email_unconfirmed" });
    expect((await repos.admissions.forUser(hz.db, a.userId))?.how).toBe("open");
    // A person who was here before (a founder profile from before the cutover) is in without counting; so is a listed address.
    const fromBefore = await person("from-before");
    await fromBeforeCutover(fromBefore.userId, "From Before");
    expect(await refusal(callerIn(OPEN, fromBefore).founder.preferences.get())).toBeNull();
    expect((await repos.admissions.forUser(hz.db, fromBefore.userId))?.how).toBe("existing");
    const listed = { userId: await hz.h.createUser("listed-open@people.test"), email: "listed-open@people.test" };
    expect(await refusal(callerIn(OPEN, listed).founder.preferences.get())).toBeNull();
    expect(await repos.admissions.openSince(hz.db, todayStart())).toBe(before + 2);
  });

  it("a profile made after the cutover is not a person from before: it waits like anyone new (SIGNUP_EXISTING_BEFORE overrides the stored moment)", async () => {
    const stored = await existingBefore({ env: {}, db: hz.db });
    expect(stored.getTime()).toBeLessThan(Date.now());
    const before = await repos.admissions.openSince(hz.db, todayStart());
    const FULL = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: before };
    const late = await person("profile-today");
    await repos.founders.upsert(hz.db, late.userId, { displayName: "Made Today" });
    expect(await refusal(callerIn(FULL, late).founder.preferences.get())).toMatchObject({ appCode: "on_waitlist", reason: "ceiling" });
    expect(await repos.admissions.has(hz.db, late.userId)).toBe(false);
    // With the cutover set later than the profile, the same account is a person from before.
    const LATER = { ...FULL, SIGNUP_EXISTING_BEFORE: new Date(Date.now() + 86_400_000).toISOString() };
    expect(await refusal(callerIn(LATER, late).founder.preferences.get())).toBeNull();
    expect((await repos.admissions.forUser(hz.db, late.userId))?.how).toBe("existing");
  });

  it("an invitation's admission counts toward the day's ceiling", async () => {
    const before = await repos.admissions.openSince(hz.db, todayStart());
    // The admin's address is listed, so their invitation admits (the owners' daily numbers went to the tests above).
    const adminEmail = (await repos.founders.emailOf(hz.db, hz.A.adminId))!;
    const OPEN = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: before + 1, SIGNUP_ALLOWLIST: adminEmail };
    const { link } = await hz.caller({ userId: hz.A.adminId }).invitation.create({ businessId: hz.A.businessId, role: "collaborator" });
    const invited = await person("open-invited");
    expect(await callerIn(OPEN, invited).invitation.accept({ token: tokenOf(link) })).toEqual({ businessId: hz.A.businessId, already: false });
    expect((await repos.admissions.forUser(hz.db, invited.userId))?.how).toBe("invitation");
    expect(await repos.admissions.openSince(hz.db, todayStart())).toBe(before + 1);
    // The ceiling is now reached: the next new account waits.
    const next = await person("open-after-invited");
    expect(await refusal(callerIn(OPEN, next).founder.preferences.get())).toMatchObject({ appCode: "on_waitlist" });
  });

  it("an invitation from an inviter who may not let people in still lets a new account in under open sign-up's ceiling, and waits past it", async () => {
    const before = await repos.admissions.openSince(hz.db, todayStart());
    const { link } = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId: hz.A.businessId, role: "collaborator" });
    const second = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId: hz.A.businessId, role: "collaborator" });
    // The owner is neither listed nor admitted here: open sign-up's own decision applies.
    const OPEN = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: before + 1 };
    const a = await person("open-plain-a");
    expect(await callerIn(OPEN, a).invitation.accept({ token: tokenOf(link) })).toMatchObject({ already: false });
    expect((await repos.admissions.forUser(hz.db, a.userId))?.how).toBe("open");
    const b = await person("open-plain-b");
    expect(await refusal(callerIn(OPEN, b).invitation.accept({ token: tokenOf(second.link) }))).toMatchObject({ appCode: "on_waitlist" });
    expect(await membershipOf(hz.A.businessId, b.userId)).toBeNull();
  });

  it("an inviter open sign-up let in: their invitation admits while the ceiling has room, and waits at it like any sign-up", async () => {
    const inviter = await freshInviter("open-inviter", "open");
    const [under, at] = [await collaboratorLink(inviter.userId), await collaboratorLink(inviter.userId)];
    const before = await repos.admissions.openSince(hz.db, todayStart());
    const OPEN = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: before + 1 };
    const a = await person("open-inviter-a");
    expect(await callerIn(OPEN, a).invitation.accept({ token: under })).toEqual({ businessId: hz.A.businessId, already: false });
    expect(await repos.admissions.forUser(hz.db, a.userId)).toMatchObject({ how: "invitation" });
    // The ceiling is reached: the next invitee of the same inviter waits, with the words a sign-up meets, and nothing changes.
    const b = await person("open-inviter-b");
    expect(await refusal(callerIn(OPEN, b).invitation.accept({ token: at }))).toEqual({ code: "FORBIDDEN", appCode: "on_waitlist", reason: "ceiling", message: ON_WAITLIST_MESSAGE });
    expect(await repos.admissions.has(hz.db, b.userId)).toBe(false);
    expect(await membershipOf(hz.A.businessId, b.userId)).toBeNull();
    expect(await hz.caller(null).invitation.byToken({ token: at })).toMatchObject({ state: "pending" });
    expect(await repos.admissions.openSince(hz.db, todayStart())).toBe(before + 1);
    // With room again (tomorrow's ceiling), the same link works.
    expect(await callerIn({ ...OPEN, SIGNUP_DAILY_CEILING: before + 2 }, b).invitation.accept({ token: at })).toMatchObject({ already: false });
  });

  it("an inviter the list or the time before let in goes past the ceiling, within their own number", async () => {
    const listed = await freshInviter("listed-past");
    const existing = await freshInviter("existing-past", "existing");
    const before = await repos.admissions.openSince(hz.db, todayStart());
    const FULL = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: before, SIGNUP_ALLOWLIST: listed.email };
    // A sign-up waits; the listed inviter's and the person from before's invitees get in, as invitation admissions.
    expect(await refusal(callerIn(FULL, await person("past-signup")).founder.preferences.get())).toMatchObject({ appCode: "on_waitlist" });
    for (const inviter of [listed, existing]) {
      const p = await person("past-invitee");
      expect(await callerIn(FULL, p).invitation.accept({ token: await collaboratorLink(inviter.userId) })).toMatchObject({ already: false });
      expect(await repos.admissions.forUser(hz.db, p.userId)).toMatchObject({ how: "invitation" });
    }
    expect(await repos.admissions.openSince(hz.db, todayStart())).toBe(before + 2);
    // Past their own number of the day, the ceiling decides for them too.
    for (let i = 1; i < INVITATION_ADMISSIONS_PER_INVITER_PER_DAY; i++) await callerIn(FULL, await person("past-more")).invitation.accept({ token: await collaboratorLink(listed.userId) });
    expect(await repos.admissions.admittedByInviterSince(hz.db, listed.userId, todayStart())).toBe(INVITATION_ADMISSIONS_PER_INVITER_PER_DAY);
    const over = await person("past-over");
    expect(await refusal(callerIn(FULL, over).invitation.accept({ token: await collaboratorLink(listed.userId) }))).toMatchObject({ appCode: "on_waitlist", reason: "ceiling" });
    expect(await repos.admissions.has(hz.db, over.userId)).toBe(false);
  });

  it(`at most ${INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY} invitation admissions a day past the ceiling, for every inviter together`, async () => {
    expect(INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY).toBe(50);
    const listed = await freshInviter("past-cap");
    const ceiling = 10;
    const OPEN = { SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: ceiling, SIGNUP_ALLOWLIST: listed.email };
    // The day's count as the lock-holder reads it: one place left past the ceiling, then none.
    const spy = vi.spyOn(repos.admissions, "openSince").mockResolvedValue(ceiling + INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY - 1);
    const last = await person("past-cap-last");
    expect(await callerIn(OPEN, last).invitation.accept({ token: await collaboratorLink(listed.userId) })).toMatchObject({ already: false });
    expect(await repos.admissions.forUser(hz.db, last.userId)).toMatchObject({ how: "invitation" });
    spy.mockResolvedValue(ceiling + INVITATION_ADMISSIONS_PAST_CEILING_PER_DAY);
    const token = await collaboratorLink(listed.userId);
    const after = await person("past-cap-after");
    expect(await refusal(callerIn(OPEN, after).invitation.accept({ token }))).toMatchObject({ appCode: "on_waitlist", reason: "ceiling", message: ON_WAITLIST_MESSAGE });
    expect(await repos.admissions.has(hz.db, after.userId)).toBe(false);
    expect(await hz.caller(null).invitation.byToken({ token })).toMatchObject({ state: "pending" });
  });

  it("under open sign-up the advisory lock is taken before both counts (the mechanism; the race itself needs a real-Postgres run)", async () => {
    const inviter = await freshInviter("open-lock", "open");
    const token = await collaboratorLink(inviter.userId);
    const order: string[] = [];
    const lock = repos.admissions.lockOpenCount.bind(repos.admissions);
    const perInviter = repos.admissions.admittedByInviterSince.bind(repos.admissions);
    const day = repos.admissions.openSince.bind(repos.admissions);
    vi.spyOn(repos.admissions, "lockOpenCount").mockImplementation(async (tx) => (order.push("lock"), lock(tx)));
    vi.spyOn(repos.admissions, "admittedByInviterSince").mockImplementation(async (db, id, since) => (order.push("inviter"), perInviter(db, id, since)));
    vi.spyOn(repos.admissions, "openSince").mockImplementation(async (db, since) => (order.push("day"), day(db, since)));
    const before = await day(hz.db, todayStart());
    await callerIn({ SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: before + 1 }, await person("open-lock-invitee")).invitation.accept({ token });
    expect(order.slice(order.indexOf("lock"))).toEqual(["lock", "inviter", "day"]);
  });

  it("two sign-ins at the last place cannot both take it", async () => {
    const before = await repos.admissions.openSince(hz.db, todayStart());
    const OPEN = { SIGNUP_OPEN: "on", SIGNUP_DAILY_CEILING: before + 1 };
    const [a, b] = [await person("race-a"), await person("race-b")];
    const answers = await Promise.all([refusal(callerIn(OPEN, a).founder.preferences.get()), refusal(callerIn(OPEN, b).founder.preferences.get())]);
    expect(answers.filter((x) => x === null)).toHaveLength(1);
    expect(answers.filter((x) => x?.appCode === "on_waitlist")).toHaveLength(1);
  });
});

describe("invitations", () => {
  it("an owner invites either role, an admin a collaborator only, a member or viewer nobody; a sample business nobody", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const created = await owner.invitation.create({ businessId, role: "cofounder", email: "Friend@Example.com" });
    expect(created.link).toMatch(new RegExp(`^${hz.deps.env.APP_URL.replace(/\/$/, "")}/i/[A-Za-z0-9_-]{43}$`));
    expect(created.invitation).toMatchObject({ role: "cofounder", state: "pending", sentTo: "fr***@example.com" });
    expect(created.emailed).toBe(true);
    expect(addressed).toEqual([{ kind: "invitation", data: { invitationId: created.invitation.id, token: tokenOf(created.link) } }]);
    // Only the hash is stored.
    const [row] = await hz.db.select().from(invitationsTable).where(eq(invitationsTable.id, created.invitation.id));
    expect(row!.tokenHash).toBe(sha256(tokenOf(created.link)));
    expect(JSON.stringify(row)).not.toContain(tokenOf(created.link));
    expect((await refusal(hz.caller({ userId: hz.A.adminId }).invitation.create({ businessId, role: "cofounder", email: "x@example.com" })))?.code).toBe("FORBIDDEN");
    expect((await hz.caller({ userId: hz.A.adminId }).invitation.create({ businessId, role: "collaborator" })).emailed).toBeNull();
    for (const id of [hz.A.memberId, hz.A.viewerId, hz.B.ownerId]) expect((await refusal(hz.caller({ userId: id }).invitation.create({ businessId, role: "collaborator" })))?.code).toBe("FORBIDDEN");
    // The list masks the address and never carries a token.
    const list = await owner.invitation.list({ businessId });
    expect(list.find((i) => i.id === created.invitation.id)).toMatchObject({ sentTo: "fr***@example.com", state: "pending" });
    expect(JSON.stringify(list)).not.toMatch(/tokenHash|friend@example\.com/);
    expect((await refusal(hz.caller({ userId: hz.B.ownerId }).invitation.list({ businessId })))?.code).toBe("FORBIDDEN");
    const events = (await repos.events.list(hz.db, businessId, { type: "invitation.sent", limit: 50 })).items;
    expect(events.find((e) => (e.payload as { invitationId: string }).invitationId === created.invitation.id)?.payload).toEqual({ invitationId: created.invitation.id, role: "cofounder", emailed: true });
  });

  it("a cofounder invitation always names an address (the api and the database); a link-only collaborator invitation is fine", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await refusal(owner.invitation.create({ businessId, role: "cofounder" }))).toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/type their email address/) });
    expect((await owner.invitation.create({ businessId, role: "collaborator" })).invitation.role).toBe("collaborator");
    // 0093's check: even the service connection cannot store one.
    const stored = await repos.invitations.create(hz.db, businessId, { tokenHash: sha256(randomBytes(8).toString("hex")), role: "cofounder", invitedByUserId: hz.A.ownerId, email: null, expiresAt: new Date(Date.now() + 86_400_000) }).then(
      () => "stored",
      (err: unknown) => [err, (err as { cause?: unknown }).cause].map((e) => String((e as { message?: unknown } | undefined)?.message ?? "")).join(" | "),
    );
    expect(stored).toMatch(/invitations_cofounder_email/);
    // A link-only cofounder invitation from before 0093 (written past the check) does not work.
    const token = randomBytes(32).toString("base64url");
    await hz.db.execute(sql`alter table invitations drop constraint invitations_cofounder_email`);
    try {
      await repos.invitations.create(hz.db, businessId, { tokenHash: sha256(token), role: "cofounder", invitedByUserId: hz.A.ownerId, email: null, expiresAt: new Date(Date.now() + 86_400_000) });
    } finally {
      await hz.db.execute(sql`alter table invitations add constraint invitations_cofounder_email check (role <> 'cofounder' or email is not null) not valid`);
    }
    expect(await hz.caller(null).invitation.byToken({ token })).toEqual({ state: "unavailable" });
    const p = await person("old-cofounder-link");
    expect((await refusal(hz.caller(p).invitation.accept({ token })))?.code).toBe("NOT_FOUND");
  });

  it("making an invitation, and keeping it alive, needs write on the Team section, not the role alone", async () => {
    const { businessId } = hz.A;
    const admin = hz.caller({ userId: hz.A.adminId });
    const { link } = await admin.invitation.create({ businessId, role: "collaborator" });
    await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.adminId, { team: "read" });
    try {
      expect((await refusal(admin.invitation.create({ businessId, role: "collaborator" })))?.code).toBe("FORBIDDEN");
      expect(await hz.caller(null).invitation.byToken({ token: tokenOf(link) })).toEqual({ state: "unavailable" });
      const p = await person("narrowed-inviter");
      expect((await refusal(hz.caller(p).invitation.accept({ token: tokenOf(link) })))?.code).toBe("NOT_FOUND");
      expect(await membershipOf(businessId, p.userId)).toBeNull();
    } finally {
      await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.adminId, {});
    }
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(link) })).toMatchObject({ state: "pending" });
  });

  it("byToken says what it is and nothing else; unknown, revoked, used, declined and an inviter who lost the right read the same", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const anon = hz.caller(null);
    const { link, invitation } = await owner.invitation.create({ businessId, role: "collaborator" });
    const preview = await anon.invitation.byToken({ token: tokenOf(link) });
    expect(Object.keys(preview).sort()).toEqual(["inviterName", "projectName", "role", "roleSentence", "roleWord", "state"]);
    expect(preview).toMatchObject({ state: "pending", role: "collaborator", roleWord: "Collaborator" });
    expect(await anon.invitation.byToken({ token: "A".repeat(43) })).toEqual({ state: "unavailable" });
    expect(await anon.invitation.byToken({ token: "short" })).toEqual({ state: "unavailable" });
    await owner.invitation.revoke({ businessId, invitationId: invitation.id });
    expect(await anon.invitation.byToken({ token: tokenOf(link) })).toEqual({ state: "unavailable" });
    expect((await refusal(owner.invitation.revoke({ businessId, invitationId: invitation.id })))?.code).toBe("NOT_FOUND");
    // An admin's collaborator invitation stops working when the admin is no longer one.
    const admin = hz.caller({ userId: hz.A.adminId });
    const second = await admin.invitation.create({ businessId, role: "collaborator" });
    await repos.memberships.setRole(hz.db, businessId, hz.A.adminId, "member");
    try {
      expect(await anon.invitation.byToken({ token: tokenOf(second.link) })).toEqual({ state: "unavailable" });
      const p = await person("too-late");
      expect((await refusal(hz.caller(p).invitation.accept({ token: tokenOf(second.link) })))?.code).toBe("NOT_FOUND");
    } finally {
      await repos.memberships.setRole(hz.db, businessId, hz.A.adminId, "admin");
    }
    // Declined: the link stops working.
    const third = await owner.invitation.create({ businessId, role: "collaborator" });
    expect(await anon.invitation.decline({ token: tokenOf(third.link) })).toEqual({ ok: true });
    expect(await anon.invitation.byToken({ token: tokenOf(third.link) })).toEqual({ state: "unavailable" });
    expect(await anon.invitation.decline({ token: "B".repeat(43) })).toEqual({ ok: true });
  });

  it("the read limit counts an IPv6 caller by their /64 (second review P2-2)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const links: string[] = [];
    for (let i = 0; i < 3; i++) links.push(tokenOf((await owner.invitation.create({ businessId: hz.A.businessId, role: "collaborator" })).link));
    const read = (clientAddress: string, token = links[0]!) => invitationByToken({ ...hz.deps, clientAddress }, token);
    // Every address of one /64 draws from one window (three links, so no token's own window runs out first).
    for (let i = 0; i < INVITATION_LIMITS.readPerCaller.limit; i++) expect(await read(`2001:db8:7:8::${(i + 1).toString(16)}`, links[i % 3])).toMatchObject({ state: "pending" });
    await expect(read("2001:db8:7:8:ffff:1:2:3")).rejects.toMatchObject({ code: "rate_limited" });
    await expect(read("[2001:0db8:0007:0008::abcd]")).rejects.toMatchObject({ code: "rate_limited" });
    // Another /64, and an IPv4 caller, have their own.
    expect(await read("2001:db8:7:9::1")).toMatchObject({ state: "pending" });
    expect(await read("203.0.113.9")).toMatchObject({ state: "pending" });
  });

  it("one token is read at most so many times a minute, from anywhere; other tokens and dead ones are not held up", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const [hot, other] = [await owner.invitation.create({ businessId: hz.A.businessId, role: "collaborator" }), await owner.invitation.create({ businessId: hz.A.businessId, role: "collaborator" })];
    const read = (i: number, token: string) => invitationByToken({ ...hz.deps, clientAddress: `198.51.100.${i % 250}` }, token);
    expect(INVITATION_LIMITS.readPerToken.limit).toBe(60);
    for (let i = 0; i < INVITATION_LIMITS.readPerToken.limit; i++) expect(await read(i, tokenOf(hot.link))).toMatchObject({ state: "pending" });
    await expect(read(200, tokenOf(hot.link))).rejects.toMatchObject({ code: "rate_limited" });
    expect(await read(201, tokenOf(other.link))).toMatchObject({ state: "pending" });
    // A token that names nothing gives its window back each time: it is limited by the callers' and the unknown ceilings only.
    const dead = "C".repeat(43);
    for (let i = 0; i < INVITATION_LIMITS.readPerToken.limit + 5; i++) expect(await read(i, dead)).toEqual({ state: "unavailable" });
  });

  it("accept: one membership, once, audited, with invitation.accepted and membership.changed; the inviter is emailed", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const p = await person("cofounder");
    const { link, invitation } = await owner.invitation.create({ businessId, role: "cofounder", email: p.email });
    // The address as the person typed it at sign-in: case does not matter.
    expect(await hz.caller({ ...p, email: p.email.toUpperCase() }).invitation.accept({ token: tokenOf(link) })).toEqual({ businessId, already: false });
    expect(await repos.memberships.get(hz.db, businessId, p.userId)).toMatchObject({ role: "cofounder", source: "invite" });
    const q = await person("second-use");
    expect((await refusal(hz.caller(q).invitation.accept({ token: tokenOf(link) })))?.code).toBe("NOT_FOUND");
    expect(await repos.memberships.get(hz.db, businessId, q.userId)).toBeNull();
    const events = (await repos.events.list(hz.db, businessId, { limit: 200 })).items;
    expect(events.find((e) => e.type === "invitation.accepted" && (e.payload as { invitationId: string }).invitationId === invitation.id)?.payload).toEqual({ invitationId: invitation.id, role: "cofounder", userId: p.userId });
    expect(events.some((e) => e.type === "membership.changed" && (e.payload as { userId: string }).userId === p.userId)).toBe(true);
    const audit = await repos.audit.list(hz.db, businessId, { limit: 200 });
    expect(audit.items.some((a) => a.action === "invitation.accepted" && a.actorId === p.userId)).toBe(true);
    expect(notified).toEqual([{ userId: hz.A.ownerId, kind: "invitation_accepted", businessId, data: { invitationId: invitation.id } }]);
    expect((await owner.invitation.list({ businessId })).find((i) => i.id === invitation.id)).toMatchObject({ state: "accepted", acceptedByUserId: p.userId });
  });

  it("an invitation to an address is accepted only by the account signed in with it; anyone else is told which address to sign in with, never what it is, and a link-only collaborator invitation works for anyone", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const [alice, bob, carol, dave, erin] = [await person("alice"), await person("bob"), await person("carol"), await person("dave"), await person("erin")];
    const forAlice = await owner.invitation.create({ businessId, role: "cofounder", email: alice.email });
    // Bob holds the link (a forwarded email): told to sign in with the address it was sent to, and nothing changes.
    const other = await refusal(hz.caller(bob).invitation.accept({ token: tokenOf(forAlice.link) }));
    expect(other).toMatchObject({ code: "FORBIDDEN", appCode: "invitation_other_address", message: INVITATION_OTHER_ADDRESS_WORDS });
    expect(INVITATION_OTHER_ADDRESS_WORDS).toBe("Sign in with the address this invitation was sent to.");
    expect(JSON.stringify(other)).not.toContain(alice.email);
    expect(await refusal(hz.caller({ userId: bob.userId, email: null }).invitation.accept({ token: tokenOf(forAlice.link) }))).toMatchObject({ appCode: "invitation_other_address" });
    expect(await membershipOf(businessId, bob.userId)).toBeNull();
    // A dead link still reads as one, whoever opens it.
    expect(await refusal(hz.caller(bob).invitation.accept({ token: "D".repeat(43) }))).toMatchObject({ code: "NOT_FOUND", appCode: "invitation_unavailable", message: INVITATION_UNAVAILABLE_MESSAGE });
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(forAlice.link) })).toMatchObject({ state: "pending" });
    expect(await hz.caller(alice).invitation.accept({ token: tokenOf(forAlice.link) })).toEqual({ businessId, already: false });
    expect(await membershipOf(businessId, alice.userId)).toMatchObject({ role: "cofounder" });
    // A collaborator invitation that names an address is that address's too.
    const forCarol = await owner.invitation.create({ businessId, role: "collaborator", email: carol.email });
    expect(await refusal(hz.caller(dave).invitation.accept({ token: tokenOf(forCarol.link) }))).toMatchObject({ code: "FORBIDDEN", appCode: "invitation_other_address" });
    expect(await hz.caller(carol).invitation.accept({ token: tokenOf(forCarol.link) })).toMatchObject({ already: false });
    // Link-only: whoever opens it.
    const linkOnly = await owner.invitation.create({ businessId, role: "collaborator" });
    expect(await hz.caller(erin).invitation.accept({ token: tokenOf(linkOnly.link) })).toMatchObject({ already: false });
    expect(await membershipOf(businessId, erin.userId)).toMatchObject({ role: "collaborator" });
  });

  it("declining an invitation to an address needs the account signed in with it; a link-only one is declined with the token alone", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const [frank, gina] = [await person("frank"), await person("gina")];
    const forFrank = await owner.invitation.create({ businessId, role: "collaborator", email: frank.email });
    for (const caller of [hz.caller(null), hz.caller(gina), hz.caller({ ...frank, emailConfirmed: false }), hz.caller({ userId: frank.userId, email: null })]) {
      expect(await refusal(caller.invitation.decline({ token: tokenOf(forFrank.link) }))).toMatchObject({ code: "FORBIDDEN", appCode: "invitation_other_address", message: INVITATION_OTHER_ADDRESS_WORDS });
    }
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(forFrank.link) })).toMatchObject({ state: "pending" });
    expect(await hz.caller({ ...frank, email: frank.email.toUpperCase() }).invitation.decline({ token: tokenOf(forFrank.link) })).toEqual({ ok: true });
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(forFrank.link) })).toEqual({ state: "unavailable" });
    const [row] = await hz.db.select({ state: invitationsTable.state }).from(invitationsTable).where(eq(invitationsTable.id, forFrank.invitation.id));
    expect(row!.state).toBe("declined");
    // A dead link answers ok to anyone, as before; a link-only invitation is the token holder's to decline.
    expect(await hz.caller(null).invitation.decline({ token: tokenOf(forFrank.link) })).toEqual({ ok: true });
    const linkOnly = await owner.invitation.create({ businessId, role: "collaborator" });
    expect(await hz.caller(null).invitation.decline({ token: tokenOf(linkOnly.link) })).toEqual({ ok: true });
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(linkOnly.link) })).toEqual({ state: "unavailable" });
  });

  it("accept re-checks the inviter's membership locked for share (the mechanism; a demotion racing it needs a real-Postgres run)", async () => {
    const { businessId } = hz.A;
    const { link } = await hz.caller({ userId: hz.A.adminId }).invitation.create({ businessId, role: "collaborator" });
    const getActive = repos.memberships.getActive.bind(repos.memberships);
    const calls: { userId: string; lock: string | undefined }[] = [];
    vi.spyOn(repos.memberships, "getActive").mockImplementation(async (db, bid, userId, options = {}) => (calls.push({ userId, lock: options.lock }), getActive(db, bid, userId, options)));
    const p = await person("share-lock");
    await hz.caller(p).invitation.accept({ token: tokenOf(link) });
    const inviterChecks = calls.filter((c) => c.userId === hz.A.adminId);
    // Once before the transaction (no lock), once inside it, for share.
    expect(inviterChecks.map((c) => c.lock ?? null)).toEqual([null, "share"]);
    // The query itself takes the lock: SELECT … FOR SHARE holds a RowShareLock on memberships until the transaction ends.
    const rowShare = (tx: Parameters<Parameters<typeof hz.db.transaction>[0]>[0]) =>
      tx.execute(sql`select count(*)::int as n from pg_locks where locktype = 'relation' and relation = 'memberships'::regclass and mode = 'RowShareLock' and pid = pg_backend_pid()`).then((r) => ((r as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0));
    const [plain, locked] = [
      await hz.db.transaction(async (tx) => (await repos.memberships.getActive(tx, businessId, hz.A.adminId), rowShare(tx))),
      await hz.db.transaction(async (tx) => (await repos.memberships.getActive(tx, businessId, hz.A.adminId, { lock: "share" }), rowShare(tx))),
    ];
    expect([plain, locked]).toEqual([0, 1]);
  });

  it("two accepts of one token: one wins, the other meets a dead link (the conditional UPDATE decides; true concurrency needs a real-Postgres run)", async () => {
    const { businessId } = hz.A;
    const { link, invitation } = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId, role: "collaborator" });
    const [a, b] = [await person("race-accept-a"), await person("race-accept-b")];
    const answers = await Promise.all([refusal(hz.caller(a).invitation.accept({ token: tokenOf(link) })), refusal(hz.caller(b).invitation.accept({ token: tokenOf(link) }))]);
    expect(answers.filter((x) => x === null)).toHaveLength(1);
    expect(answers.filter((x) => x?.code === "NOT_FOUND")).toHaveLength(1);
    const joined = [await membershipOf(businessId, a.userId), await membershipOf(businessId, b.userId)].filter((m) => m !== null);
    expect(joined).toHaveLength(1);
    // The mechanism: once the row is not pending, the UPDATE changes nothing and answers null.
    expect(await repos.invitations.accept(hz.db, invitation.id, a.userId)).toBeNull();
    const [row] = await hz.db.select({ by: invitationsTable.acceptedByUserId }).from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(row!.by).toBe(joined[0]!.userId);
  });

  it("accept against revoke: exactly one of them takes effect (the conditional UPDATEs decide; true concurrency needs a real-Postgres run)", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { link, invitation } = await owner.invitation.create({ businessId, role: "collaborator" });
    const p = await person("race-revoke");
    const [accepted, revoked] = await Promise.all([refusal(hz.caller(p).invitation.accept({ token: tokenOf(link) })), refusal(owner.invitation.revoke({ businessId, invitationId: invitation.id }))]);
    expect([accepted === null, revoked === null].filter(Boolean)).toHaveLength(1);
    const [row] = await hz.db.select({ state: invitationsTable.state }).from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(row!.state).toBe(accepted === null ? "accepted" : "revoked");
    expect((await membershipOf(businessId, p.userId)) !== null).toBe(accepted === null);
    // The mechanism: each UPDATE changes a pending row only.
    expect(await repos.invitations.revoke(hz.db, businessId, invitation.id, hz.A.ownerId)).toBeNull();
    expect(await repos.invitations.accept(hz.db, invitation.id, p.userId)).toBeNull();
  });

  it("an invitation that brought a new person credits the inviter when the person's profile is first created", async () => {
    const { businessId } = hz.A;
    await repos.businesses.commit(hz.db, businessId, { archetype: "b2b_saas" }).catch(() => undefined);
    const page: ProjectPageContent = { pitch: "Bread by bike", about: "Fresh bread.", forWhom: "", stage: "idea", showFounders: false, followForm: false };
    await hz.caller({ userId: hz.A.ownerId }).page.publish({ businessId, content: page });
    const admin = hz.caller({ userId: hz.A.adminId });
    const { link } = await admin.invitation.create({ businessId, role: "collaborator" });
    const p = await person("attributed");
    await hz.caller(p).invitation.accept({ token: tokenOf(link) });
    await hz.caller(p).founder.profile.update({ displayName: "Invited Person", experience: "first_time", skills: { marketing: 5 }, targetMarkets: ["US"], riskAppetite: "medium", via: "u.someone-else" });
    expect(await repos.attributions.forUser(hz.db, p.userId)).not.toBeNull();
    // The project page is live: the row names it, with the inviter credited (not the page's longest-standing owner).
    expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ sourceKind: "project_page", sourceBusinessId: businessId, referrerUserId: hz.A.adminId });
  });
});

describe("after accepting: a cofounder's standing and a collaborator's walls (THESIS_REVIEW 3.3)", () => {
  const join = async (role: "cofounder" | "collaborator", tag: string) => {
    const p = await person(tag);
    const { link } = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId: hz.A.businessId, role, ...(role === "cofounder" ? { email: p.email } : {}) });
    await hz.caller(p).invitation.accept({ token: tokenOf(link) });
    return p;
  };
  const endAccess = (userId: string) => hz.db.update(membershipsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(and(eq(membershipsTable.businessId, hz.A.businessId), eq(membershipsTable.userId, userId)));

  it("a cofounder invites a cofounder, manages the people and reaches Money and Settings like an owner", async () => {
    const { businessId } = hz.A;
    const c = await join("cofounder", "standing");
    const me = hz.caller(c);
    expect((await me.invitation.create({ businessId, role: "cofounder", email: "another-cofounder@example.com" })).invitation.role).toBe("cofounder");
    expect(Array.isArray(await me.invitation.list({ businessId }))).toBe(true);
    expect(await refusal(me.finance.accounts.list({ businessId }))).toBeNull();
    // Changes an admin's role, never their own, and is not removed by an admin.
    expect(await refusal(me.team.humans.role({ businessId, userId: hz.A.viewerId, role: "advisor" }))).toBeNull();
    await me.team.humans.role({ businessId, userId: hz.A.viewerId, role: "viewer" });
    expect((await refusal(me.team.humans.role({ businessId, userId: c.userId, role: "member" })))?.code).toBe("BAD_REQUEST");
    expect((await refusal(hz.caller({ userId: hz.A.adminId }).team.humans.role({ businessId, userId: c.userId, role: "member" })))?.code).toBe("FORBIDDEN");
    expect((await refusal(hz.caller({ userId: hz.A.adminId }).team.humans.role({ businessId, userId: hz.A.memberId, role: "cofounder" })))?.code).toBe("FORBIDDEN");
    expect((await refusal(hz.caller({ userId: hz.A.ownerId }).team.humans.remove({ businessId, userId: c.userId })))?.code).toBe("BAD_REQUEST");
  });

  it("a collaborator works on Product and Customers, reads the plan's notes, and is refused Money, Settings and the people", async () => {
    const { businessId } = hz.A;
    const p = await join("collaborator", "walls");
    const me = hz.caller(p);
    expect(await refusal(me.product.roadmap.list({ businessId }))).toBeNull();
    expect(await refusal(me.crm.search({ businessId, q: "role:customer" }))).toBeNull();
    expect(await refusal(me.inbox.list({ businessId }))).toBeNull();
    for (const call of [me.finance.accounts.list({ businessId }), me.business.audit({ businessId }), me.invitation.list({ businessId }), me.invitation.create({ businessId, role: "collaborator" }), me.team.humans.role({ businessId, userId: hz.A.viewerId, role: "advisor" })]) {
      expect((await refusal(call))?.code).toBe("FORBIDDEN");
    }
    // Section permissions can narrow a collaborator, never widen them past the role.
    await hz.caller({ userId: hz.A.ownerId }).team.humans.role({ businessId, userId: p.userId, sectionPermissions: { finance: "write", crm: "none" } });
    expect((await refusal(me.finance.accounts.list({ businessId })))?.code).toBe("FORBIDDEN");
    expect((await refusal(me.crm.search({ businessId, q: "role:customer" })))?.code).toBe("FORBIDDEN");
  });

  it("a collaborator's access can end on a date; from then the project is closed to them", async () => {
    const { businessId } = hz.A;
    const p = await join("collaborator", "trial");
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect((await refusal(owner.team.humans.role({ businessId, userId: p.userId, expiresAt: new Date(Date.now() - 1000) })))?.code).toBe("BAD_REQUEST");
    expect((await refusal(owner.team.humans.role({ businessId, userId: hz.A.memberId, expiresAt: new Date(Date.now() + 86_400_000) })))?.code).toBe("BAD_REQUEST");
    expect(await owner.team.humans.role({ businessId, userId: p.userId, expiresAt: new Date(Date.now() + 14 * 86_400_000) })).toMatchObject({ role: "collaborator", expiresAt: expect.any(Date) });
    expect(await refusal(hz.caller(p).inbox.list({ businessId }))).toBeNull();
    // The date passes (written on the service connection, as a clock would).
    await endAccess(p.userId);
    expect(await refusal(hz.caller(p).inbox.list({ businessId }))).toMatchObject({ code: "FORBIDDEN", appCode: "not_a_member" });
    expect((await repos.memberships.listForUser(hz.db, p.userId)).some((m) => m.businessId === businessId)).toBe(false);
  });

  it("an ended collaborator is offered nothing: not the business, no invitation to make, never an approver", async () => {
    const { businessId } = hz.A;
    const p = await join("collaborator", "ended-offer");
    await endAccess(p.userId);
    // The business switcher and the account read leave the business out.
    const account = await hz.caller(p).founder.profile.get();
    expect(account.businesses.map((b) => b.id)).not.toContain(businessId);
    expect(account.memberships.map((m) => m.businessId)).not.toContain(businessId);
    expect((await repos.businesses.listForUser(hz.db, p.userId)).map((b) => b.id)).not.toContain(businessId);
    // No invitation through the api.
    expect(await refusal(hz.caller(p).invitation.create({ businessId, role: "collaborator" }))).toMatchObject({ code: "FORBIDDEN", appCode: "not_a_member" });
    // Never chosen as an approver, and an approver chosen while they could is handed back to the founder.
    expect((await refusal(hz.caller({ userId: hz.A.ownerId }).team.responsibilities.set({ businessId, decisionType: "publish_content", handler: { kind: "user", id: p.userId } })))?.code).toBe("BAD_REQUEST");
    const departments = await repos.departments.list(hz.db, businessId);
    const saved = departments.map((d) => ({ id: d.id, approvers: d.approvers }));
    try {
      for (const d of departments) await repos.departments.update(hz.db, businessId, d.id, { approvers: [{ decisionType: "publish_content", handler: { kind: "user", id: p.userId } }] });
      expect(await routeApproval(hz.db, businessId, { decisionType: "publish_content" })).toMatchObject({ handlerKind: null, handlerId: null });
      await hz.db.update(membershipsTable).set({ expiresAt: new Date(Date.now() + 86_400_000) }).where(and(eq(membershipsTable.businessId, businessId), eq(membershipsTable.userId, p.userId)));
      expect(await routeApproval(hz.db, businessId, { decisionType: "publish_content" })).toMatchObject({ handlerKind: "user", handlerId: p.userId });
    } finally {
      for (const d of saved) await repos.departments.update(hz.db, businessId, d.id, { approvers: d.approvers as never });
    }
  });

  it("a collaborator whose access ended can be invited again: the ended row gets a new start", async () => {
    const { businessId } = hz.A;
    const p = await join("collaborator", "come-back");
    const first = await membershipOf(businessId, p.userId);
    await endAccess(p.userId);
    const { link } = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId, role: "collaborator" });
    expect(await hz.caller(p).invitation.accept({ token: tokenOf(link) })).toEqual({ businessId, already: false });
    const renewed = await membershipOf(businessId, p.userId);
    expect(renewed).toMatchObject({ id: first!.id, role: "collaborator", expiresAt: null, source: "invite" });
    expect(await refusal(hz.caller(p).inbox.list({ businessId }))).toBeNull();
    // Someone still in is "already" one of the people: the next link stays unused.
    const again = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId, role: "collaborator" });
    expect(await hz.caller(p).invitation.accept({ token: tokenOf(again.link) })).toEqual({ businessId, already: true });
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(again.link) })).toMatchObject({ state: "pending" });
  });
});
