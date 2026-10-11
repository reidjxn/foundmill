/**
 * founder.preferences.get/update: one signed-in person's date and time format (account_preferences, 0022). Any
 * signed-in account calls them (a member of any business, a viewer, or someone with no business or profile yet); a
 * second account never sees or changes the first one's choice; the input is validated.
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

describe("founder.preferences", () => {
  it("reads US dates and 12-hour times until the person chooses, without writing a row", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.founder.preferences.get()).toEqual({ date: "us", time: "12h" });
    expect(await hz.db.select().from(accountPreferences).where(eq(accountPreferences.userId, hz.A.ownerId))).toHaveLength(0);
  });

  it("saves one choice at a time and keeps the other", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.founder.preferences.update({ date: "day_first" })).toEqual({ date: "day_first", time: "12h" });
    expect(await owner.founder.preferences.update({ time: "24h" })).toEqual({ date: "day_first", time: "24h" });
    expect(await owner.founder.preferences.get()).toEqual({ date: "day_first", time: "24h" });
    expect(await owner.founder.preferences.update({ date: "iso", time: "12h" })).toEqual({ date: "iso", time: "12h" });
    expect(await owner.founder.preferences.update({ date: "day_first", time: "24h" })).toEqual({ date: "day_first", time: "24h" });
  });

  it("a second account cannot see or change the first one's choice", async () => {
    const other = hz.caller({ userId: hz.B.ownerId });
    // B reads its own defaults, not A's choice, and B's change leaves A's untouched.
    expect(await other.founder.preferences.get()).toEqual({ date: "us", time: "12h" });
    expect(await other.founder.preferences.update({ date: "iso" })).toEqual({ date: "iso", time: "12h" });
    expect(await hz.caller({ userId: hz.A.ownerId }).founder.preferences.get()).toEqual({ date: "day_first", time: "24h" });
    expect(await other.founder.preferences.get()).toEqual({ date: "iso", time: "12h" });
    // There is no way to name another account: the procedures take no user id, and one passed is refused.
    expect(await code(other.founder.preferences.update({ date: "us", userId: hz.A.ownerId } as never))).toBe("BAD_REQUEST");
    const rows = await hz.db.select().from(accountPreferences).where(eq(accountPreferences.userId, hz.A.ownerId));
    expect(rows.map((r) => [r.dateFormat, r.timeFormat])).toEqual([["day_first", "24h"]]);
  });

  it("is personal, not a business permission: a viewer and an account with no business or profile can both choose", async () => {
    const viewer = hz.caller({ userId: hz.A.viewerId });
    expect(await viewer.founder.preferences.update({ time: "24h" })).toEqual({ date: "us", time: "24h" });
    const fresh = await hz.h.createUser("fresh-preferences@test.local");
    const newcomer = hz.caller({ userId: fresh });
    expect((await newcomer.founder.profile.get()).complete).toBe(false);
    expect(await newcomer.founder.preferences.update({ date: "iso" })).toEqual({ date: "iso", time: "12h" });
    // Choosing a format never creates a founder profile (the onboarding gate stays where it was).
    expect((await newcomer.founder.profile.get()).complete).toBe(false);
  });

  it("refuses signed-out callers, unknown formats and an empty change", async () => {
    expect(await code(hz.caller(null).founder.preferences.get())).toBe("UNAUTHORIZED");
    expect(await code(hz.caller(null).founder.preferences.update({ date: "us" }))).toBe("UNAUTHORIZED");
    const owner = hz.caller({ userId: hz.A.memberId });
    expect(await code(owner.founder.preferences.update({ date: "dmy" } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({ time: "24" } as never))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.update({}))).toBe("BAD_REQUEST");
    expect(await owner.founder.preferences.get()).toEqual({ date: "us", time: "12h" });
  });
});
