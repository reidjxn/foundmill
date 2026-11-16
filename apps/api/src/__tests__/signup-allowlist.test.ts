/**
 * SIGNUP_ALLOWLIST (audit 2026-10-12 #26): when set, only the addresses and @domains it names reach anything behind
 * sign-in (no profile, no Ideation, no business, no model call); everyone else gets FORBIDDEN with appCode
 * `not_invited` and a sentence to act on. Unset admits everyone; the development bypass user is always admitted.
 */
import { repos } from "@foundmill/db";
import { MockModelClient } from "@foundmill/models";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createCaller } from "../router";
import { allowlisted, decideAdmission, forgetAdmittedMemo, NOT_INVITED_MESSAGE, ON_WAITLIST_MESSAGE, parseSignupAllowlist, type AdmissionDecision, type AdmissionFacts } from "../services/access";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "allowlist" });
}, 120_000);
afterAll(() => hz.close());

const callerWith = (allowlist: string | undefined, user: { userId: string; email: string | null }, extra: Record<string, unknown> = {}) => createCaller({ ...hz.deps, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: allowlist, ...extra } }, user);

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    const cause = err.cause as { code?: string } | undefined;
    return { code: err.code, appCode: cause?.code, message: err.message };
  }
};

describe("parseSignupAllowlist / allowlisted", () => {
  it("reads addresses and @domains (any case, commas or spaces), and names nobody with a bare word", () => {
    expect(parseSignupAllowlist(undefined)).toBeNull();
    expect(parseSignupAllowlist(" , ")).toBeNull();
    const list = parseSignupAllowlist("Founder@Example.com, @team.example ; other@x.test\n@");
    expect(list && [...list.emails].sort()).toEqual(["founder@example.com", "other@x.test"]);
    expect(list && [...list.domains]).toEqual(["team.example"]);
    expect(allowlisted(list!, "FOUNDER@example.com")).toBe(true);
    expect(allowlisted(list!, "anyone@team.example")).toBe(true);
    // A subdomain or a look-alike is not the listed domain.
    expect(allowlisted(list!, "anyone@sub.team.example")).toBe(false);
    expect(allowlisted(list!, "anyone@evilteam.example")).toBe(false);
    expect(allowlisted(list!, "founder@example.com.evil")).toBe(false);
    expect(allowlisted(list!, null)).toBe(false);
    expect(allowlisted(parseSignupAllowlist("someone")!, "someone@x.test")).toBe(false);
  });
});

