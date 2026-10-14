/**
 * Finance (audit W03): runway events only on a downward crossing of the Base forecast, the wages period read when the
 * request is made, cap-table integrity (SAFEs are not shares, issuance limits, one class name, prices in the class's
 * currency) and staff named from the CRM.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runwayThresholdCrossed } from "../routers/finance";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "finance-lifecycle" });
}, 120_000);
afterAll(() => hz.close());
afterEach(() => vi.useRealTimers());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

describe("runwayThresholdCrossed (#179)", () => {
  it("fires only when the new runway is under a threshold the previous one was not", () => {
    expect(runwayThresholdCrossed(null, 2.5)).toBe(3); // first Base forecast, or one past the horizon: all of 12, 9, 6, 3 crossed, the most urgent reported
    expect(runwayThresholdCrossed(undefined, 10)).toBe(12);
    expect(runwayThresholdCrossed(2.5, 2.6)).toBeNull();
    expect(runwayThresholdCrossed(2.6, 5)).toBeNull(); // improved
    expect(runwayThresholdCrossed(5, 5.5)).toBeNull();
    expect(runwayThresholdCrossed(13, 8)).toBe(9);
    expect(runwayThresholdCrossed(8, 2)).toBe(3);
    expect(runwayThresholdCrossed(20, 14)).toBeNull();
    expect(runwayThresholdCrossed(5, null)).toBeNull(); // cash lasts past the horizon
    expect(runwayThresholdCrossed(2, undefined)).toBeNull(); // a save that says nothing about runway
  });
});

describe("finance.forecast.update (#179)", () => {
  const save = (owner: ReturnType<ApiHarness["caller"]>, scenario: "base" | "upside" | "downside", runway: number | null) =>
    owner.finance.forecast.update({ businessId: hz.A.businessId, scenario, currency: "GBP", drivers: { startingCashMinor: 1, runway_months: runway }, series: [] });
  const crossings = async () => (await repos.events.list(hz.db, hz.A.businessId, { type: "runway.threshold_crossed", limit: 200 })).items.map((e) => e.payload as { runwayMonths: number; thresholdMonths: number; scenario: string; blocksContinue: boolean });

  it("raises one runway.threshold_crossed per downward crossing of the Base forecast, never for an improvement, a repeat or a what-if scenario", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await save(owner, "base", 2.5); // first save, under every threshold
    await save(owner, "base", 2.6); // still under: nothing new
    await save(owner, "base", 5); // better: nothing
    await save(owner, "upside", 1.2); // a what-if never raises it
    await save(owner, "downside", 1.2);
    expect(await crossings()).toEqual([{ runwayMonths: 2.5, thresholdMonths: 3, scenario: "base", blocksContinue: true, cash: expect.anything(), direction: "below", netBurnMonthly: expect.anything() }].map((e) => expect.objectContaining(e)));
    await save(owner, "base", 13); // back above every threshold
    await save(owner, "base", 8); // crosses 12 and 9 on the way down
    const after = await crossings();
    expect(after).toHaveLength(2);
    expect(after.at(0)).toMatchObject({ runwayMonths: 8, thresholdMonths: 9, scenario: "base", blocksContinue: false }); // newest first
    await save(owner, "base", 8); // the same value again changes nothing
    expect(await crossings()).toHaveLength(2);
  });
});

describe("finance.wages (#358)", () => {
  it("reads 'this month' when the request is made, not when the api started", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const owner = hz.caller({ userId: hz.A.ownerId });
    vi.setSystemTime(new Date("2026-10-31T23:00:00.000Z"));
    expect((await owner.finance.wages({ businessId: hz.A.businessId })).period).toBe("2026-10");
    vi.setSystemTime(new Date("2026-11-01T00:30:00.000Z"));
    expect((await owner.finance.wages({ businessId: hz.A.businessId })).period).toBe("2026-11");
    expect((await owner.finance.wages({ businessId: hz.A.businessId, period: "2026-09" })).period).toBe("2026-09");
  });
});

describe("cap table integrity (#168, #348, #170, #169)", () => {
  it("leaves SAFEs out of the fully diluted total and the percentages", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const ordinary = await owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "Test ordinary", kind: "common", currency: "GBP", authorisedQuantity: 10_000_000 });
    const safe = await owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "Test SAFE", kind: "safe", currency: "GBP", terms: { valuationCapMinor: 600_000_000, postMoney: true } });
    const before = (await owner.finance.capTable.get({ businessId: hz.A.businessId })).summary.totalQuantity;
    await owner.finance.capTable.createEntry({ businessId: hz.A.businessId, holderEntityId: hz.A.entityId, securityId: ordinary.id, quantity: 6_000_000, priceMinor: 0, issuedAt: "2026-01-01" });
    await owner.finance.capTable.createEntry({ businessId: hz.A.businessId, holderEntityId: hz.A.entity2Id, securityId: safe.id, quantity: 250_000, priceMinor: 100, issuedAt: "2026-02-01" });
    const { summary } = await owner.finance.capTable.get({ businessId: hz.A.businessId });
    expect(summary.totalQuantity).toBe(before + 6_000_000);
    const safeClass = summary.byClass.find((c) => c.class === "Test SAFE")!;
    expect(safeClass).toMatchObject({ convertible: true, fullyDilutedPct: null, quantity: 250_000 });
    expect(summary.byClass.find((c) => c.class === "Test ordinary")!.convertible).toBe(false);
    const investor = summary.byHolder.find((h) => h.holderEntityId === hz.A.entity2Id)!;
    expect(investor.fullyDilutedPct).toBeNull();
    expect(investor.quantity).toBe(0);
    const holder = summary.byHolder.find((h) => h.holderEntityId === hz.A.entityId)!;
    expect(holder.fullyDilutedPct).toBeGreaterThan(0);
    const pcts = summary.byHolder.map((h) => h.fullyDilutedPct ?? 0).reduce((a, b) => a + b, 0);
    expect(pcts).toBeGreaterThan(99.9); // shares and options only: they add up to the whole
    expect(pcts).toBeLessThan(100.1);
  });

  it("prices a position in its class's currency unless it says otherwise", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const gbp = await owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "Pound class", kind: "common", currency: "GBP" });
    const entry = await owner.finance.capTable.createEntry({ businessId: hz.A.businessId, holderEntityId: hz.A.entityId, securityId: gbp.id, quantity: 10, priceMinor: 12 });
    expect(entry.currency).toBe("GBP");
    const explicit = await owner.finance.capTable.createEntry({ businessId: hz.A.businessId, holderEntityId: hz.A.entityId, securityId: gbp.id, quantity: 10, priceMinor: 12, currency: "USD" });
    expect(explicit.currency).toBe("USD");
  });

  it("keeps vesting in one shape and refuses a malformed schedule", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const opts = await owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "Vesting options", kind: "option", currency: "GBP", authorisedQuantity: 1_000 });
    const base = { businessId: hz.A.businessId, holderEntityId: hz.A.entityId, securityId: opts.id, quantity: 100, priceMinor: 12, issuedAt: "2026-03-25" };
    const ok = await owner.finance.capTable.createEntry({ ...base, vesting: { months: 48, cliffMonths: 12, startDate: "2026-03-25" } });
    expect(ok.vesting).toMatchObject({ months: 48, cliffMonths: 12, startDate: "2026-03-25" });
    expect(await code(owner.finance.capTable.createEntry({ ...base, vesting: { schedule: "4y" } as never }))).toBe("BAD_REQUEST");
    expect(await code(owner.finance.capTable.createEntry({ ...base, vesting: { months: 12, cliffMonths: 24 } }))).toBe("BAD_REQUEST");
  });

  it("holds issued quantity to the authorized quantity on create, on edit and under concurrency; a duplicate class is a conflict", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const sec = await owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "Audit common", kind: "common", currency: "GBP", authorisedQuantity: 1_000 });
    const entry = await owner.finance.capTable.createEntry({ businessId: hz.A.businessId, holderEntityId: hz.A.entityId, securityId: sec.id, quantity: 900 });
    expect(await code(owner.finance.capTable.createEntry({ businessId: hz.A.businessId, holderEntityId: hz.A.entityId, securityId: sec.id, quantity: 200 }))).toBe("BAD_REQUEST");
    expect(await code(owner.finance.capTable.updateEntry({ businessId: hz.A.businessId, entryId: entry.id, patch: { quantity: 5_000_000 } }))).toBe("BAD_REQUEST");
    expect((await owner.finance.capTable.updateEntry({ businessId: hz.A.businessId, entryId: entry.id, patch: { quantity: 1_000 } })).quantity).toBe("1000.0000"); // the edited entry's old quantity is not counted twice
    expect(await code(owner.finance.capTable.updateEntry({ businessId: hz.A.businessId, entryId: entry.id, patch: { priceMinor: 5 } }))).toBe("OK"); // an edit that does not touch the quantity needs no room

    const pref = await owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "Audit pref", kind: "preferred", currency: "GBP", authorisedQuantity: 100 });
    const results = await Promise.allSettled([80, 80].map((quantity) => owner.finance.capTable.createEntry({ businessId: hz.A.businessId, holderEntityId: hz.A.entityId, securityId: pref.id, quantity })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const issued = (await repos.capTable.listEntries(hz.db, hz.A.businessId)).filter((e) => e.securityId === pref.id).reduce((n, e) => n + Number(e.quantity), 0);
    expect(issued).toBe(80);

    expect(await code(owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "Audit common", kind: "common" }))).toBe("CONFLICT");
    expect(await code(owner.finance.capTable.createSecurity({ businessId: hz.A.businessId, class: "  Audit pref ", kind: "preferred" }))).toBe("CONFLICT");
  });
});

describe("team.humans.list (#356)", () => {
  it("names a member from their CRM team_member record and links it; a member without one has no link", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const person = await repos.entities.create(hz.db, hz.A.businessId, { kind: "team_member", displayName: "Mia Member", identifiers: { user_id: hz.A.memberId }, source: "manual", lawfulBasis: "contract" });
    const humans = await owner.team.humans.list({ businessId: hz.A.businessId });
    const member = humans.find((m) => m.userId === hz.A.memberId)!;
    expect(member).toMatchObject({ displayName: "Mia Member", entityId: person.id });
    const viewer = humans.find((m) => m.userId === hz.A.viewerId)!;
    expect(viewer.entityId).toBeNull();
    // an auth user id is never offered as a CRM record id
    for (const m of humans) if (m.entityId !== null) expect(m.entityId).not.toBe(m.userId);
    expect(humans.filter((m) => m.userId === hz.A.memberId)).toHaveLength(1);
  });
});
