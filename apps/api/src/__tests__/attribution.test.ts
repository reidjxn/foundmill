/**
 * Who or what brought a new person (services/attribution.ts; migration 0086; docs/NETWORK.md §5, §11):
 * `founder.profile.update` takes `via` on the save that creates the profile and records it once.
 *
 * Recorded for a public project page (the business and its longest-standing owner) and for a public person profile
 * (that person); ignored, silently, when the value is not a reference, names nothing public (unknown, a draft, a
 * private profile, a sample business), names the person themselves, or arrives a second time; the answer is the same
 * in every case; the value is never logged; and no `signup.attributed` row is written to `events` or `outbox` (the
 * event is declared, and has no account-level transport yet).
 */
import { attributions, repos, type Db } from "@foundmill/db";
import { EVENTS } from "@foundmill/events";
import { VIA_MAX_LENGTH } from "@foundmill/shared/via";
import type { PersonProfileContent, ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordSignupAttribution, signupAttributedPayload } from "../services/attribution";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
/** A person with a public profile at /u/sam-lee. */
let sam: string;

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Bread by bike", about: "Fresh bread delivered.", forWhom: "", stage: "building", showFounders: false, followForm: false, ...over });
const person = (over: Partial<PersonProfileContent> = {}): PersonProfileContent => ({ headline: "Baker", about: "I bake bread.", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "", ...over });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await hz.db.execute(q)) as unknown as { rows: T[] }).rows;
const eventCounts = async () => (await rows<{ events: number; outbox: number }>(sql`select (select count(*)::int from events) as events, (select count(*)::int from outbox) as outbox`))[0]!;
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
  await repos.founders.upsert(hz.db, sam, { displayName: "Sam Lee" });
  await repos.personProfiles.save(hz.db, sam, { handle: "sam-lee", content: person() });
  await repos.personProfiles.publish(hz.db, sam);
}, 120_000);
afterAll(() => hz?.close());

describe("founder.profile.update records who or what brought a new person", () => {
  it("a project's public page: the business and its longest-standing owner", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ userId: p.userId, sourceKind: "project_page", sourceRef: "bread-by-bike", sourceBusinessId: hz.A.businessId, referrerUserId: hz.A.ownerId });
  });

  it("a person's public profile: that person, and no business", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ ...answer, via: "u.sam-lee" });
    expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ sourceKind: "person_profile", sourceRef: "sam-lee", sourceBusinessId: null, referrerUserId: sam });
  });

  it("no reference, nothing recorded", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update(answer);
    expect(await repos.attributions.forUser(hz.db, p.userId)).toBeNull();
  });

  it("a value that is not a reference is ignored without an error", async () => {
    for (const via of ["", "bread-by-bike", "x.bread-by-bike", "p.", "p.Bread-By-Bike", "p.bread by bike", "p.-bread", "u.sam_lee", "p.bread-by-bike?x=1", "p.x'; drop table attributions; --"]) {
      const p = await newcomer();
      await p.me.founder.profile.update({ ...answer, via });
      expect(await repos.attributions.forUser(hz.db, p.userId), via).toBeNull();
    }
  });

  it("a reference that names nothing public is ignored: unknown, a draft page, a private profile, the wrong kind", async () => {
    const priv = await hz.h.createUser("attribution-private@test.local");
    await repos.founders.upsert(hz.db, priv, { displayName: "Pat Private" });
    await repos.personProfiles.save(hz.db, priv, { handle: "pat-private", content: person() });
    for (const via of ["p.no-such-page", "u.no-such-person", "p.still-a-draft", "u.pat-private", "u.bread-by-bike", "p.sam-lee"]) {
      const p = await newcomer();
      await p.me.founder.profile.update({ ...answer, via });
      expect(await repos.attributions.forUser(hz.db, p.userId), via).toBeNull();
    }
  });

  it("a sample business never resolves, even with a published page", async () => {
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${hz.A.businessId}`);
    try {
      const p = await newcomer();
      await p.me.founder.profile.update({ ...answer, via: "p.bread-by-bike" });
      expect(await repos.attributions.forUser(hz.db, p.userId)).toBeNull();
    } finally {
      await hz.db.execute(sql`update businesses set is_demo = false where id = ${hz.A.businessId}`);
    }
  });

  it("nobody brings themselves: the page's own longest-standing owner records nothing", async () => {
    // The fixture's owner has a business and a published page, and no profile yet.
    const owner = hz.caller({ userId: hz.A.ownerId, email: "attribution-a-owner@test.local" });
    await owner.founder.profile.update({ ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, hz.A.ownerId)).toBeNull();
    // Another member of the same project was brought by it, and its first owner is credited.
    const member = hz.caller({ userId: hz.A.memberId, email: "attribution-a-member@test.local" });
    await member.founder.profile.update({ ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, hz.A.memberId)).toMatchObject({ sourceBusinessId: hz.A.businessId, referrerUserId: hz.A.ownerId });
  });

  it("only once: a later save ignores a reference, and an account that already has one keeps it", async () => {
    // Created with no reference: a later save that carries one records nothing (the profile already exists).
    const late = await newcomer();
    await late.me.founder.profile.update(answer);
    await late.me.founder.profile.update({ displayName: "Later", via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, late.userId)).toBeNull();

    // Created through the page: a later save naming a person changes nothing.
    const first = await newcomer();
    await first.me.founder.profile.update({ ...answer, via: "p.bread-by-bike" });
    const recorded = await repos.attributions.forUser(hz.db, first.userId);
    const edited = await first.me.founder.profile.update({ displayName: "Renamed", via: "u.sam-lee" });
    expect(edited).toMatchObject({ displayName: "Renamed" });
    expect(edited).not.toHaveProperty("via");
    expect(await repos.attributions.forUser(hz.db, first.userId)).toEqual(recorded);

    // An account that somehow has an attribution before its profile keeps the first.
    const early = await newcomer();
    await repos.attributions.record(hz.db, early.userId, { kind: "person_profile", ref: "sam-lee", businessId: null, referrerUserId: sam });
    await early.me.founder.profile.update({ ...answer, via: "p.bread-by-bike" });
    expect(await repos.attributions.forUser(hz.db, early.userId)).toMatchObject({ sourceKind: "person_profile", sourceRef: "sam-lee" });
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from attributions where user_id = ${early.userId}`))[0]!.n).toBe(1);
  });

  it("the answer is the same whether a reference was given, was one, resolved, or was recorded", async () => {
    const answers: Record<string, unknown>[] = [];
    for (const via of [undefined, "", "not a reference", "p.no-such-page", "u.no-such-person", "p.still-a-draft", "p.bread-by-bike", "u.sam-lee"]) {
      const p = await newcomer();
      answers.push(comparable(await p.me.founder.profile.update({ ...answer, ...(via === undefined ? {} : { via }) })));
    }
    for (const other of answers.slice(1)) expect(other).toEqual(answers[0]);
    expect(answers[0]).toMatchObject({ displayName: "Newcomer", guidanceTurnedOff: false });
    expect(JSON.stringify(answers)).not.toMatch(/via|bread-by-bike|sam-lee|attribut/);
  });

  it("the input is bounded: a value longer than any reference is refused before anything is read", async () => {
    const p = await newcomer();
    expect(await code(p.me.founder.profile.update({ ...answer, via: `p.${"a".repeat(VIA_MAX_LENGTH)}` }))).toBe("BAD_REQUEST");
    // The longest reference there can be is accepted (and names nothing here).
    await p.me.founder.profile.update({ ...answer, via: `p.${"a".repeat(VIA_MAX_LENGTH - 2)}` });
    expect(await repos.attributions.forUser(hz.db, p.userId)).toBeNull();
  });

  it("signed out is refused", async () => {
    expect(await code(hz.caller(null).founder.profile.update({ ...answer, via: "p.bread-by-bike" }))).toBe("UNAUTHORIZED");
  });
});

