/**
 * The overnight shift (retention plan, founder 2026-11-11): Commit's default turns Autopilot on with the daily cadence at
 * about 2 AM in the founder's zone. Without the zone Autopilot keeps its own defaults; without the switch it stays off.
 */
import { repos } from "@foundmill/db";
import { overnightUtcHour } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "overnight", temporalClient: fakeTemporalClient() });
}, 120_000);
afterAll(() => hz.close());

async function commit(email: string, extra: { autopilot?: boolean; overnight?: { timeZone: string } }) {
  const userId = await hz.h.createUser(email);
  const caller = hz.caller({ userId, email });
  await caller.founder.profile.update({ displayName: "Reid", experience: "first-time", skills: { engineering: 12 }, targetMarkets: ["US"], riskAppetite: "medium" });
  const generated = await caller.idea.generate({ prompt: "Booking for tutors" });
  const result = await caller.idea.commit({ ideaId: generated.ideas[0]!.id, name: `Tutorlane ${email.slice(0, 4)}`, archetype: "b2b_saas", gameMode: "personal", ...extra });
  return repos.businesses.get(hz.db, result.business.id);
}

describe("idea.commit and the overnight shift", () => {
  it("turns Autopilot on, daily, at 2 AM in the founder's zone", async () => {
    const b = await commit("night@test.local", { autopilot: true, overnight: { timeZone: "America/New_York" } });
    expect(b).toMatchObject({ autopilotEnabled: true, autopilotCadence: "daily", autopilotDailyHour: overnightUtcHour("America/New_York"), autopilotOwnMaxCyclesPerDay: 1, autopilotOwnSpendCeilingMinor: 15 });
    // The shared limits Continue uses are left as they were (founder, 2026-11-12: split the limits).
    expect(b).toMatchObject({ autopilotMaxCyclesPerDay: 6, autopilotSpendCeilingMinor: null });
  });

  it("keeps Autopilot's own defaults without a zone, and stays off when not chosen", async () => {
    expect(await commit("plain@test.local", { autopilot: true })).toMatchObject({ autopilotEnabled: true, autopilotCadence: "every_4h" });
    expect((await commit("none@test.local", {})).autopilotEnabled).toBe(false);
  });

  it("lets an owner change Autopilot's own limits apart from the shared ones, or clear them", async () => {
    const b = await commit("limits@test.local", { autopilot: true, overnight: { timeZone: "UTC" } });
    const owner = (await repos.memberships.list(hz.db, b.id, { role: "owner" }))[0]!.userId;
    const caller = hz.caller({ userId: owner });
    const r = await caller.business.autopilot.set({ businessId: b.id, ownMaxCyclesPerDay: 2, ownSpendCeilingMinor: 40 });
    expect(r.change).toBe("settings_changed");
    expect(r.status.settings).toMatchObject({ ownMaxCyclesPerDay: 2, ownSpendCeilingMinor: 40, maxCyclesPerDay: 6, spendCeilingMinor: null });
    expect(r.status).toMatchObject({ ownCyclesToday: 0, ownSpentTodayMinor: 0 });
    const cleared = await caller.business.autopilot.set({ businessId: b.id, ownMaxCyclesPerDay: null, ownSpendCeilingMinor: null });
    expect(cleared.status.settings).toMatchObject({ ownMaxCyclesPerDay: null, ownSpendCeilingMinor: null });
  });
});
