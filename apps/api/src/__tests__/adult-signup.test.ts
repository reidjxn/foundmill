/**
 * "I am 18 or older", once, at sign-up, for the whole product (services/adults.ts; 0104). A new account cannot create
 * its profile, start a project or join one without the confirmation; it is recorded once, on the account, by the
 * `adult_confirmation` step of `onPersonCreated`; a person the network already asked (`network_attestations`) is never
 * asked again; a person from before is asked once (`founder.adult.confirm`); and going LIVE accepts the sign-up
 * confirmation without asking.
 */
import { repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADULT_UNCONFIRMED_CODE, ADULT_UNCONFIRMED_MESSAGE } from "../services/adults";
import { PERSON_CREATED_STEPS } from "../services/person-created";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "adult-signup", env: { LIVE_MODE: "1" } });
}, 120_000);
afterAll(() => hz?.close());

let n = 0;
/** A signed-in account with no profile and no confirmation yet. */
async function newcomer() {
  n += 1;
  const email = `adult-signup-${n}@test.local`;
  const userId = await hz.h.createUser(email);
  return { userId, me: hz.caller({ userId, email }) };
}
const answer = { displayName: "Newcomer", experience: "first_time", skills: { marketing: 8 }, targetMarkets: ["US"], riskAppetite: "medium" };
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => ({ code: "OK" }),
    (err: { code?: string; message?: string; cause?: { code?: string } }) => ({ code: err.code, appCode: err.cause?.code, message: err.message }),
  );
const rowsOf = async (userId: string) => ((await hz.db.execute(sql`select confirmed_at from adult_confirmations where user_id = ${userId}::uuid`)) as unknown as { rows: { confirmed_at: unknown }[] }).rows;
const tokenOf = (link: string) => link.split("/i/")[1]!;

