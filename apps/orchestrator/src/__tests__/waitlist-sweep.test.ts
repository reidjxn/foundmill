/**
 * The waitlist's sweep (WP-03 T2, activities/waitlist.ts): the day's number admits the oldest sign-ups, SIGNUP_OPEN's
 * ceiling bounds it, everyone admitted (by the sweep or by hand) is emailed once, and a refusal that may pass leaves
 * the entry to be asked again. Each test runs on its own UTC day, so the day's counts are its own.
 */
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWaitlistActivities, waitlistEnvWarning } from "../activities/waitlist";
import type { AccountEmailRequest, GatewayClient, NotifyEmailResponse } from "../gateway-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "waitlist" });
}, 120_000);
afterAll(async () => {
  await t?.close();
});

let n = 0;
async function waiting(at: string) {
  const email = `wait-sweep-${++n}@test.local`;
  const userId = await t.h.createUser(email);
  const [row] = await t.h.db.insert(s.waitlistEntries).values({ userId, email, createdAt: new Date(at), updatedAt: new Date(at) }).returning();
  return row!;
}
const entryOf = async (id: string) => (await t.h.pg.query<{ admitted_at: Date | null; notified_at: Date | null }>("select admitted_at, notified_at from waitlist_entries where id = $1", [id])).rows[0]!;
/** A gateway that answers every account email with `answer`, and records the asks. */
function gatewayAnswering(answer: NotifyEmailResponse): GatewayClient & { asked: AccountEmailRequest[] } {
  const asked: AccountEmailRequest[] = [];
  return { ...t.gateway, asked, accountEmail: async (input) => (asked.push(input), answer) };
}
const sweep = (env: Partial<typeof t.deps.env>, gateway: GatewayClient = t.gateway) => createWaitlistActivities({ ...t.deps, gateway, env: { ...t.deps.env, ...env } });

