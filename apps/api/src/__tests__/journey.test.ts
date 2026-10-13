import { conversions, entities, repos } from "@foundmill/db";
import { eq } from "drizzle-orm";
import { Journey } from "@foundmill/journey";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

describe("journey.get returns the full Journey record (BUILD §11.4, AC-11.4.3)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "journey" });
  }, 120_000);
  afterAll(() => hz.close());

  it("derives channels, captain, standout agent, model labels, consent, nth of kind and stats server-side, deterministically", async () => {
    const { businessId, entityId, visitorId, agentId, agent2Id } = hz.A;
    const base = Date.parse("2026-09-01T10:00:00.000Z");
    await repos.journeys.setConsent(hz.db, businessId, visitorId, "granted");
    const t1 = await repos.journeys.recordTouch(hz.db, businessId, { visitorId, occurredAt: new Date(base), channelKey: "seo", kind: "visit", source: { utm: { source: "google", medium: "organic" } } });
    const t2 = await repos.journeys.recordTouch(hz.db, businessId, { visitorId, entityId, occurredAt: new Date(base + 3_600_000), channelKey: "email_automation", kind: "email_click", source: { agentId: agent2Id, label: "Opened 'Welcome'" } });
    const t3 = await repos.journeys.recordTouch(hz.db, businessId, { entityId, occurredAt: new Date(base + 2 * 3_600_000), channelKey: "lead_generation", kind: "call", source: { agentId } });
    const conversion = await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "payment", amountMinor: 9900, currency: "EUR", occurredAt: new Date(base + 3 * 3_600_000) });
    const weights = { [t1.id]: 0.4, [t2.id]: 0.2, [t3.id]: 0.4 };
    const agents = [
      { agentId, name: "Chief", role: "Chief of Staff", departmentId: null, contribution: 0.4, touchIds: [t3.id], rating: 10 },
      { agentId: agent2Id, name: "Engineer", role: null, departmentId: null, contribution: 0.2, touchIds: [t2.id], rating: 8 },
    ];
    const row = await repos.journeys.create(hz.db, businessId, { conversionId: conversion.id, touchIds: [t1.id, t2.id, t3.id], weights, xcSeries: [{ index: 0, touchId: t1.id, at: new Date(base).toISOString(), p: 0.2, cumulative: 0.2 }], commentary: [], agents, matchdayLevel: "cup" });

    const owner = hz.caller({ userId: hz.A.ownerId });
    const first = await owner.journey.get({ businessId, journeyId: row.id });
    const j = first.journey;
    expect(() => Journey.parse(j)).not.toThrow();
    expect(j.id).toBe(row.id);
    expect(j.kind).toBe("payment");
    expect(j.touchIds).toEqual([t1.id, t2.id, t3.id]);
    // Highest weight first (ties in the builder's order), the team sheet order.
    expect(new Set(j.channels.map((c) => c.channelKey))).toEqual(new Set(["seo", "lead_generation", "email_automation"]));
    expect(j.channels[2]?.channelKey).toBe("email_automation");
    expect(j.channels.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6);
    // Tie between t1 and t3 at 0.4: the later touch is the captain and its agent is the one named on the touch.
    expect(j.captain).toEqual({ touchId: t3.id, channelKey: "lead_generation", agentId, weight: 0.4 });
    expect(j.playerOfTheMatch).toBe(agentId);
    expect(j.agents.map((a) => a.agentId)).toEqual([agentId, agent2Id]);
    expect(j.attributionModel).toBe("position_based_40_20_40");
    expect(j.xcModelSource).toBe("archetype_prior");
    expect(j.consent).toBe("granted");
    expect(j.partialJourney).toBe(false);
    // The fixture's two payments happened today; this conversion (September) is the business's first payment by time.
    expect(j.nthOfKind).toBe(1);
    expect(j.fullMatchDay).toBe(true);
    expect(j.stats).toMatchObject({ touchCount: 3, firstTouchAt: new Date(base).toISOString(), timeToConvertHours: 3, currency: "EUR", acquisitionCostMinor: null });
    expect(j.convertedAt).toBe(conversion.occurredAt.toISOString());
    expect(j.xcSeries).toHaveLength(1);
    expect(first.speedHint).toBe("full");
    expect(first.journeyTouches.every((t) => t.firstParty)).toBe(true);
    // Compatible with the wave-2 shape the web still reads.
    expect(first.conversion.id).toBe(conversion.id);
    expect(first.touches).toHaveLength(3);
    expect(first.entity?.id).toBe(entityId);

    const second = await owner.journey.get({ businessId, journeyId: row.id });
    expect(second.journey).toEqual(j);

    // Consent withdrawn → partial journey flag, same record otherwise.
    await repos.journeys.setConsent(hz.db, businessId, visitorId, "withdrawn");
    const partial = await owner.journey.get({ businessId, journeyId: row.id });
    expect(partial.journey.consent).toBe("withdrawn");
    expect(partial.journey.partialJourney).toBe(true);

    // Cross-tenant: B's owner cannot read A's journey.
    await expect(hz.caller({ userId: hz.B.ownerId }).journey.get({ businessId, journeyId: row.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).journey.get({ businessId: hz.B.businessId, journeyId: row.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("labels the record with the models the builder stored, not with what the conversion count implies", async () => {
    const { businessId, entityId } = hz.A;
    const conversion = await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "payment", amountMinor: 2900, currency: "EUR", occurredAt: new Date("2026-09-05T10:00:00.000Z") });
    // A business with a handful of conversions whose record was nonetheless built with the trained models (stored on the row).
    const row = await repos.journeys.create(hz.db, businessId, { conversionId: conversion.id, matchdayLevel: "cup", attributionModel: "data_driven_markov", xcModelSource: "trained" });
    const { journey } = await hz.caller({ userId: hz.A.ownerId }).journey.get({ businessId, journeyId: row.id });
    expect(journey.attributionModel).toBe("data_driven_markov");
    expect(journey.xcModelSource).toBe("trained");
  });

  it("journey.list and journey.attribution read consent the way journey.get does; the model in use counts every labeled conversion", async () => {
    const { businessId, entityId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    // A win through a visitor who denied consent, after the win of the first test (its visitor has withdrawn by now).
    const denied = await repos.journeys.upsertVisitor(hz.db, businessId, { anonId: "attribution-denied", entityId, consentState: "denied" });
    const touch = await repos.journeys.recordTouch(hz.db, businessId, { visitorId: denied.id, entityId, occurredAt: new Date("2026-09-10T09:00:00.000Z"), channelKey: "social" });
    const win = await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "activation", occurredAt: new Date("2026-09-10T10:00:00.000Z") });
    const deniedRow = await repos.journeys.create(hz.db, businessId, { conversionId: win.id, touchIds: [touch.id], matchdayLevel: "friendly" });

    const list = await owner.journey.list({ businessId, limit: 50 });
    for (const row of list.items) {
      const { journey } = await owner.journey.get({ businessId, journeyId: row.id });
      expect(row.partialJourney, `journey ${row.id}`).toBe(journey.partialJourney);
      expect(row.consent).toBe(journey.consent);
    }
    expect(list.items.find((j) => j.id === deniedRow.id)?.partialJourney).toBe(true);

    const counts = await repos.journeys.countConversions(hz.db, businessId);
    const labeled = Object.values(counts).reduce((s, n) => s + n, 0);
    const before = await owner.journey.attribution({ businessId });
    expect(before).toMatchObject({ conversionCount: labeled, byKind: counts, attributionModel: "position_based_40_20_40", threshold: 200, remaining: 200 - labeled, journeys: list.items.length, partialJourneys: list.items.filter((j) => j.partialJourney).length });

    // Past 200 labeled conversions the model is data-driven, though only a handful of them have a Customer Update (the
    // screen used to count payments among the newest 200 journeys and claimed position-based for good).
    await hz.db.insert(conversions).values(Array.from({ length: 200 }, (_, i) => ({ businessId, entityId, kind: "signup" as const, occurredAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60_000) })));
    const after = await owner.journey.attribution({ businessId });
    expect(after).toMatchObject({ conversionCount: labeled + 200, attributionModel: "data_driven_markov", remaining: 0, journeys: before.journeys });
    // A record built before the models were stored is labeled with the same count, so the replay agrees with the screen.
    const { journey } = await owner.journey.get({ businessId, journeyId: deniedRow.id });
    expect(journey.attributionModel).toBe(after.attributionModel);

    // Links that only know the conversion resolve through journey.forConversion, whatever the age of the win.
    expect(await owner.journey.forConversion({ businessId, conversionId: win.id })).toEqual({ journeyId: deniedRow.id });
    const bare = await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "signup", occurredAt: new Date("2025-01-01T00:00:00.000Z") });
    expect(await owner.journey.forConversion({ businessId, conversionId: bare.id })).toEqual({ journeyId: null });
    // Tenancy: another business never resolves A's conversion, and A's numbers never include B's.
    expect(await hz.caller({ userId: hz.B.ownerId }).journey.forConversion({ businessId: hz.B.businessId, conversionId: win.id })).toEqual({ journeyId: null });
    expect((await hz.caller({ userId: hz.B.ownerId }).journey.attribution({ businessId: hz.B.businessId })).conversionCount).toBeLessThan(200);
  });
});