describe("a new account confirms at sign-up", () => {
  it("the confirmation is one of the steps that run once a profile is created", () => {
    expect(PERSON_CREATED_STEPS.map((s) => s.name)).toContain("adult_confirmation");
  });

  it("cannot create its profile without confirming: nothing is saved, and the refusal has its own code", async () => {
    const p = await newcomer();
    expect(await refusal(p.me.founder.profile.update(answer))).toEqual({ code: "FORBIDDEN", appCode: ADULT_UNCONFIRMED_CODE, message: ADULT_UNCONFIRMED_MESSAGE });
    expect(await repos.founders.get(hz.db, p.userId)).toBeNull();
    expect(await rowsOf(p.userId)).toEqual([]);
    expect(await p.me.founder.profile.get()).toMatchObject({ complete: false, adultConfirmed: false });
    expect(await p.me.founder.adult.get()).toEqual({ confirmed: false, confirmedAt: null });
  });

  it("creates it with the box ticked: the step records the confirmation once, with the database's time", async () => {
    const p = await newcomer();
    const before = Date.now() - 60_000;
    await p.me.founder.profile.update({ ...answer, confirmAdult: true });
    expect(await p.me.founder.profile.get()).toMatchObject({ complete: true, adultConfirmed: true });
    const first = await p.me.founder.adult.get();
    expect(first.confirmed).toBe(true);
    expect(Date.parse(first.confirmedAt!)).toBeGreaterThan(before);
    // Asking again, or a later save that carries it, writes nothing: the first confirmation stands.
    expect(await p.me.founder.adult.confirm({ confirm: true })).toEqual({ confirmed: true, confirmedAt: first.confirmedAt });
    await p.me.founder.profile.update({ displayName: "Renamed", confirmAdult: true });
    expect(await rowsOf(p.userId)).toHaveLength(1);
    expect(await p.me.founder.adult.get()).toEqual(first);
  });

  it("can start a project once confirmed, and not before", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ ...answer, confirmAdult: true });
    const [idea] = (await p.me.idea.generate({ prompt: "meal plans for night-shift nurses" })).ideas;
    expect((await p.me.idea.commit({ ideaId: idea!.id, name: "Night Meals", archetype: "b2b_saas" })).business.gameMode).toBe("personal");
  });

  it("only true confirms: no other value is accepted", async () => {
    const p = await newcomer();
    await expect(p.me.founder.profile.update({ ...answer, confirmAdult: false as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.me.founder.adult.confirm({ confirm: false as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await rowsOf(p.userId)).toEqual([]);
    await expect(hz.caller(null).founder.adult.confirm({ confirm: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(hz.caller(null).founder.adult.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("nobody who confirmed is asked twice", () => {
  it("a person the network already asked creates their profile without the box, and reads as confirmed", async () => {
    const p = await newcomer();
    // As the network recorded it before 0104 (the api now writes the account's record; this table is still read).
    await hz.db.execute(sql`insert into network_attestations (user_id) values (${p.userId}::uuid)`);
    expect((await p.me.founder.adult.get()).confirmed).toBe(true);
    await p.me.founder.profile.update(answer);
    expect(await p.me.founder.profile.get()).toMatchObject({ complete: true, adultConfirmed: true });
    expect(await rowsOf(p.userId)).toHaveLength(1);
  });

  it("the network's own confirmation and the sign-up one are the same record", async () => {
    const p = await newcomer();
    await p.me.founder.profile.update({ ...answer, confirmAdult: true });
    expect((await p.me.live.summary()).adultConfirmed).toBe(true);
    const { adultConfirmedAt } = await p.me.live.profile.confirmAdult({ confirm: true });
    expect(adultConfirmedAt.toISOString()).toBe((await p.me.founder.adult.get()).confirmedAt);
  });

  it("going LIVE accepts the sign-up confirmation without asking", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    await expect(owner.business.setGameMode({ businessId, gameMode: "live" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.founder.adult.confirm({ confirm: true });
    expect((await owner.business.setGameMode({ businessId, gameMode: "live" })).gameMode).toBe("live");
    expect(await rowsOf(ownerId)).toHaveLength(1);
    await owner.business.setGameMode({ businessId, gameMode: "personal" });
  });
});

describe("a person from before is asked once", () => {
  it("has a profile and no confirmation: is told so, confirms once, and is not asked again", async () => {
    const p = await newcomer();
    await repos.founders.upsert(hz.db, p.userId, { displayName: "From Before" });
    expect(await p.me.founder.profile.get()).toMatchObject({ complete: true, adultConfirmed: false });
    const [idea] = (await p.me.idea.generate({ prompt: "repair cafe bookings" })).ideas;
    expect(await refusal(p.me.idea.commit({ ideaId: idea!.id, name: "Repair Cafe", archetype: "b2b_saas" }))).toMatchObject({ code: "FORBIDDEN", appCode: ADULT_UNCONFIRMED_CODE });
    await p.me.founder.adult.confirm({ confirm: true });
    expect(await p.me.founder.profile.get()).toMatchObject({ adultConfirmed: true });
    expect((await p.me.idea.commit({ ideaId: idea!.id, name: "Repair Cafe", archetype: "b2b_saas" })).business.gameMode).toBe("personal");
  });
});

describe("an invitee is asked too, once", () => {
  it("cannot join without confirming; ticks it on the invitation, joins, and is not asked again for the profile", async () => {
    const { link } = await hz.caller({ userId: hz.A.ownerId }).invitation.create({ businessId: hz.A.businessId, role: "collaborator" });
    const p = await newcomer();
    expect(await refusal(p.me.invitation.accept({ token: tokenOf(link) }))).toMatchObject({ code: "FORBIDDEN", appCode: ADULT_UNCONFIRMED_CODE });
    expect(await repos.memberships.get(hz.db, hz.A.businessId, p.userId)).toBeNull();
    expect(await p.me.invitation.accept({ token: tokenOf(link), confirmAdult: true })).toMatchObject({ businessId: hz.A.businessId, already: false });
    expect((await p.me.founder.adult.get()).confirmed).toBe(true);
    // The profile that follows needs no second confirmation.
    await p.me.founder.profile.update(answer);
    expect(await p.me.founder.profile.get()).toMatchObject({ complete: true, adultConfirmed: true });
    expect(await rowsOf(p.userId)).toHaveLength(1);
  });

  it("a dead link answers as before, whatever the box says, and records nothing", async () => {
    const p = await newcomer();
    expect(await refusal(p.me.invitation.accept({ token: "no-such-token" }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rowsOf(p.userId)).toEqual([]);
  });
});