describe("waitlistEnvWarning (the orchestrator's boot)", () => {
  it("warns only when the waitlist admits by number and SIGNUP_OPEN is not on here", () => {
    expect(waitlistEnvWarning({ WAITLIST_ADMIT_PER_DAY: 5 })).toMatch(/SIGNUP_OPEN and SIGNUP_DAILY_CEILING here to the api's values/);
    expect(waitlistEnvWarning({ WAITLIST_ADMIT_PER_DAY: 5, SIGNUP_ALLOWLIST: "a@b.test" })).not.toBeNull();
    expect(waitlistEnvWarning({ WAITLIST_ADMIT_PER_DAY: 5, SIGNUP_OPEN: "1" })).toBeNull();
    expect(waitlistEnvWarning({ WAITLIST_ADMIT_PER_DAY: 0 })).toBeNull();
    expect(waitlistEnvWarning({})).toBeNull();
  });
});

describe("waitlistSweep", () => {
  it("with the number unset (0) admits nobody, and still emails someone the operator admitted by hand", async () => {
    const at = "2030-01-01T12:00:00.000Z";
    const nobody = await waiting("2029-12-01T00:00:00.000Z");
    const byHand = await waiting("2029-12-02T00:00:00.000Z");
    await repos.admissions.record(t.db, { userId: byHand.userId!, how: "waitlist", at: new Date("2030-01-01T11:00:00Z") });
    await t.h.pg.query("update waitlist_entries set admitted_at = $1 where id = $2", [new Date("2030-01-01T11:00:00Z"), byHand.id]);
    const gateway = gatewayAnswering({ sent: true, simulated: true, eventId: null });
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }, gateway).waitlistSweep({ at });
    expect((await entryOf(nobody.id)).admitted_at).toBeNull();
    expect(gateway.asked).toEqual([{ kind: "waitlist_admitted", userId: byHand.userId, data: { waitlistEntryId: byHand.id } }]);
    expect((await entryOf(byHand.id)).notified_at).not.toBeNull();
    // Told once: the next sweep asks nobody.
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }, gateway).waitlistSweep({ at });
    expect(gateway.asked).toHaveLength(1);
    await t.h.pg.query("update waitlist_entries set admitted_at = $1, notified_at = $1 where id = $2", [new Date("2029-01-01T00:00:00Z"), nobody.id]);
  });

  it("a number of 2 admits the two oldest that day, records account.admitted once each, and emails them", async () => {
    const at = "2030-01-02T12:00:00.000Z";
    const a = await waiting("2029-12-03T00:00:00.000Z");
    const b = await waiting("2029-12-04T00:00:00.000Z");
    const c = await waiting("2029-12-05T00:00:00.000Z");
    const gateway = gatewayAnswering({ sent: true, simulated: true, eventId: null });
    const result = await sweep({ WAITLIST_ADMIT_PER_DAY: 2 }, gateway).waitlistSweep({ at });
    expect(result.eventIds).toHaveLength(2);
    expect((await entryOf(a.id)).admitted_at).not.toBeNull();
    expect((await entryOf(b.id)).admitted_at).not.toBeNull();
    expect((await entryOf(c.id)).admitted_at).toBeNull();
    expect(gateway.asked.map((r) => r.data.waitlistEntryId).sort()).toEqual([a.id, b.id].sort());
    expect((await repos.admissions.forUser(t.db, a.userId!))?.how).toBe("waitlist");
    const events = await t.h.pg.query<{ how: string }>("select payload->>'how' as how from account_events where user_id = $1 and type = 'account.admitted'", [a.userId]);
    expect(events.rows.map((r) => r.how)).toEqual(["waitlist"]);
    // The day's two are taken: a later sweep the same day admits nobody more.
    await sweep({ WAITLIST_ADMIT_PER_DAY: 2 }, gateway).waitlistSweep({ at: "2030-01-02T18:00:00.000Z" });
    expect((await entryOf(c.id)).admitted_at).toBeNull();
    // The next day it does.
    await sweep({ WAITLIST_ADMIT_PER_DAY: 2 }, gateway).waitlistSweep({ at: "2030-01-03T00:30:00.000Z" });
    expect((await entryOf(c.id)).admitted_at).not.toBeNull();
  });

  it("under open sign-up, what is left of the day's ceiling bounds the number", async () => {
    const at = "2030-01-05T12:00:00.000Z";
    const a = await waiting("2029-12-06T00:00:00.000Z");
    const b = await waiting("2029-12-07T00:00:00.000Z");
    await sweep({ WAITLIST_ADMIT_PER_DAY: 5, SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: 1 }).waitlistSweep({ at });
    expect((await entryOf(a.id)).admitted_at).not.toBeNull();
    expect((await entryOf(b.id)).admitted_at).toBeNull();
    await sweep({ WAITLIST_ADMIT_PER_DAY: 5, SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: 0 }).waitlistSweep({ at: "2030-01-06T12:00:00.000Z" });
    expect((await entryOf(b.id)).admitted_at).toBeNull();
    await t.h.pg.query("update waitlist_entries set admitted_at = $1, notified_at = $1 where id = $2", [new Date("2029-01-01T00:00:00Z"), b.id]);
  });

  it("an entry whose account was already in takes no place of the day and is not emailed", async () => {
    const at = "2030-01-07T12:00:00.000Z";
    const already = await waiting("2029-12-09T00:00:00.000Z");
    const next = await waiting("2029-12-10T00:00:00.000Z");
    await repos.admissions.record(t.db, { userId: already.userId!, how: "existing" });
    const gateway = gatewayAnswering({ sent: true, simulated: true, eventId: null });
    const result = await sweep({ WAITLIST_ADMIT_PER_DAY: 1 }, gateway).waitlistSweep({ at });
    expect(result.eventIds).toHaveLength(0);
    expect((await entryOf(already.id)).notified_at).not.toBeNull();
    // The one place of the day is still free: the next sweep the same day admits the next person, and only they are told.
    await sweep({ WAITLIST_ADMIT_PER_DAY: 1 }, gateway).waitlistSweep({ at: "2030-01-07T12:15:00.000Z" });
    expect((await entryOf(next.id)).admitted_at).not.toBeNull();
    expect(gateway.asked.map((r) => r.data.waitlistEntryId)).toEqual([next.id]);
  });

  it("a refusal that may pass leaves the entry to be asked again; one that will not is recorded", async () => {
    const at = "2030-01-08T12:00:00.000Z";
    const e = await waiting("2029-12-08T00:00:00.000Z");
    for (const reason of ["off", "unconfigured", "simulated", "per_address", "ceiling", "store", "vendor"]) {
      await sweep({ WAITLIST_ADMIT_PER_DAY: 1 }, gatewayAnswering({ sent: false, reason, message: "not sent" })).waitlistSweep({ at });
      expect((await entryOf(e.id)).notified_at, reason).toBeNull();
    }
    expect((await entryOf(e.id)).admitted_at).not.toBeNull();
    await sweep({ WAITLIST_ADMIT_PER_DAY: 1 }, gatewayAnswering({ sent: false, reason: "suppressed", message: "not sent" })).waitlistSweep({ at });
    expect((await entryOf(e.id)).notified_at).not.toBeNull();
  });

  /* ---- Batches (0145; WP-14 T15) ---- */
  const batch = async (number: number, opensOn: string, places: number) => (await t.h.db.insert(s.waitlistBatches).values({ number, opensOn, places }).returning())[0]!;
  const batchOf = async (id: string) => (await t.h.pg.query<{ batch_id: string | null }>("select batch_id from waitlist_entries where id = $1", [id])).rows[0]!.batch_id;
  const left = async (day: string) => (await repos.waitlist.batchesWithPlaces(t.db, { day })).map((b) => [b.number, b.placesLeft, b.open]);

  it("a batch admits nobody before its day, and on its day admits its places in the waitlist's order with the number at 0", async () => {
    const a = await waiting("2029-12-11T00:00:00.000Z");
    const b = await waiting("2029-12-12T00:00:00.000Z");
    const c = await waiting("2029-12-13T00:00:00.000Z");
    const one = await batch(1, "2030-02-02", 2);
    const gateway = gatewayAnswering({ sent: true, simulated: true, eventId: null });
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }, gateway).waitlistSweep({ at: "2030-02-01T23:59:00.000Z" });
    expect((await entryOf(a.id)).admitted_at).toBeNull();
    expect(await left("2030-02-01")).toEqual([[1, 2, false]]);
    const result = await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }, gateway).waitlistSweep({ at: "2030-02-02T00:05:00.000Z" });
    expect(result.eventIds).toHaveLength(2);
    expect([await batchOf(a.id), await batchOf(b.id), await batchOf(c.id)]).toEqual([one.id, one.id, null]);
    expect((await entryOf(c.id)).admitted_at).toBeNull();
    expect(gateway.asked.map((r) => r.data.waitlistEntryId).sort()).toEqual([a.id, b.id].sort());
    // Full: it is no longer a batch with places, and the next sweep admits nobody.
    expect(await left("2030-02-02")).toEqual([]);
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }, gateway).waitlistSweep({ at: "2030-02-02T00:20:00.000Z" });
    expect((await entryOf(c.id)).admitted_at).toBeNull();
    await t.h.pg.query("update waitlist_entries set admitted_at = $1, notified_at = $1 where id = $2", [new Date("2029-01-01T00:00:00Z"), c.id]);
  });

  it("a batch with places left stays open: someone who joins later is admitted by the next sweep, and one already in takes no place", async () => {
    const two = await batch(2, "2030-02-10", 2);
    const already = await waiting("2029-12-14T00:00:00.000Z");
    await repos.admissions.record(t.db, { userId: already.userId!, how: "existing" });
    const first = await waiting("2029-12-15T00:00:00.000Z");
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }).waitlistSweep({ at: "2030-02-10T09:00:00.000Z" });
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }).waitlistSweep({ at: "2030-02-10T09:15:00.000Z" });
    expect(await batchOf(already.id)).toBeNull();
    expect(await batchOf(first.id)).toBe(two.id);
    expect(await left("2030-02-12")).toEqual([[2, 1, true]]);
    const later = await waiting("2030-02-12T00:00:00.000Z");
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }).waitlistSweep({ at: "2030-02-12T09:00:00.000Z" });
    expect(await batchOf(later.id)).toBe(two.id);
    expect(await left("2030-02-12")).toEqual([]);
    // A closed account gives no place back: its entry goes with it, the batch stays full and admits nobody else.
    await t.h.pg.query("delete from waitlist_entries where id = $1", [later.id]);
    const after = await waiting("2030-02-13T00:00:00.000Z");
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0 }).waitlistSweep({ at: "2030-02-13T09:00:00.000Z" });
    expect((await entryOf(after.id)).admitted_at).toBeNull();
    expect(await left("2030-02-13")).toEqual([]);
    // And the database refuses a batch more admissions than it published, or fewer places than it has given.
    await expect(t.h.pg.query("update waitlist_batches set taken = places + 1 where id = $1", [two.id])).rejects.toThrow(/waitlist_batches_taken_range/);
    await expect(t.h.pg.query("update waitlist_batches set places = 1 where id = $1", [two.id])).rejects.toThrow(/waitlist_batches_taken_range/);
    await t.h.pg.query("update waitlist_entries set admitted_at = $1, notified_at = $1 where id = $2", [new Date("2029-01-01T00:00:00Z"), after.id]);
  });

  it("under open sign-up the day's ceiling bounds a batch too, and the rest of its places open the next day", async () => {
    const three = await batch(3, "2030-03-01", 2);
    const a = await waiting("2029-12-16T00:00:00.000Z");
    const b = await waiting("2029-12-17T00:00:00.000Z");
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0, SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: 1 }).waitlistSweep({ at: "2030-03-01T12:00:00.000Z" });
    expect([await batchOf(a.id), await batchOf(b.id)]).toEqual([three.id, null]);
    await sweep({ WAITLIST_ADMIT_PER_DAY: 0, SIGNUP_OPEN: "1", SIGNUP_DAILY_CEILING: 1 }).waitlistSweep({ at: "2030-03-02T12:00:00.000Z" });
    expect(await batchOf(b.id)).toBe(three.id);
  });
});
