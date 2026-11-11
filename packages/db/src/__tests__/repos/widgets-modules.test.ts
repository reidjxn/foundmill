/**
 * 0041: saved table views persist per person (audit #204), and the Journey's days follow the business time zone
 * (audit #196) so Home's "today" agrees with the top bar at any hour.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("w06");
});
afterAll(() => r?.close());

const view = (id: string, name: string) => ({ id, name, columns: ["name", "status"], sort: [{ id: "name", desc: false }], filters: [{ id: "f1", field: "status", op: "eq", value: "healthy" }] });

describe("repos.tableViews", () => {
  it("saves a person's views and open view for one table and reads them back after a reload", async () => {
    expect(await r.as(r.A.memberId, (tx) => repos.tableViews.get(tx, r.A.memberId, { tableKey: "team.agents", businessId: r.A.businessId }))).toBeNull();
    await r.as(r.A.memberId, (tx) => repos.tableViews.save(tx, r.A.memberId, { tableKey: "team.agents", businessId: r.A.businessId, views: [view("general", "General"), view("v-1", "TPD custom view")], activeViewId: "v-1" }));
    // Saving again replaces (one row per person × business × table).
    const saved = await r.as(r.A.memberId, (tx) => repos.tableViews.save(tx, r.A.memberId, { tableKey: "team.agents", businessId: r.A.businessId, views: [view("v-1", "Renamed view")], activeViewId: "v-1" }));
    expect(saved.views.map((v) => v.name)).toEqual(["Renamed view"]);
    const back = await r.as(r.A.memberId, (tx) => repos.tableViews.get(tx, r.A.memberId, { tableKey: "team.agents", businessId: r.A.businessId }));
    expect(back).toEqual({ views: [expect.objectContaining({ id: "v-1", name: "Renamed view", filters: [expect.objectContaining({ field: "status" })] })], activeViewId: "v-1" });
  });

  it("keeps people, businesses, tables and the account-wide LIVE pages apart", async () => {
    await r.as(r.A.ownerId, (tx) => repos.tableViews.save(tx, r.A.ownerId, { tableKey: "team.agents", businessId: r.A.businessId, views: [], activeViewId: "cost" }));
    await r.as(r.A.memberId, (tx) => repos.tableViews.save(tx, r.A.memberId, { tableKey: "live.communities", views: [view("mine", "Mine")], activeViewId: "mine" }));
    expect((await r.as(r.A.ownerId, (tx) => repos.tableViews.get(tx, r.A.ownerId, { tableKey: "team.agents", businessId: r.A.businessId })))?.activeViewId).toBe("cost");
    expect((await r.as(r.A.memberId, (tx) => repos.tableViews.get(tx, r.A.memberId, { tableKey: "team.agents", businessId: r.A.businessId })))?.activeViewId).toBe("v-1");
    expect((await r.as(r.A.memberId, (tx) => repos.tableViews.get(tx, r.A.memberId, { tableKey: "live.communities" })))?.activeViewId).toBe("mine");
    expect(await r.as(r.A.memberId, (tx) => repos.tableViews.get(tx, r.A.memberId, { tableKey: "crm.list", businessId: r.A.businessId }))).toBeNull();
    // A person cannot write views into a business they are not a member of (RLS).
    await expect(r.as(r.B.memberId, (tx) => repos.tableViews.save(tx, r.B.memberId, { tableKey: "team.agents", businessId: r.A.businessId, views: [], activeViewId: null }))).rejects.toThrow();
  });

  it("refuses a malformed table key or view", async () => {
    await expect(r.as(r.A.memberId, (tx) => repos.tableViews.save(tx, r.A.memberId, { tableKey: "Team Agents!", businessId: r.A.businessId, views: [], activeViewId: null }))).rejects.toThrow(/Invalid table views/);
    await expect(r.as(r.A.memberId, (tx) => repos.tableViews.save(tx, r.A.memberId, { tableKey: "team.agents", businessId: r.A.businessId, views: [{ ...view("x", ""), name: "" }], activeViewId: null }))).rejects.toThrow(/Invalid table views/);
  });
});

describe("business time zone and the Journey's days", () => {
  it("accepts only zones Postgres knows", async () => {
    const b = await repos.businesses.setTimeZone(r.db, r.B.businessId, "Asia/Tokyo");
    expect(b.timeZone).toBe("Asia/Tokyo");
    await expect(repos.businesses.setTimeZone(r.db, r.B.businessId, "Mars/Olympus")).rejects.toThrow(/Unknown time zone/);
    await expect(repos.businesses.setTimeZone(r.db, r.B.businessId, "'; drop table x; --")).rejects.toThrow(/Invalid time zone/);
  });

  it("buckets a conversion into the business's own day: 21:12 UTC on Mar 14 is Mar 15 in Tokyo, Mar 14 in UTC", async () => {
    await repos.businesses.setTimeZone(r.db, r.B.businessId, "Asia/Tokyo");
    const at = new Date("2026-03-14T21:12:00Z");
    await repos.journeys.recordConversion(r.db, r.B.businessId, { entityId: r.B.entityId, kind: "signup", occurredAt: at });
    await repos.journeys.recordConversion(r.db, r.A.businessId, { entityId: r.A.entityId, kind: "signup", occurredAt: at });
    await repos.journeys.refreshDaily(r.db);
    const tokyo = await r.svc((tx) => repos.journeys.dailyRange(tx, r.B.businessId, { from: "2026-03-14", to: "2026-03-15" }));
    const utc = await r.svc((tx) => repos.journeys.dailyRange(tx, r.A.businessId, { from: "2026-03-14", to: "2026-03-15" }));
    const signupDay = (rows: { day: string | Date; signups: number }[]) => rows.filter((x) => Number(x.signups) > 0).map((x) => (x.day instanceof Date ? x.day.toISOString() : String(x.day)).slice(0, 10));
    expect(signupDay(tokyo)).toEqual(["2026-03-15"]);
    expect(signupDay(utc)).toEqual(["2026-03-14"]);
  });
});
