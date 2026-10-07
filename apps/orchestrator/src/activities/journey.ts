/**
 * journeyBuild activity (BUILD §11.4): conversion → candidate touches (the entity's own and its stitched visitors')
 * → `buildJourney` from packages/journey (attribution, xC, team sheet, Match Day level and the volume rule) →
 * `journeys` row → optional composer commentary → `customer.converted` (the composer writes the customer_won item).
 */
import { buildJourney, type ConsentState, type TouchInput } from "@foundmill/journey";
import { repos } from "@foundmill/db";
import type { ChannelKey } from "@foundmill/shared";
import { ComposerUnavailableError } from "../composer-client";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { JourneyBuildInput, JourneyBuildResult } from "./types";

export function createJourneyActivities(deps: OrchestratorDeps) {
  return {
    async buildJourneyRecord(input: JourneyBuildInput): Promise<JourneyBuildResult> {
      const { db } = deps;
      const businessId = input.businessId;
      const existing = await repos.journeys.forConversion(db, businessId, input.conversionId);
      const conversion = await repos.journeys.getConversion(db, businessId, input.conversionId);
      const [business, nthOfKind, counts, p75, agentsPage, channels] = await Promise.all([
        repos.businesses.get(db, businessId),
        repos.journeys.nthOfKind(db, businessId, conversion.id),
        repos.journeys.countConversions(db, businessId),
        repos.journeys.paymentPercentile75(db, businessId),
        repos.agents.list(db, businessId, { limit: 200 }),
        repos.channels.list(db, businessId),
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
      const touches: TouchInput[] = touchRows.map((t) => ({ id: t.id, businessId, visitorId: t.visitorId, entityId: t.entityId, occurredAt: new Date(t.occurredAt).toISOString(), channelKey: t.channelKey, campaignId: t.campaignId, kind: t.kind as TouchInput["kind"], source: t.source as TouchInput["source"] }));
      const totalConversions = Object.values(counts).reduce((a, b) => a + b, 0);
      const journey = buildJourney({
        conversion: { id: conversion.id, businessId, entityId: conversion.entityId, kind: conversion.kind, amountMinor: Number(conversion.amountMinor), currency: conversion.currency ?? "EUR", occurredAt: new Date(conversion.occurredAt).toISOString(), sourceEventId: conversion.sourceEventId },
        touches,
        agents: agentsPage.items.map((a) => ({ agentId: a.id, name: a.name, role: a.role, departmentId: a.departmentIds[0] ?? null, channelKeys: channels.filter((c) => c.ownerAgentId === a.id).map((c) => c.channelKey as ChannelKey) })),
        consent,
        counts: { conversions: totalConversions, nthOfKind, valuePercentile75Minor: p75 },
        archetype: business.archetype ?? undefined,
        visitorIds,
        businessId,
      });
      const row = existing
        ? existing
        : await repos.journeys.create(db, businessId, { conversionId: conversion.id, touchIds: journey.touchIds, weights: journey.weights, xcSeries: journey.xcSeries, commentary: [], agents: journey.agents, matchdayLevel: journey.matchdayLevel });
      // Commentary is Sonnet's job in apps/composer; the journey stands without it.
      try {
        const c = await deps.composer.commentary({ businessId, journeyId: row.id });
        if (c.lines.length > 0) await repos.journeys.setCommentary(db, businessId, row.id, c.lines);
      } catch (err) {
        if (!(err instanceof ComposerUnavailableError)) throw err;
      }
      const fullMatchDay = journey.fullMatchDay;
      let eventId: string | null = null;
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
  };
}

export type JourneyActivities = ReturnType<typeof createJourneyActivities>;
