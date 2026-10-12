/**
 * journeyBuild refines what ingest wrote (BUILD §11.4; audit JM-01, O-30, GTM-21): the first-pass row is updated in place
 * with the builder's output and the models it used, the founder's viewed state and the ingest event are kept, a repeat
 * payment has nothing to build, the data-driven models are fitted once the business has enough conversions, and an
 * un-narrated win is narrated exactly once.
 */
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJourneyActivities } from "../activities/journey";
import type { ComposerClient } from "../composer-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "jb" });
}, 120_000);
afterAll(async () => {
  await t?.close();
});

const minutesAgo = (m: number) => new Date(t.clock.nowMs() - m * 60_000);

function recordingComposer(): ComposerClient & { narrated: string[][] } {
  const narrated: string[][] = [];
  return {
    baseUrl: "http://composer.test",
    narrated,
    async narrate(input) {
      narrated.push(input.eventIds);
      return { inboxItemId: "00000000-0000-4000-8000-000000000001", replayed: false };
    },
    async commentary() {
      return { lines: [] };
    },
    async chapterTitle() {
      return { title: "" };
    },
  };
}

describe("buildJourneyRecord", () => {
  it("refines the ingest first pass in place: 40/20/40 weights, the models used, viewed state and event kept", async () => {
    const acts = createJourneyActivities(t.deps);
    const entity = await repos.entities.create(t.db, t.businessId, { kind: "person", displayName: "Grace Hopper", identifiers: { email: "grace@example.com" } });
    await repos.journeys.recordTouches(t.db, t.businessId, [
      { entityId: entity.id, occurredAt: minutesAgo(900), channelKey: "seo", kind: "visit" },
      { entityId: entity.id, occurredAt: minutesAgo(600), channelKey: "social", kind: "visit" },
      { entityId: entity.id, occurredAt: minutesAgo(300), channelKey: "email_automation", kind: "email_click" },
    ]);
    const conversion = await repos.journeys.recordConversion(t.db, t.businessId, { entityId: entity.id, kind: "payment", amountMinor: 4_900, currency: "EUR", occurredAt: minutesAgo(1) });
    // What ingest's first pass looked like before the fix: no touches, no curve, no team, no model.
    const firstPass = await repos.journeys.create(t.db, t.businessId, { conversionId: conversion.id, matchdayLevel: "cup" });
    await repos.journeys.markViewed(t.db, t.businessId, firstPass.id);

    const result = await acts.buildJourneyRecord({ businessId: t.businessId, conversionId: conversion.id });
    expect(result.journeyId).toBe(firstPass.id);
    expect(result.eventId).toBeNull(); // ingest already announced the win
    const refined = await repos.journeys.get(t.db, t.businessId, firstPass.id);
    expect(refined.touchIds).toHaveLength(3);
    expect(Object.values(refined.weights).map((w) => Math.round(w * 10) / 10)).toEqual([0.4, 0.2, 0.4]);
    expect(refined.xcSeries.length).toBe(4); // three touches and the conversion point
    expect(refined.attributionModel).toBe("position_based_40_20_40");
    expect(refined.xcModelSource).toBe("archetype_prior");
    expect(refined.viewedAt).not.toBeNull();
  });

  it("has nothing to build for a repeat payment", async () => {
    const acts = createJourneyActivities(t.deps);
    const renewal = await repos.journeys.recordConversion(t.db, t.businessId, { entityId: t.fixture.entityId, kind: "payment", amountMinor: 4_900, currency: "EUR", occurredAt: minutesAgo(2), firstPayment: false });
    const result = await acts.buildJourneyRecord({ businessId: t.businessId, conversionId: renewal.id });
    expect(result).toMatchObject({ journeyId: null, eventId: null, fullMatchDay: false });
    expect(await repos.journeys.forConversion(t.db, t.businessId, renewal.id)).toBeNull();
  });

  it("fits the Markov and xC models once the business has 200 conversions, and stores them on the record", async () => {
    const fx = await createBusinessFixture(t.h, `jb-models-${Math.random().toString(36).slice(2, 7)}`);
    const businessId = fx.businessId;
    const channels = ["seo", "social", "paid_ads", "email_automation"] as const;
    for (let i = 0; i < 200; i++) {
      const person = await repos.entities.create(t.db, businessId, { kind: "person", displayName: `Customer ${i}` });
      await repos.journeys.recordTouches(t.db, businessId, [
        { entityId: person.id, occurredAt: minutesAgo(2_000 + i), channelKey: channels[i % 4]!, kind: "visit" },
        { entityId: person.id, occurredAt: minutesAgo(1_000 + i), channelKey: channels[(i + 1) % 4]!, kind: "visit" },
      ]);
      await repos.journeys.recordConversion(t.db, businessId, { entityId: person.id, kind: "signup", occurredAt: minutesAgo(500 + i) });
    }
    const buyer = await repos.entities.create(t.db, businessId, { kind: "person", displayName: "Big Buyer" });
    await repos.journeys.recordTouches(t.db, businessId, [
      { entityId: buyer.id, occurredAt: minutesAgo(400), channelKey: "seo", kind: "visit" },
      { entityId: buyer.id, occurredAt: minutesAgo(200), channelKey: "paid_ads", kind: "ad_click" },
    ]);
    const conversion = await repos.journeys.recordConversion(t.db, businessId, { entityId: buyer.id, kind: "payment", amountMinor: 9_900, currency: "EUR", occurredAt: minutesAgo(1) });

    const result = await createJourneyActivities(t.deps).buildJourneyRecord({ businessId, conversionId: conversion.id });
    const journey = await repos.journeys.get(t.db, businessId, result.journeyId!);
    expect(journey.attributionModel).toBe("data_driven_markov");
    expect(journey.xcModelSource).toBe("trained");
    expect(Object.values(journey.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  }, 120_000);
});

describe("narrateConversion", () => {
  it("narrates an un-narrated customer.converted once, and skips one that is already narrated", async () => {
    const composer = recordingComposer();
    const acts = createJourneyActivities({ ...t.deps, composer });
    const event = await repos.events.write(t.db, t.businessId, { type: "customer.converted", actor: { kind: "system", id: "ingest" }, entityIds: [], payload: {}, occurredAt: minutesAgo(1) });
    expect(await acts.narrateConversion({ businessId: t.businessId, eventId: event.id })).toMatchObject({ narrated: true });
    expect(composer.narrated).toEqual([[event.id]]);
    await repos.events.markNarrated(t.db, t.businessId, [event.id]);
    expect(await acts.narrateConversion({ businessId: t.businessId, eventId: event.id })).toMatchObject({ narrated: false });
    expect(composer.narrated).toHaveLength(1);
  });
});