describe("journey.ribbon rows (the Ribbon's daily data)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "ribbon" });
  }, 120_000);
  afterAll(() => hz.close());

  it("sends the business-wide row with departmentId null and every amount as a number", async () => {
    const { businessId, entityId } = hz.A;
    await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "payment", amountMinor: 4200, currency: "EUR", occurredAt: new Date("2026-09-02T09:00:00.000Z") });
    await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "signup", amountMinor: 0, currency: "EUR", occurredAt: new Date("2026-09-02T08:00:00.000Z") });
    await repos.journeys.refreshDaily(hz.db);
    const owner = hz.caller({ userId: hz.A.ownerId });
    const res = await owner.journey.ribbon({ businessId, from: "2026-09-01", to: "2026-09-03" });
    const business = res.rows.filter((r) => r.day === "2026-09-02" && r.departmentId === null);
    expect(business).toHaveLength(1);
    expect(business[0]).toMatchObject({ revenueMinor: 4200, payments: 1, signups: 1 });
    expect(res.rows.some((r) => r.departmentId === "00000000-0000-0000-0000-000000000000")).toBe(false);
    for (const r of res.rows) {
      expect(typeof r.agentHours).toBe("number");
      expect(typeof r.revenueMinor).toBe("number");
      expect(typeof r.spendMinor).toBe("number");
    }
  });

  it("names every conversion of a day and links the ones with a Customer Update (journey.roundup and journey.ribbon)", async () => {
    const { businessId, entityId } = hz.A;
    const paid = await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "payment", amountMinor: 1500, currency: "EUR", occurredAt: new Date("2026-08-14T09:00:00.000Z") });
    const anonymous = await repos.journeys.recordConversion(hz.db, businessId, { entityId: null, kind: "signup", amountMinor: 0, currency: "EUR", occurredAt: new Date("2026-08-14T07:00:00.000Z") });
    const update = await repos.journeys.create(hz.db, businessId, { conversionId: paid.id, touchIds: [], weights: {}, xcSeries: [], commentary: [], agents: [], matchdayLevel: "friendly" });
    const [entity] = await hz.db.select({ name: entities.displayName }).from(entities).where(eq(entities.id, entityId));
    const owner = hz.caller({ userId: hz.A.ownerId });
    const day = await owner.journey.roundup({ businessId, day: "2026-08-14" });
    const byId = new Map(day.conversions.map((c) => [c.id, c] as const));
    expect(byId.get(paid.id)).toMatchObject({ entityName: entity!.name, journeyId: update.id, kind: "payment", occurredAt: "2026-08-14T09:00:00.000Z" });
    expect(byId.get(anonymous.id)).toMatchObject({ entityName: null, journeyId: null });
    const ribbon = await owner.journey.ribbon({ businessId, from: "2026-08-01", to: "2026-08-31" });
    expect(ribbon.conversions.find((c) => c.id === paid.id)).toMatchObject({ entityName: entity!.name, journeyId: update.id });
  });

  it("a renewal is revenue on the day's row but not a customer marker or a paying customer", async () => {
    const { businessId, entityId } = hz.A;
    const renewal = await repos.journeys.recordConversion(hz.db, businessId, { entityId, kind: "payment", amountMinor: 4200, currency: "EUR", occurredAt: new Date("2026-07-20T09:00:00.000Z"), firstPayment: false });
    await repos.journeys.refreshDaily(hz.db);
    const owner = hz.caller({ userId: hz.A.ownerId });
    const res = await owner.journey.ribbon({ businessId, from: "2026-07-20", to: "2026-07-20" });
    expect(res.rows.find((r) => r.day === "2026-07-20" && r.departmentId === null)).toMatchObject({ revenueMinor: 4200, payments: 0 });
    expect(res.conversions.map((c) => c.id)).not.toContain(renewal.id);
    expect(res.conversionCount).toBe(0);
    const day = await owner.journey.roundup({ businessId, day: "2026-07-20" });
    expect(day.conversions).toEqual([]);
  });
});