describe("protectedProcedure with SIGNUP_ALLOWLIST", () => {
  it("refuses an account the list does not name before any work, with appCode not_invited", async () => {
    const userId = await hz.h.createUser("stranger@elsewhere.test");
    const models = new MockModelClient();
    const stranger = createCaller({ ...hz.deps, models, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "founder@example.com, @team.example" } }, { userId, email: "stranger@elsewhere.test" });
    expect(await refusal(stranger.founder.profile.get())).toEqual({ code: "FORBIDDEN", appCode: "not_invited", message: NOT_INVITED_MESSAGE });
    // WP-03 T1: what the gate says is true in invite-only and open sign-up alike, and asks nothing of an inviter.
    expect(NOT_INVITED_MESSAGE).toBe("Foundmill is letting new people in a few at a time so every project gets real agent work. Your place is not open yet.");
    expect((await refusal(stranger.idea.generate({ prompt: "x" })))?.appCode).toBe("not_invited");
    expect((await refusal(stranger.founder.preferences.get()))?.code).toBe("FORBIDDEN");
    expect(models.history).toHaveLength(0);
    expect(await repos.founders.get(hz.db, userId)).toBeNull();
  });

  it("admits listed addresses and domains, members of a business included; an account without an email is refused", async () => {
    const list = `owner@allowlist-a.example, @allowlist-domain.example`;
    expect(await refusal(callerWith(list, { userId: hz.A.ownerId, email: "Owner@allowlist-a.example" }).founder.preferences.get())).toBeNull();
    expect(await refusal(callerWith(list, { userId: hz.A.memberId, email: "member@allowlist-domain.example" }).inbox.list({ businessId: hz.A.businessId }))).toBeNull();
    // A member of the business whose address is not listed reaches nothing, the business included.
    expect((await refusal(callerWith(list, { userId: hz.A.viewerId, email: "viewer@elsewhere.test" }).inbox.list({ businessId: hz.A.businessId })))?.appCode).toBe("not_invited");
    expect((await refusal(callerWith(list, { userId: hz.A.adminId, email: null }).founder.preferences.get()))?.appCode).toBe("not_invited");
  });

  it("unset admits everyone; the development bypass user is admitted while it is set", async () => {
    expect(await refusal(callerWith(undefined, { userId: hz.B.ownerId, email: "anyone@anywhere.test" }).founder.preferences.get())).toBeNull();
    expect(await refusal(callerWith("", { userId: hz.B.ownerId, email: "anyone@anywhere.test" }).founder.preferences.get())).toBeNull();
    expect(await refusal(callerWith("founder@example.com", { userId: hz.B.ownerId, email: null }, { DEV_AUTH_USER_ID: hz.B.ownerId }).founder.preferences.get())).toBeNull();
    // Signed out stays UNAUTHORIZED (the list is only about who has signed in).
    expect((await refusal(createCaller({ ...hz.deps, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "founder@example.com" } }, null).founder.preferences.get()))?.code).toBe("UNAUTHORIZED");
  });

  it("reaches the browser as 403 with appCode not_invited (what the web's invite-only page reads)", async () => {
    const deps = { ...hz.deps, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "founder@example.com" }, auth: { ...hz.deps.auth, resolve: async () => ({ userId: hz.B.memberId, email: "member@elsewhere.test", authenticatedAt: new Date() }) } } as typeof hz.deps;
    const res = await createApp(deps).request("/trpc/founder.preferences.get", { headers: { authorization: "Bearer x" } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { json: { message: string; data: { code: string; appCode?: string } } } };
    expect(body.error.json).toMatchObject({ message: NOT_INVITED_MESSAGE, data: { code: "FORBIDDEN", appCode: "not_invited" } });
  });
});

/* ---- WP-03 T8: the guards open sign-up needs (one mailbox, one place; a private domain's daily number) ---- */

describe("decideAdmission: open sign-up's guards (WP-03 T8)", () => {
  const open: AdmissionFacts = { mode: "open", devUser: false, listed: false, emailConfirmed: true, admitted: false, existingPerson: false, admittedToday: 0, ceiling: 25, sameAddressAdmitted: false, domainAdmittedToday: 0, domainCeiling: 5 };
  const cases: [string, Partial<AdmissionFacts>, AdmissionDecision][] = [
    ["a new address of a private domain under its number: admitted", { domainAdmittedToday: 4 }, { outcome: "admit", record: "open" }],
    ["the same mailbox already admitted: waits", { sameAddressAdmitted: true }, { outcome: "wait", reason: "ceiling" }],
    ["the sixth address of a private domain today: waits", { domainAdmittedToday: 5 }, { outcome: "wait", reason: "ceiling" }],
    ["the sixth gmail.com address is admitted while the day's ceiling has room", { domainAdmittedToday: 5, domainCeiling: null, admittedToday: 24 }, { outcome: "admit", record: "open" }],
    ["a common domain still meets the day's ceiling", { domainCeiling: null, admittedToday: 25 }, { outcome: "wait", reason: "ceiling" }],
    ["a listed address is untouched", { listed: true, sameAddressAdmitted: true, domainAdmittedToday: 99 }, { outcome: "admit", record: null }],
    ["an account already admitted is untouched", { admitted: true, sameAddressAdmitted: true, domainAdmittedToday: 99 }, { outcome: "admit", record: null }],
    ["a person from before is untouched", { existingPerson: true, sameAddressAdmitted: true, domainAdmittedToday: 99 }, { outcome: "admit", record: "existing" }],
    ["invite-only never reads the new facts", { mode: "invite_only", sameAddressAdmitted: true, domainAdmittedToday: 99 }, { outcome: "refuse", reason: "not_listed" }],
  ];
  it.each(cases)("%s", (_name, over, want) => expect(decideAdmission({ ...open, ...over })).toEqual(want));
});

