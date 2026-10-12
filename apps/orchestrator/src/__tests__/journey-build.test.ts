/**
 * journeyBuild refines what ingest wrote (BUILD §11.4; audit JM-01, O-30, GTM-21): the first-pass row is updated in place
 * with the builder's output and the models it used, the founder's viewed state and the ingest event are kept, a repeat
 * payment has nothing to build, the data-driven models are fitted once the business has enough conversions, commentary
 * is asked for once per full Customer Update, and an un-narrated win is narrated exactly once (an outage is retried, a
 * refusal is not).
 */
import { ApplicationFailure } from "@temporalio/common";
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { repos } from "@foundmill/db";
import { AppError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPOSER_REFUSED, createJourneyActivities } from "../activities/journey";
import { ComposerUnavailableError, type ComposerClient } from "../composer-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "jb" });
}, 120_000);
afterAll(async () => {
  await t?.close();
});

const minutesAgo = (m: number) => new Date(t.clock.nowMs() - m * 60_000);

function recordingComposer(): ComposerClient & { narrated: string[][]; commented: string[] } {
  const narrated: string[][] = [];
  const commented: string[] = [];
  return {
    baseUrl: "http://composer.test",
    narrated,
    commented,
    async narrate(input) {
      narrated.push(input.eventIds);
      return { inboxItemId: "00000000-0000-4000-8000-000000000001", replayed: false };
    },
    async commentary(input) {
      commented.push(input.journeyId);
      return { lines: [{ text: "First touch.", touchId: null, highlight: false }] };
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
    // In touch order (touchIds is chronological; jsonb keeps object keys in its own order, not insertion order, so never
    // read the weights by position).
    expect(refined.touchIds.map((id) => Math.round(((refined.weights as Record<string, number>)[id] ?? 0) * 10) / 10)).toEqual([0.4, 0.2, 0.4]);
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

describe("commentary", () => {
  it("is asked for once per full Customer Update, never for a conversion that rolls into the daily round-up", async () => {
    const composer = recordingComposer();
    const acts = createJourneyActivities({ ...t.deps, composer });
    const fx = await createBusinessFixture(t.h, `jb-commentary-${Math.random().toString(36).slice(2, 7)}`);
    const businessId = fx.businessId;
    const signups = [];
    for (let i = 0; i < 101; i++) signups.push(await repos.journeys.recordConversion(t.db, businessId, { entityId: fx.entityId, kind: "signup", occurredAt: minutesAgo(1_000 - i) }));
    // The 101st signup is not a full Customer Update (BUILD §11.4 volume rule): no Sonnet call for it.
    const roundUp = await acts.buildJourneyRecord({ businessId, conversionId: signups[100]!.id });
    expect(roundUp.fullMatchDay).toBe(false);
    expect(composer.commented).toEqual([]);
    expect((await repos.journeys.get(t.db, businessId, roundUp.journeyId!)).commentary).toEqual([]);

    const paid = await repos.journeys.recordConversion(t.db, businessId, { entityId: fx.entityId, kind: "payment", amountMinor: 4_900, currency: "EUR", occurredAt: minutesAgo(1) });
    const full = await acts.buildJourneyRecord({ businessId, conversionId: paid.id });
    expect(full.fullMatchDay).toBe(true);
    expect(composer.commented).toEqual([full.journeyId]);
    expect((await repos.journeys.get(t.db, businessId, full.journeyId!)).commentary).toHaveLength(1);
    // A retried build keeps the commentary it has instead of paying for another call.
    await acts.buildJourneyRecord({ businessId, conversionId: paid.id });
    expect(composer.commented).toHaveLength(1);
    expect((await repos.journeys.get(t.db, businessId, full.journeyId!)).commentary).toHaveLength(1);
  }, 120_000);

  it("a composer that refuses (a 4xx) or is down leaves the record standing without commentary", async () => {
    for (const err of [new AppError("composer_rejected", "Composer /v1/commentary returned 422", 422), new ComposerUnavailableError("Composer /v1/commentary unreachable: ECONNREFUSED")]) {
      const acts = createJourneyActivities({ ...t.deps, composer: { ...recordingComposer(), commentary: () => Promise.reject(err) } });
      const paid = await repos.journeys.recordConversion(t.db, t.businessId, { entityId: t.fixture.entityId, kind: "payment", amountMinor: 2_900, currency: "EUR", occurredAt: minutesAgo(3) });
      const built = await acts.buildJourneyRecord({ businessId: t.businessId, conversionId: paid.id });
      expect(built.journeyId).toBeTruthy();
      expect((await repos.journeys.get(t.db, t.businessId, built.journeyId!)).commentary).toEqual([]);
    }
  });
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

  it("retries an outage but not a refusal (a 4xx would pay for the same model calls on every attempt)", async () => {
    const event = await repos.events.write(t.db, t.businessId, { type: "customer.converted", actor: { kind: "system", id: "ingest" }, entityIds: [], payload: {}, occurredAt: minutesAgo(1) });
    const failing = (err: Error) => createJourneyActivities({ ...t.deps, composer: { ...recordingComposer(), narrate: () => Promise.reject(err) } });
    // The composer's 4xx verdict (links still invalid after its re-ask) carries its HTTP status.
    const refused = failing(new AppError("composer_rejected", "Composer /v1/narrate returned 422", 422));
    await expect(refused.narrateConversion({ businessId: t.businessId, eventId: event.id })).rejects.toMatchObject({ type: COMPOSER_REFUSED, nonRetryable: true });
    for (const status of [408, 429]) {
      const busy = await failing(new AppError("busy", `Composer /v1/narrate returned ${status}`, status)).narrateConversion({ businessId: t.businessId, eventId: event.id }).catch((e: unknown) => e);
      expect(busy).not.toBeInstanceOf(ApplicationFailure);
    }
    const down = failing(new ComposerUnavailableError("Composer /v1/narrate unreachable: ECONNREFUSED"));
    const outage = await down.narrateConversion({ businessId: t.businessId, eventId: event.id }).catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(ComposerUnavailableError);
    expect(outage).not.toBeInstanceOf(ApplicationFailure);
  });
});
