import { repos } from "@foundmill/db";
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
      { agentId, name: "Chief", role: "assistant manager", departmentId: null, contribution: 0.4, touchIds: [t3.id], rating: 10 },
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
});