describe("admitOrWait: open sign-up's guards against one person with many addresses (WP-03 T8)", () => {
  const todayStart = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const OPEN = (extra: Record<string, unknown> = {}) => ({ SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: 1000, SIGNUP_PER_DOMAIN_PER_DAY: 2, ...extra });
  const signIn = (email: string, env: Record<string, unknown>) =>
    hz.h.createUser(email).then((userId) => ({ userId, run: refusal(createCaller({ ...hz.deps, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: undefined, ...env } }, { userId, email, emailConfirmed: true }).founder.preferences.get()) }));
  beforeEach(() => forgetAdmittedMemo());

  it("a second account from the same mailbox (+tag, Gmail's dots) waits on the list; the key is kept on the admission", async () => {
    const first = await signIn("Same.Person@gmail.com", OPEN());
    expect(await first.run).toBeNull();
    expect((await repos.admissions.forUser(hz.db, first.userId))?.addressKey).toBe("sameperson@gmail.com");
    for (const again of ["sameperson+2@gmail.com", "same.person@googlemail.com"]) {
      const p = await signIn(again, OPEN());
      expect(await p.run).toMatchObject({ code: "FORBIDDEN", appCode: "on_waitlist" });
      expect(await repos.admissions.has(hz.db, p.userId)).toBe(false);
    }
  });

  it("a private domain past its daily number waits; a common provider does not count by domain; a listed address is not counted", async () => {
    for (const n of [1, 2]) expect(await (await signIn(`p${n}@guards-corp.test`, OPEN())).run).toBeNull();
    const third = await signIn("p3@guards-corp.test", OPEN());
    expect(await third.run).toMatchObject({ appCode: "on_waitlist", message: ON_WAITLIST_MESSAGE });
    expect(await repos.admissions.openSinceForDomain(hz.db, todayStart(), "guards-corp.test")).toBe(2);
    // Another domain, and a subdomain, have their own numbers.
    expect(await (await signIn("p1@other.guards-corp.test", OPEN())).run).toBeNull();
    for (const n of [1, 2, 3]) expect(await (await signIn(`guards-common-${n}@outlook.com`, OPEN())).run).toBeNull();
    const listed = await signIn("boss@guards-corp.test", OPEN({ SIGNUP_ALLOWLIST: "boss@guards-corp.test" }));
    expect(await listed.run).toBeNull();
    // A higher number lets the waiting person in on their next request.
    expect(await refusal(createCaller({ ...hz.deps, env: { ...hz.deps.env, ...OPEN({ SIGNUP_PER_DOMAIN_PER_DAY: 3 }) } }, { userId: third.userId, email: "p3@guards-corp.test", emailConfirmed: true }).founder.preferences.get())).toBeNull();
  });

  it("the guards' reads happen under the lock, only in open mode and only for someone not yet admitted", async () => {
    const order: string[] = [];
    const lock = repos.admissions.lockOpenCount.bind(repos.admissions);
    const key = repos.admissions.keyTaken.bind(repos.admissions);
    const domain = repos.admissions.openSinceForDomain.bind(repos.admissions);
    const spies = [
      vi.spyOn(repos.admissions, "lockOpenCount").mockImplementation(async (tx) => (order.push("lock"), lock(tx))),
      vi.spyOn(repos.admissions, "keyTaken").mockImplementation(async (db, k) => (order.push("key"), key(db, k))),
      vi.spyOn(repos.admissions, "openSinceForDomain").mockImplementation(async (db, s, d) => (order.push("domain"), domain(db, s, d))),
    ];
    try {
      const p = await signIn("lock-order@guards-lock.test", OPEN());
      expect(await p.run).toBeNull();
      expect(order).toEqual(["lock", "key", "domain"]);
      order.length = 0;
      forgetAdmittedMemo();
      // Already admitted: nothing to read.
      expect(await refusal(createCaller({ ...hz.deps, env: { ...hz.deps.env, ...OPEN() } }, { userId: p.userId, email: "lock-order@guards-lock.test", emailConfirmed: true }).founder.preferences.get())).toBeNull();
      // Invite-only: never read.
      const q = await signIn("invite-only@guards-lock.test", { SIGNUP_ALLOWLIST: "someone@else.test" });
      expect(await q.run).toMatchObject({ appCode: "not_invited" });
      expect(order).toEqual([]);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
