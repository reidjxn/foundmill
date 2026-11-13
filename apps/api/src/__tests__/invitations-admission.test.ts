/**
 * The way in (THESIS_REVIEW packages 2.2 and 3.1; docs/NETWORK.md F5; 0089): the admit decision in every mode
 * (services/access.ts), and invitations to a project (services/invitations.ts), with the attribution an accepted
 * invitation brings.
 */
import { createHash } from "node:crypto";
import { repos } from "@foundmill/db";
import { ON_WAITLIST_WORDS, type ProjectPageContent } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invitations as invitationsTable } from "@foundmill/db";
import type { CallerUser } from "../context";
import { createCaller } from "../router";
import { decideAdmission, forgetAdmittedMemo, ON_WAITLIST_MESSAGE, type AdmissionFacts } from "../services/access";
import type { GatewayAddressEmailRequest, GatewayNotifyEmailRequest } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const addressed: GatewayAddressEmailRequest[] = [];
const notified: GatewayNotifyEmailRequest[] = [];

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "people" });
  hz.deps.gateway.addressEmail = async (input) => (addressed.push(input), { sent: true, simulated: true, eventId: null });
  hz.deps.gateway.notifyEmail = async (input) => (notified.push(input), { sent: true, simulated: true, eventId: null });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => {
  hz.limits.reset();
  addressed.length = 0;
  notified.length = 0;
  forgetAdmittedMemo();
});

const INVITE_ONLY = { SIGNUP_ALLOWLIST: "listed@people.test" };
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

  it("a valid invitation is an admission: an account the list does not name accepts it and is in, its live channels too", async () => {
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
    // A person who was here before (a founder profile) is in without counting; so is a listed address.
    const fromBefore = await person("from-before");
    await repos.founders.upsert(hz.db, fromBefore.userId, { displayName: "From Before" });
    expect(await refusal(callerIn(OPEN, fromBefore).founder.preferences.get())).toBeNull();
    expect((await repos.admissions.forUser(hz.db, fromBefore.userId))?.how).toBe("existing");
    const listed = { userId: await hz.h.createUser("listed-open@people.test"), email: "listed-open@people.test" };
    expect(await refusal(callerIn(OPEN, listed).founder.preferences.get())).toBeNull();
    expect(await repos.admissions.openSince(hz.db, todayStart())).toBe(before + 2);
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
    expect((await refusal(hz.caller({ userId: hz.A.adminId }).invitation.create({ businessId, role: "cofounder" })))?.code).toBe("FORBIDDEN");
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

  it("accept: one membership, once, audited, with invitation.accepted and membership.changed; the inviter is emailed", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { link, invitation } = await owner.invitation.create({ businessId, role: "cofounder" });
    const p = await person("cofounder");
    expect(await hz.caller(p).invitation.accept({ token: tokenOf(link) })).toEqual({ businessId, already: false });
    expect(await repos.memberships.get(hz.db, businessId, p.userId)).toMatchObject({ role: "owner", source: "invite" });
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
