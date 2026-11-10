/**
 * The sample business's numbers (first-time founder report, Phase 3 group K item 3; DECISIONS 2026-11-10):
 * journey.ribbon returns the customer figures as one server field (this week, the week before, the total the customer
 * milestones are reached at), scoped to the business asked for; finance.overview says whether the business's revenue
 * recurs, so Finance names a one-off seller's monthly figure for what it is; and the api's roll-forward moves only the
 * demo businesses' timestamps, never a founder's own.
 */
import { repos, type Db } from "@foundmill/db";
import { DEMO_ROLL_AUDIT_ACTION, DEMO_SEED_AUDIT_ACTION, NORTHWIND_BUSINESS_ID } from "@foundmill/db/seed";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rollDemoBusinesses } from "../services/demo-roll-forward";
import { createApiHarness, type ApiHarness } from "./harness";

const DAY = 86_400_000;
let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "sample" });
}, 120_000);
afterAll(() => hz.close());

const silent = { info: () => {}, warn: () => {} } as unknown as Parameters<typeof rollDemoBusinesses>[0]["log"];

describe("journey.ribbon customers: one server field per fact", () => {
  it("counts first payments this week, the week before and in all, for the business asked for only", async () => {
    const { businessId } = hz.A;
    const now = Date.now();
    // The fixture's own conversions are counted too: the test reads what these three add.
    const before = (await hz.caller({ userId: hz.A.ownerId }).journey.ribbon({ businessId, slim: true })).customers;
    const b = await repos.businesses.create(hz.db, { name: "Counted Co", createdBy: hz.B.ownerId });
    await repos.memberships.add(hz.db, b.id, { userId: hz.B.ownerId, role: "owner", source: "founder" });
    await repos.journeys.recordConversion(hz.db, businessId, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: new Date(now - 2 * DAY) });
    await repos.journeys.recordConversion(hz.db, businessId, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: new Date(now - 9 * DAY) });
    await repos.journeys.recordConversion(hz.db, businessId, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: new Date(now - 400 * DAY) });
    // A signup is not a customer.
    await repos.journeys.recordConversion(hz.db, businessId, { entityId: null, kind: "signup", amountMinor: 0, occurredAt: new Date(now - DAY) });

    // Whatever range is on screen (Milestones asks for today alone), the figures are the same.
    for (const range of [{}, { from: new Date(now).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10) }]) {
      const ribbon = await hz.caller({ userId: hz.A.ownerId }).journey.ribbon({ businessId, slim: true, ...range });
      expect(ribbon.customers).toMatchObject({ thisWeek: before.thisWeek + 1, previousWeek: before.previousWeek + 1, total: before.total + 3 });
      expect(ribbon.customers.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Another business counts its own (none), and its owner cannot read this one.
    expect((await hz.caller({ userId: hz.B.ownerId }).journey.ribbon({ businessId: b.id, slim: true })).customers).toMatchObject({ thisWeek: 0, previousWeek: 0, total: 0 });
    await expect(hz.caller({ userId: hz.B.ownerId }).journey.ribbon({ businessId, slim: true })).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("finance.overview revenue.recurring", () => {
  it("is false for a business whose customers buy once, true for a subscription business, null before an archetype", async () => {
    const { businessId } = hz.A;
    const read = async () => (await hz.caller({ userId: hz.A.ownerId }).finance.overview({ businessId })).revenue.recurring;
    await hz.db.execute(sql`update businesses set archetype = 'dtc_physical' where id = ${businessId}::uuid`);
    expect(await read()).toBe(false);
    await hz.db.execute(sql`update businesses set archetype = 'b2b_saas' where id = ${businessId}::uuid`);
    expect(await read()).toBe(true);
    await hz.db.execute(sql`update businesses set archetype = null where id = ${businessId}::uuid`);
    expect(await read()).toBeNull();
  });
});

describe("the api rolls the sample forward with the calendar", () => {
  it("moves a demo business seeded three days ago by three days, leaves a founder's business alone, and records it", async () => {
    const db: Db = hz.db;
    const now = new Date();
    const anchor = new Date(now.getTime() - 3 * DAY - 60_000);
    const demo = await repos.businesses.create(db, { id: NORTHWIND_BUSINESS_ID, name: "Northwind Skincare", isDemo: true, createdBy: hz.A.ownerId });
    const paid = await repos.journeys.recordConversion(db, demo.id, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: anchor });
    await repos.audit.append(db, demo.id, { actorKind: "system", actorId: null, action: DEMO_SEED_AUDIT_ACTION, target: { kind: "business", id: demo.id }, details: { anchor: anchor.toISOString() } });
    // A founder's business that holds a look-alike seed entry and a payment at the same instant: never a demo, never moved.
    await repos.audit.append(db, hz.A.businessId, { actorKind: "system", actorId: null, action: DEMO_SEED_AUDIT_ACTION, target: { kind: "business", id: hz.A.businessId }, details: { anchor: anchor.toISOString() } });
    const own = await repos.journeys.recordConversion(db, hz.A.businessId, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: anchor });

    const moved = await rollDemoBusinesses({ db, log: silent }, now);
    expect(moved).toEqual([{ businessId: NORTHWIND_BUSINESS_ID, days: 3, from: anchor.toISOString(), to: new Date(anchor.getTime() + 3 * DAY).toISOString() }]);
    expect((await repos.journeys.getConversion(db, demo.id, paid.id)).occurredAt.getTime()).toBe(anchor.getTime() + 3 * DAY);
    expect((await repos.journeys.getConversion(db, hz.A.businessId, own.id)).occurredAt.getTime()).toBe(anchor.getTime());
    expect((await repos.audit.list(db, demo.id, { action: DEMO_ROLL_AUDIT_ACTION })).items).toHaveLength(1);
    expect((await repos.audit.list(db, hz.A.businessId, { action: DEMO_ROLL_AUDIT_ACTION })).items).toHaveLength(0);
    // Current now: the next pass has nothing to do.
    expect(await rollDemoBusinesses({ db, log: silent }, now)).toEqual([]);
  });
});
