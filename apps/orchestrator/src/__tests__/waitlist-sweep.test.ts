/**
 * The waitlist's sweep (WP-03 T2, activities/waitlist.ts): the day's number admits the oldest sign-ups, SIGNUP_OPEN's
 * ceiling bounds it, everyone admitted (by the sweep or by hand) is emailed once, and a refusal that may pass leaves
 * the entry to be asked again. Each test runs on its own UTC day, so the day's counts are its own.
 */
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWaitlistActivities } from "../activities/waitlist";
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

describe("waitlistSweep", () => {
  it("with the number unset (0) admits nobody, and still emails someone the operator admitted by hand", async () => {
    const at = "2030-01-01T12:00:00.000Z";
    const nobody = await waiting("2029-12-01T00:00:00.000Z");
    const byHand = await waiting("2029-12-02T00:00:00.000Z");
    await repos.admissions.record(t.db, { userId: byHand.userId!, how: "open" });
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
    expect(gateway.asked.map((r) => r.data.waitlistEntryId)).toEqual([a.id, b.id]);
    expect((await repos.admissions.forUser(t.db, a.userId!))?.how).toBe("open");
    const events = await t.h.pg.query<{ n: number }>("select count(*)::int as n from account_events where user_id = $1 and type = 'account.admitted'", [a.userId]);
    expect(events.rows[0]!.n).toBe(1);
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
});
