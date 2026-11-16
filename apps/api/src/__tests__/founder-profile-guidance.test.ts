/**
 * founder.profile.update and the guided layer's default (docs/UX_AUDIT_AND_PLAN.md §6.3, decided Oct 20, 2026): the
 * save that creates a profile with an Exited or Operator experience turns guidance off, once, and says so with
 * `guidanceTurnedOff`; a first-time founder keeps it on; later edits never touch the switch, whatever the experience
 * becomes, so a founder who turned guidance back on keeps it. The same first save turns Builder view on (0073).
 */
import { eq } from "drizzle-orm";
import { accountPreferences } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guidanceOffByDefault } from "../routers/founder";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "profile-guidance" });
}, 120_000);
afterAll(() => hz.close());

const profile = (displayName: string, experience: string) => ({ displayName, experience, skills: { engineering: 10 }, targetMarkets: ["EU"], riskAppetite: "medium" });

describe("guidanceOffByDefault", () => {
  it("is off for Exited and Operator, on for everyone else and for no answer", () => {
    expect(guidanceOffByDefault("exited")).toBe(true);
    expect(guidanceOffByDefault("operator")).toBe(true);
    expect(guidanceOffByDefault(" Operator ")).toBe(true);
    expect(guidanceOffByDefault("first_time")).toBe(false);
    expect(guidanceOffByDefault("domain_expert")).toBe(false);
    expect(guidanceOffByDefault(null)).toBe(false);
    expect(guidanceOffByDefault(undefined)).toBe(false);
  });
});

describe("founder.profile.update and guidance", () => {
  it("an exited founder's first save turns guidance off, once, and the flag says so", async () => {
    const user = await hz.h.createUser("exited-founder@test.local");
    const caller = hz.caller({ userId: user, email: "exited-founder@test.local" });
    expect(await caller.founder.preferences.guidance()).toMatchObject({ guidance: "on" });
    const created = await caller.founder.profile.update({ ...profile("Sam", "exited"), confirmAdult: true });
    expect(created).toMatchObject({ displayName: "Sam", experience: "exited", guidanceTurnedOff: true });
    // The same save turns Builder view on (founder, Nov 8, 2026) and the single-key shortcuts on (WP-04 T13).
    expect(await caller.founder.preferences.guidance()).toMatchObject({ guidance: "off", textSize: "standard", builderView: true, keyboardShortcuts: true });
    // Their own row, written as them (RLS), with the date format untouched.
    const rows = await hz.db.select().from(accountPreferences).where(eq(accountPreferences.userId, user));
    expect(rows.map((r) => [r.guidance, r.builderView, r.keyboardShortcuts, r.dateFormat, r.timeFormat])).toEqual([["off", true, true, "us", "12h"]]);
    // They turn guidance, Builder view and the keys around; a later edit of the profile, even one that keeps "exited", leaves all three.
    await caller.founder.preferences.update({ guidance: "on", builderView: false, keyboardShortcuts: false });
    expect(await caller.founder.profile.update({ confirmAdult: true, displayName: "Samantha" })).toMatchObject({ displayName: "Samantha", guidanceTurnedOff: false });
    expect(await caller.founder.profile.update({ confirmAdult: true, experience: "operator" })).toMatchObject({ experience: "operator", guidanceTurnedOff: false });
    expect(await caller.founder.preferences.guidance()).toMatchObject({ guidance: "on", builderView: false, keyboardShortcuts: false });
  });

  it("an operator's first save turns it off too; a first-time founder's keeps it on", async () => {
    const op = await hz.h.createUser("operator-founder@test.local");
    expect(await hz.caller({ userId: op }).founder.profile.update({ ...profile("Ola", "operator"), confirmAdult: true })).toMatchObject({ guidanceTurnedOff: true });
    expect(await hz.caller({ userId: op }).founder.preferences.guidance()).toMatchObject({ guidance: "off", builderView: true, keyboardShortcuts: true });

    const first = await hz.h.createUser("first-time-founder@test.local");
    expect(await hz.caller({ userId: first }).founder.profile.update({ ...profile("Fin", "first_time"), confirmAdult: true })).toMatchObject({ guidanceTurnedOff: false });
    // A first-time founder's single keys stay off: one stray key never starts work or answers a note (WP-04 T13).
    expect(await hz.caller({ userId: first }).founder.preferences.guidance()).toMatchObject({ guidance: "on", builderView: false, keyboardShortcuts: false });
    expect(await hz.db.select().from(accountPreferences).where(eq(accountPreferences.userId, first))).toHaveLength(0);
  });

  it("a first save that names no experience keeps guidance on, and the choices made before the profile stay", async () => {
    const user = await hz.h.createUser("quiet-founder@test.local");
    const caller = hz.caller({ userId: user });
    await caller.founder.preferences.update({ date: "iso", textSize: "comfortable" });
    expect(await caller.founder.profile.update({ confirmAdult: true, displayName: "Quin" })).toMatchObject({ guidanceTurnedOff: false });
    expect(await caller.founder.preferences.guidance()).toMatchObject({ guidance: "on", textSize: "comfortable" });
    // The exited founder's other preferences stay too: only the switch is written.
    const exited = await hz.h.createUser("exited-comfortable@test.local");
    const asExited = hz.caller({ userId: exited });
    await asExited.founder.preferences.update({ date: "day_first", textSize: "comfortable", explainersSeen: { home: true } });
    expect(await asExited.founder.profile.update({ ...profile("Eli", "exited"), confirmAdult: true })).toMatchObject({ guidanceTurnedOff: true });
    expect(await asExited.founder.preferences.update({ guidance: "off" })).toMatchObject({ date: "day_first", guidance: "off", textSize: "comfortable", explainersSeen: { home: true } });
  });
});