describe("signup.attributed", () => {
  it("is declared, and every recorded row is one it can carry", async () => {
    expect(EVENTS["signup.attributed"].narratable).toBe(false);
    const p = await newcomer();
    await p.me.founder.profile.update({ ...answer, via: "u.sam-lee" });
    const row = (await repos.attributions.forUser(hz.db, p.userId))!;
    expect(signupAttributedPayload(row)).toEqual({ userId: p.userId, sourceKind: "person_profile", sourceRef: "sam-lee", sourceBusinessId: null, referrerUserId: sam });
    for (const stored of await hz.db.select().from(attributions)) expect(() => signupAttributedPayload(stored)).not.toThrow();
  });

  it("writes no event row yet: nothing reaches `events` or `outbox`, for a page or for a person", async () => {
    // Events are business-scoped and readable by a business's members; a new person has no business (see the service).
    const before = await eventCounts();
    const viaPage = await newcomer();
    await viaPage.me.founder.profile.update({ ...answer, via: "p.bread-by-bike" });
    const viaPerson = await newcomer();
    await viaPerson.me.founder.profile.update({ ...answer, via: "u.sam-lee" });
    expect(await repos.attributions.forUser(hz.db, viaPage.userId)).not.toBeNull();
    expect(await repos.attributions.forUser(hz.db, viaPerson.userId)).not.toBeNull();
    expect(await eventCounts()).toEqual(before);
    expect(await rows(sql`select 1 from events where type = 'signup.attributed'`)).toEqual([]);
    expect(await rows(sql`select 1 from outbox o join events e on e.id = o.event_id where e.type = 'signup.attributed'`)).toEqual([]);
    // Nothing about either new person sits in the source project's events.
    expect(await rows(sql`select 1 from events where business_id = ${hz.A.businessId} and (payload::text like ${`%${viaPage.userId}%`} or actor::text like ${`%${viaPage.userId}%`})`)).toEqual([]);
  });
});

describe("recordSignupAttribution", () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, log: pino({ level: "debug" }, { write: (line: string) => void lines.push(line) }) };
  };

  it("never logs the value: not when it records, not when it ignores, not when the database fails", async () => {
    const { lines, log } = capture();
    const p = await newcomer();
    await recordSignupAttribution({ db: hz.db, log }, p.userId, "p.bread-by-bike");
    expect(await repos.attributions.forUser(hz.db, p.userId)).not.toBeNull();
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
