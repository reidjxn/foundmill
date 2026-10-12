/**
 * journeyBuild activities (BUILD §11.4): conversion → candidate touches (the entity's own and its stitched visitors')
 * → `buildJourney` from packages/journey (attribution, xC, team sheet, Match Day level and the volume rule) → `journeys`
 * row → optional composer commentary → `customer.converted` (the composer writes the customer_won item).
 *
 * Ingest writes a first pass in the delivery's transaction (40/20/40 over the customer's own touches, the archetype
 * prior, no team) and the `customer.converted` event, then starts `journeyBuild` (`journey:{conversionId}`). This
 * activity refines that row in place: the team who were involved, acquisition cost from channel metrics (an Estimate),
 * the Markov removal-effect model from 200 labeled conversions and the trained xC model from 50, both fitted on the
 * business's recent paths, and the models actually used, which journey.get labels the record with. The founder's
 * viewed state is kept; the event ingest wrote is not repeated. A repeat payment has no journey to build.
 *
 * The milestones a payment reached (first customer, an MRR line, ...) are awarded again here, idempotently, in case the
 * delivery's own award was missed, and the journey matview is refreshed soon after (`requestJourneyDailyRefresh`).
 */
import { LIMITS } from "@foundmill/config";
import { archetypePrior, buildJourney, buildMarkovModel, conversionPathsFromTouches, trainXcModel, Touch, TouchKind, xcSamplesFromPaths, type ConsentState, type MarkovModel, type XcModel } from "@foundmill/journey";
import { awardMilestonesForConversion, repos } from "@foundmill/db";
import type { Archetype, ChannelKey } from "@foundmill/shared";
import { ComposerRequestError, ComposerUnavailableError } from "../composer-client";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { requestJourneyDailyRefresh } from "../journey-refresh";
import type { JourneyBuildInput, JourneyBuildResult } from "./types";

const DAY_MS = 86_400_000;
/** How far back the paths the data-driven models are fitted on reach, and how many touches at most. */
export const TRAINING_WINDOW_DAYS = 180;
export const TRAINING_MAX_TOUCHES = 5_000;

