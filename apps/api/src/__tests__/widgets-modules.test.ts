/**
 * 0041 through the API: saved table views persist per person (audit #204), and the business time zone sets the
 * Journey's "today" (audit #196).
 */
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "w06-api" });
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

const view = { id: "view-1", name: "TPD custom view", columns: ["name", "status"], sort: [{ id: "name", desc: false }], filters: [] };

describe("founder.tableViews", () => {
  it("a saved view comes back after a reload, for that person only", async () => {
    const member = hz.caller({ userId: hz.A.memberId });
    expect(await member.founder.tableViews.get({ tableKey: "team.agents", businessId: hz.A.businessId })).toBeNull();
    await member.founder.tableViews.save({ tableKey: "team.agents", businessId: hz.A.businessId, views: [view], activeViewId: "view-1" });
    expect(await member.founder.tableViews.get({ tableKey: "team.agents", businessId: hz.A.businessId })).toEqual({ views: [view], activeViewId: "view-1" });
    // The owner of the same business has their own (none yet).
    expect(await hz.caller({ userId: hz.A.ownerId }).founder.tableViews.get({ tableKey: "team.agents", businessId: hz.A.businessId })).toBeNull();
  });

  it("works for the account-wide LIVE pages and refuses a business the person is not in", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    await owner.founder.tableViews.save({ tableKey: "live.leaderboards", views: [view], activeViewId: "view-1" });
    expect((await owner.founder.tableViews.get({ tableKey: "live.leaderboards" }))?.activeViewId).toBe("view-1");
    expect(await code(owner.founder.tableViews.save({ tableKey: "team.agents", businessId: hz.A.businessId, views: [], activeViewId: null }))).not.toBe("OK");
    expect(await code(owner.founder.tableViews.save({ tableKey: "Not A Key", views: [], activeViewId: null }))).toBe("BAD_REQUEST");
  });
});

describe("business.setTimeZone and the Journey's today", () => {
  it("an admin sets it; a member cannot; an unknown zone is refused", async () => {
    expect(await code(hz.caller({ userId: hz.A.memberId }).business.setTimeZone({ businessId: hz.A.businessId, timeZone: "Asia/Tokyo" }))).toBe("FORBIDDEN");
    expect(await code(hz.caller({ userId: hz.A.ownerId }).business.setTimeZone({ businessId: hz.A.businessId, timeZone: "Mars/Olympus" }))).toBe("BAD_REQUEST");
    const set = await hz.caller({ userId: hz.A.ownerId }).business.setTimeZone({ businessId: hz.A.businessId, timeZone: "Pacific/Kiritimati" });
    expect(set.timeZone).toBe("Pacific/Kiritimati");
    expect((await hz.caller({ userId: hz.A.memberId }).business.get({ businessId: hz.A.businessId })).business.timeZone).toBe("Pacific/Kiritimati");
  });

  it("journey.ribbon's default today is the business's day, not UTC's", async () => {
    // Kiritimati is UTC+14: its day is always the UTC day or the one after.
    const ribbon = await hz.caller({ userId: hz.A.ownerId }).journey.ribbon({ businessId: hz.A.businessId, slim: true });
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(ribbon.today).toBe(expected);
  });
});
