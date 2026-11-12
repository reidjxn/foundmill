/**
 * founder.preferences.get/guidance/update: one signed-in person's date and time format (account_preferences, 0022) and
 * the guided layer's preferences (0064). Any signed-in account calls them (a member of any business, a viewer, or
 * someone with no business or profile yet); a second account never sees or changes the first one's choice; the input
 * is validated.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { accountPreferences } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "preferences" });
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

/** The guided layer's defaults, until the person chooses. */
const GUIDED = { guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: "humans", builderView: false };
/** The mobile app's notification defaults (0075): every kind on, amounts shown. */
const NOTIFICATIONS_ON = { decision: true, approval: true, customer: true, agent_down: true, runway: true, run_finished: true, goal: true };
/** With the email channel beside push (packages 1.5 and 5.1): every kind of email on, too. */
const NOTIFIED = { notifications: NOTIFICATIONS_ON, hideAmountsOnLockScreen: false, email: { decision_waiting: true } };
/** Everything `update` answers: the formats, the guided layer and the notification preferences. */
const ALL = { ...GUIDED, ...NOTIFIED };

describe("founder.preferences", () => {
  it("reads US dates and 12-hour times until the person chooses, without writing a row", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.founder.preferences.get()).toEqual({ date: "us", time: "12h" });
    expect(await owner.founder.preferences.guidance()).toEqual(GUIDED);
    expect(await hz.db.select().from(accountPreferences).where(eq(accountPreferences.userId, hz.A.ownerId))).toHaveLength(0);
  });

  it("saves one choice at a time and keeps the other", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.founder.preferences.update({ date: "day_first" })).toEqual({ date: "day_first", time: "12h", ...ALL });
    expect(await owner.founder.preferences.update({ time: "24h" })).toEqual({ date: "day_first", time: "24h", ...ALL });
    expect(await owner.founder.preferences.get()).toEqual({ date: "day_first", time: "24h" });
    expect(await owner.founder.preferences.update({ date: "iso", time: "12h" })).toMatchObject({ date: "iso", time: "12h" });
    expect(await owner.founder.preferences.update({ date: "day_first", time: "24h" })).toMatchObject({ date: "day_first", time: "24h" });
  });

  it("the guided layer: the switch, the text size, marks that merge, the checklist and a reset", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.founder.preferences.update({ guidance: "off", textSize: "comfortable" })).toMatchObject({ date: "day_first", time: "24h", guidance: "off", textSize: "comfortable" });
    expect(await owner.founder.preferences.guidance()).toEqual({ ...GUIDED, guidance: "off", textSize: "comfortable" });
    // The date format read is untouched by the guided layer.
    expect(await owner.founder.preferences.get()).toEqual({ date: "day_first", time: "24h" });
    expect(await owner.founder.preferences.update({ explainersSeen: { home: true } })).toMatchObject({ explainersSeen: { home: true }, toursDone: {} });
    expect(await owner.founder.preferences.update({ explainersSeen: { inbox: true }, toursDone: { home: true }, checklistDismissed: true })).toMatchObject({
      explainersSeen: { home: true, inbox: true },
      toursDone: { home: true },
      checklistDismissedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(await owner.founder.preferences.update({ checklistDismissed: false })).toMatchObject({ checklistDismissedAt: null, explainersSeen: { home: true, inbox: true } });
    // "Show the first-week checklist again" / "Replay the tour": everything seen is forgotten; the choices stay.
    expect(await owner.founder.preferences.update({ reset: true })).toEqual({ date: "day_first", time: "24h", ...ALL, guidance: "off", textSize: "comfortable" });
    expect(await owner.founder.preferences.update({ guidance: "on", textSize: "standard" })).toEqual({ date: "day_first", time: "24h", ...ALL });
  });

  it("notifications (0073): every kind on until turned off, kinds merge, the lock-screen switch saves alone, the account's own", async () => {
    const fresh = await hz.h.createUser("notifications-preferences@test.local");
    const me = hz.caller({ userId: fresh });
    expect(await me.founder.preferences.notifications()).toEqual(NOTIFIED);
    expect(await me.founder.preferences.update({ notifications: { customer: false } })).toMatchObject({ notifications: { ...NOTIFICATIONS_ON, customer: false }, hideAmountsOnLockScreen: false });
    expect(await me.founder.preferences.update({ hideAmountsOnLockScreen: true, notifications: { run_finished: false } })).toMatchObject({ notifications: { ...NOTIFICATIONS_ON, customer: false, run_finished: false }, hideAmountsOnLockScreen: true });
    expect(await me.founder.preferences.notifications()).toEqual({ notifications: { ...NOTIFICATIONS_ON, customer: false, run_finished: false }, hideAmountsOnLockScreen: true, email: { decision_waiting: true } });
    // The email channel sits beside push: turning it off leaves the push kinds as they were, and the other way round.
    expect(await me.founder.preferences.update({ email: { decision_waiting: false } })).toMatchObject({ notifications: { ...NOTIFICATIONS_ON, customer: false, run_finished: false }, email: { decision_waiting: false } });
    expect((await me.founder.preferences.update({ notifications: { goal: false } })).email).toEqual({ decision_waiting: false });
    expect((await me.founder.preferences.update({ email: { decision_waiting: true }, notifications: { goal: true } })).email).toEqual({ decision_waiting: true });
    expect(await code(me.founder.preferences.update({ email: { weekly_summary: false } } as never))).toBe("BAD_REQUEST");
    // The guided layer's read is untouched, and a reset of the tours keeps the notification choices.
    expect(await me.founder.preferences.guidance()).toEqual(GUIDED);
    expect(await me.founder.preferences.update({ reset: true })).toMatchObject({ notifications: { ...NOTIFICATIONS_ON, customer: false, run_finished: false }, hideAmountsOnLockScreen: true });
    expect(await me.founder.preferences.update({ notifications: { customer: true } })).toMatchObject({ notifications: { ...NOTIFICATIONS_ON, run_finished: false } });
    // Someone else's phones are their own.
    expect(await hz.caller({ userId: hz.B.memberId }).founder.preferences.notifications()).toEqual(NOTIFIED);
    expect(await code(me.founder.preferences.update({ notifications: {} }))).toBe("BAD_REQUEST");
    expect(await code(me.founder.preferences.update({ notifications: { marketing: true } } as never))).toBe("BAD_REQUEST");
    expect(await code(me.founder.preferences.update({ notifications: { customer: "off" } } as never))).toBe("BAD_REQUEST");
    expect(await code(me.founder.preferences.update({ hideAmountsOnLockScreen: "yes" } as never))).toBe("BAD_REQUEST");
    expect(await code(hz.caller(null).founder.preferences.notifications())).toBe("UNAUTHORIZED");
  });

  it("a second account cannot see or change the first one's choice", async () => {
    const other = hz.caller({ userId: hz.B.ownerId });
    // B reads its own defaults, not A's choice, and B's change leaves A's untouched.
    expect(await other.founder.preferences.get()).toEqual({ date: "us", time: "12h" });
    expect(await other.founder.preferences.update({ date: "iso", guidance: "off" })).toMatchObject({ date: "iso", time: "12h", guidance: "off" });
    expect(await hz.caller({ userId: hz.A.ownerId }).founder.preferences.get()).toEqual({ date: "day_first", time: "24h" });
    expect(await hz.caller({ userId: hz.A.ownerId }).founder.preferences.guidance()).toEqual(GUIDED);
    expect(await other.founder.preferences.get()).toEqual({ date: "iso", time: "12h" });
    expect(await other.founder.preferences.guidance()).toMatchObject({ guidance: "off" });
    // There is no way to name another account: the procedures take no user id, and one passed is refused.
    expect(await code(other.founder.preferences.update({ date: "us", userId: hz.A.ownerId } as never))).toBe("BAD_REQUEST");
    const rows = await hz.db.select().from(accountPreferences).where(eq(accountPreferences.userId, hz.A.ownerId));
    expect(rows.map((r) => [r.dateFormat, r.timeFormat, r.guidance])).toEqual([["day_first", "24h", "on"]]);
  });

  it("is personal, not a business permission: a viewer and an account with no business or profile can both choose", async () => {
    const viewer = hz.caller({ userId: hz.A.viewerId });
    expect(await viewer.founder.preferences.update({ time: "24h" })).toMatchObject({ date: "us", time: "24h" });
    const fresh = await hz.h.createUser("fresh-preferences@test.local");
    const newcomer = hz.caller({ userId: fresh });
    expect((await newcomer.founder.profile.get()).complete).toBe(false);
    expect(await newcomer.founder.preferences.update({ date: "iso", textSize: "comfortable" })).toMatchObject({ date: "iso", time: "12h", textSize: "comfortable" });
    // Choosing a format never creates a founder profile (the onboarding gate stays where it was).
    expect((await newcomer.founder.profile.get()).complete).toBe(false);
  });

  it("anthropomorphic agents (0067): off until chosen, round-trips through update and guidance, the account's own", async () => {
    const fresh = await hz.h.createUser("anthropomorphic-preferences@test.local");
    const me = hz.caller({ userId: fresh });
    expect((await me.founder.preferences.guidance()).anthropomorphicAgents).toBe(false);
    expect(await me.founder.preferences.update({ anthropomorphicAgents: true })).toMatchObject({ date: "us", time: "12h", guidance: "on", anthropomorphicAgents: true });
    expect(await me.founder.preferences.guidance()).toEqual({ ...GUIDED, anthropomorphicAgents: true });
    // Another preference changes nothing about it; a reset of the tours keeps it too.
    expect(await me.founder.preferences.update({ textSize: "comfortable" })).toMatchObject({ anthropomorphicAgents: true });
    expect(await me.founder.preferences.update({ reset: true })).toMatchObject({ anthropomorphicAgents: true });
    // Someone else's switch is their own.
    expect((await hz.caller({ userId: hz.B.memberId }).founder.preferences.guidance()).anthropomorphicAgents).toBe(false);
    expect(await me.founder.preferences.update({ anthropomorphicAgents: false })).toMatchObject({ anthropomorphicAgents: false });
    expect(await code(me.founder.preferences.update({ anthropomorphicAgents: "on" } as never))).toBe("BAD_REQUEST");
  });

  it("Builder view (0073): off until chosen, round-trips through update and guidance, kept by a reset, the account's own", async () => {
    const fresh = await hz.h.createUser("builder-view-preferences@test.local");
    const me = hz.caller({ userId: fresh });
    expect((await me.founder.preferences.guidance()).builderView).toBe(false);
    expect(await me.founder.preferences.update({ builderView: true })).toMatchObject({ date: "us", time: "12h", guidance: "on", builderView: true });
    expect(await me.founder.preferences.guidance()).toEqual({ ...GUIDED, builderView: true });
    // Another preference, and a reset of the tours, keep it.
    expect(await me.founder.preferences.update({ guidance: "off" })).toMatchObject({ builderView: true, guidance: "off" });
    expect(await me.founder.preferences.update({ reset: true })).toMatchObject({ builderView: true });
    // A second account neither sees it nor changes it: its own switch is its own, and no user id can be named.
    const other = hz.caller({ userId: hz.B.memberId });
    expect((await other.founder.preferences.guidance()).builderView).toBe(false);
    expect(await code(other.founder.preferences.update({ builderView: false, userId: fresh } as never))).toBe("BAD_REQUEST");
    expect((await me.founder.preferences.guidance()).builderView).toBe(true);
    const rows = await hz.db.select().from(accountPreferences).where(eq(accountPreferences.userId, fresh));
    expect(rows.map((r) => r.builderView)).toEqual([true]);
    expect(await me.founder.preferences.update({ builderView: false })).toMatchObject({ builderView: false });
    expect(await code(me.founder.preferences.update({ builderView: "on" } as never))).toBe("BAD_REQUEST");
  });

  it("agent style (0069): humans until chosen, each style round-trips with or without the switch, is kept by a reset, and an unknown one is refused", async () => {
    const fresh = await hz.h.createUser("agent-style-preferences@test.local");
    const me = hz.caller({ userId: fresh });
    expect((await me.founder.preferences.guidance()).agentStyle).toBe("humans");
    for (const agentStyle of ["cartoon_3d", "cartoon_2d", "fantasy"] as const) {
      expect(await me.founder.preferences.update({ agentStyle })).toMatchObject({ agentStyle });
      expect(await me.founder.preferences.guidance()).toEqual({ ...GUIDED, agentStyle });
    }
    expect(await me.founder.preferences.update({ anthropomorphicAgents: true, agentStyle: "cartoon_2d" })).toMatchObject({ anthropomorphicAgents: true, agentStyle: "cartoon_2d" });
    // Off keeps the style for the next time the switch goes on; a reset of the tours keeps both.
    expect(await me.founder.preferences.update({ anthropomorphicAgents: false })).toMatchObject({ anthropomorphicAgents: false, agentStyle: "cartoon_2d" });
    expect(await me.founder.preferences.update({ reset: true })).toMatchObject({ anthropomorphicAgents: false, agentStyle: "cartoon_2d" });
    expect((await hz.caller({ userId: hz.B.memberId }).founder.preferences.guidance()).agentStyle).toBe("humans");
    expect(await code(me.founder.preferences.update({ agentStyle: "anime" } as never))).toBe("BAD_REQUEST");
    expect(await code(me.founder.preferences.update({ agentStyle: "Humans" } as never))).toBe("BAD_REQUEST");
    expect((await me.founder.preferences.guidance()).agentStyle).toBe("cartoon_2d");
  });

  it("refuses signed-out callers, unknown formats or modes, a mark that is not true, and an empty change", async () => {
    expect(await code(hz.caller(null).founder.preferences.get())).toBe("UNAUTHORIZED");
    expect(await code(hz.caller(null).founder.preferences.guidance())).toBe("UNAUTHORIZED");
    expect(await code(hz.caller(null).founder.preferences.update({ date: "us" }))).toBe("UNAUTHORIZED");
    const owner = hz.caller({ userId: hz.A.memberId });
    expect(await code(owner.founder.preferences.update({ date: "dmy" } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({ time: "24" } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({ guidance: "quiet" } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({ textSize: "large" } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({ explainersSeen: { home: false } } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({ reset: true, toursDone: { home: true } }))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({}))).toBe("BAD_REQUEST");
    expect(await owner.founder.preferences.get()).toEqual({ date: "us", time: "12h" });
    expect(await owner.founder.preferences.guidance()).toEqual(GUIDED);
  });
});