export function createJourneyActivities(deps: OrchestratorDeps) {
  /** The models fitted on the business's recent labeled paths, when it has enough conversions for them to be used. */
  async function fittedModels(businessId: string, archetype: Archetype, conversions: number, until: Date): Promise<{ markov: MarkovModel | null; xcModel: XcModel | null }> {
    if (conversions < Math.min(LIMITS.xcArchetypePriorUntilConversions, LIMITS.attributionPositionBasedUntilConversions)) return { markov: null, xcModel: null };
    const paths = await repos.journeys.trainingPaths(deps.db, businessId, { since: new Date(until.getTime() - TRAINING_WINDOW_DAYS * DAY_MS), maxTouches: TRAINING_MAX_TOUCHES });
    if (paths.length === 0) return { markov: null, xcModel: null };
    const groups = paths.map((p) => ({ converted: p.converted, touches: p.touches.map((t) => ({ id: t.id, occurredAt: t.occurredAt.toISOString(), channelKey: t.channelKey, kind: TouchKind.safeParse(t.kind).data ?? "visit", entityId: t.entityId })) }));
    const markov = conversions >= LIMITS.attributionPositionBasedUntilConversions ? buildMarkovModel(conversionPathsFromTouches(groups)) : null;
    const xcModel = conversions >= LIMITS.xcArchetypePriorUntilConversions ? trainXcModel(xcSamplesFromPaths(groups), { archetype, init: archetypePrior(archetype), epochs: 60, conversionCount: conversions }) : null;
    return { markov, xcModel };
  }

  return {
    async buildJourneyRecord(input: JourneyBuildInput): Promise<JourneyBuildResult> {
      const { db } = deps;
      const businessId = input.businessId;
      const existing = await repos.journeys.forConversion(db, businessId, input.conversionId);
      const conversion = await repos.journeys.getConversion(db, businessId, input.conversionId);
      if (conversion.kind === "payment") await awardMilestonesForConversion(db, businessId, conversion.id);
      requestJourneyDailyRefresh(deps);
      // A renewal or a repeat order is revenue, not a customer won: there is no Customer Update to build.
      if (conversion.kind === "payment" && !conversion.firstPayment) return { journeyId: existing?.id ?? null, matchdayLevel: "cup", fullMatchDay: false, eventId: null };
      const [business, nthOfKind, counts, p75, agentsPage, channels, metrics] = await Promise.all([
        repos.businesses.get(db, businessId),
        repos.journeys.nthOfKind(db, businessId, conversion.id),
        repos.journeys.countConversions(db, businessId),
        repos.journeys.paymentPercentile75(db, businessId),
        repos.agents.list(db, businessId, { limit: 200 }),
        repos.channels.list(db, businessId),
        repos.channels.metricsSummary(db, businessId).catch(() => null),
      ]);
      const touchRows = conversion.entityId ? await repos.journeys.pathForEntity(db, businessId, conversion.entityId, new Date(conversion.occurredAt)) : [];
      let consent: ConsentState = "unknown";
      const visitorIds = [...new Set(touchRows.map((t) => t.visitorId).filter((v): v is string => Boolean(v)))];
      if (visitorIds.length > 0) {
        try {
          const visitor = await repos.journeys.getVisitor(db, businessId, visitorIds[0]!);
          consent = visitor.consentState as ConsentState;
        } catch {
          consent = "unknown";
        }
      }
      // A stored touch the builder cannot read (unknown kind → visit, malformed source → left out) never fails the build.
      const touches: Touch[] = [];
      for (const t of touchRows) {
        const parsed = Touch.safeParse({ id: t.id, businessId, visitorId: t.visitorId, entityId: t.entityId, occurredAt: new Date(t.occurredAt).toISOString(), channelKey: t.channelKey, campaignId: t.campaignId, kind: TouchKind.safeParse(t.kind).data ?? "visit", source: t.source ?? {} });
        if (parsed.success) touches.push(parsed.data);
      }
      const totalConversions = Object.values(counts).reduce((a, b) => a + b, 0);
      const archetype = (business.archetype ?? "b2b_saas") as Archetype;
      const { markov, xcModel } = await fittedModels(businessId, archetype, totalConversions, new Date(conversion.occurredAt));
      const cpaByChannelMinor: Partial<Record<ChannelKey, number>> = {};
      for (const c of metrics?.channels ?? []) if (c.cpaMinor !== null) cpaByChannelMinor[c.channelKey] = c.cpaMinor;
      const journey = buildJourney({
        conversion: { id: conversion.id, businessId, entityId: conversion.entityId, kind: conversion.kind, amountMinor: Number(conversion.amountMinor), currency: conversion.currency ?? "EUR", occurredAt: new Date(conversion.occurredAt).toISOString(), sourceEventId: conversion.sourceEventId, firstPayment: conversion.firstPayment },
        touches,
        agents: agentsPage.items.map((a) => ({ agentId: a.id, name: a.name, role: a.role, departmentId: a.departmentIds[0] ?? null, channelKeys: channels.filter((c) => c.ownerAgentId === a.id).map((c) => c.channelKey as ChannelKey) })),
        consent,
        counts: { conversions: totalConversions, nthOfKind, valuePercentile75Minor: p75 },
        archetype,
        markov,
        xcModel,
        costs: { cpaByChannelMinor },
        visitorIds,
        businessId,
      });
      // Upsert on the conversion: the first pass is replaced by the refined record (viewed_at is not touched).
      const row = await repos.journeys.create(db, businessId, {
        conversionId: conversion.id,
        touchIds: journey.touchIds,
        weights: journey.weights,
        xcSeries: journey.xcSeries,
        commentary: existing?.commentary ?? [],
        agents: journey.agents,
        matchdayLevel: journey.matchdayLevel,
        attributionModel: journey.attributionModel,
        xcModelSource: journey.xcModelSource,
      });
      // Commentary is Sonnet's job in apps/composer; the journey stands without it, whether the composer is down or
      // turned the request down (a 4xx), so the win is still announced.
      try {
        const c = await deps.composer.commentary({ businessId, journeyId: row.id });
        if (c.lines.length > 0) await repos.journeys.setCommentary(db, businessId, row.id, c.lines);
      } catch (err) {
        if (!(err instanceof ComposerUnavailableError) && !(err instanceof ComposerRequestError)) throw err;
        deps.log.warn({ businessId, journeyId: row.id, err: err.message }, "journey commentary skipped");
      }
      const fullMatchDay = journey.fullMatchDay;
      let eventId: string | null = null;
      // Ingest wrote customer.converted with its first pass; only a journey built from nothing announces the win here.
      if (conversion.entityId && !existing) {
        const ev = await emitEvent(db, {
          businessId,
          type: "customer.converted",
          actor: systemActor,
          entityIds: [conversion.entityId],
          payload: {
            entityId: conversion.entityId,
            conversionId: conversion.id,
            journeyId: row.id,
            kind: conversion.kind,
            matchdayLevel: journey.matchdayLevel,
            amount: Number(conversion.amountMinor) > 0 ? { amountMinor: Number(conversion.amountMinor), currency: conversion.currency ?? "EUR" } : null,
            nthOfKind,
            fullMatchDay,
            captainChannelKey: journey.captain?.channelKey ?? null,
            touchCount: journey.stats.touchCount,
            timeToConvertHours: journey.stats.timeToConvertHours,
            acquisitionCost: journey.stats.acquisitionCostMinor === null ? null : { amountMinor: journey.stats.acquisitionCostMinor, currency: journey.stats.currency },
          },
        });
        eventId = ev.id;
      }
      return { journeyId: row.id, matchdayLevel: journey.matchdayLevel, fullMatchDay, eventId };
    },

    /**
     * Narrates a `customer.converted` that is still un-narrated (ingest's own narration failed): the customer_won item
     * arrives late rather than never. A composer outage throws so Temporal retries with backoff.
     */
    async narrateConversion(input: { businessId: string; eventId: string }): Promise<{ narrated: boolean; inboxItemId: string | null }> {
      const event = await repos.events.get(deps.db, input.businessId, input.eventId);
      if (event.narrated) return { narrated: false, inboxItemId: null };
      const out = await deps.composer.narrate({ businessId: input.businessId, eventIds: [event.id] });
      return { narrated: true, inboxItemId: out.inboxItemId };
    },
  };
}

export type JourneyActivities = ReturnType<typeof createJourneyActivities>;
