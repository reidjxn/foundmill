/**
 * Conversions and the first Match Day record (BUILD §11.4 "Triggers", §8.1 `customer.converted`).
 *
 * Signups, activations and payments arriving as platform events become `conversions` rows in the same
 * transaction as the event, so the journey tables and the event log can never disagree. The journey record
 * is created here as a first pass (the entity's own touches, the closer as captain, the volume rule) so the
 * composer can write the red/gold `customer_won` item within seconds (AC-11.4.1); the orchestrator's
 * `journeyBuild` workflow refines attribution, xC and commentary afterwards. Every number here that is not
 * counted from rows is labelled an estimate on the event's `acquisitionCost` (null until the journey builder
 * computes it).
 */
import { repos, type Conversion, type Journey } from "@foundmill/db";
import type { Executor } from "@foundmill/db/repos/_shared";
import type { PlatformEvent } from "@foundmill/events";
import { buildEvent, type WriteEventInput } from "@foundmill/events";
import { MATCHDAY_LEVEL_FOR_KIND, NotFoundError, type Actor, type ChannelKey, type ConversionKind } from "@foundmill/shared";

/** The first hundred of a kind always get a full Match Day; afterwards only payments above the 75th percentile (BUILD §11.4). */
export const FULL_MATCH_DAY_UNTIL = 100;

export interface ConversionFacts {
  kind: ConversionKind;
  entityId: string;
  amountMinor: number;
  /** A payment's own currency; null (a sign-up or an activation, no money) takes the business's own (0025). */
  currency: string | null;
  conversionRef: string;
}

/** Which conversion a platform event represents, or null when it is not a conversion trigger. */
export function conversionFactsFor(event: PlatformEvent): ConversionFacts | null {
  switch (event.type) {
    case "signup.created":
      return { kind: "signup", entityId: event.payload.entityId, amountMinor: 0, currency: null, conversionRef: event.payload.conversionId };
    case "activation.reached":
      return { kind: "activation", entityId: event.payload.entityId, amountMinor: 0, currency: null, conversionRef: event.payload.conversionId };
    case "payment.received":
      return { kind: "payment", entityId: event.payload.entityId, amountMinor: event.payload.amount.amountMinor, currency: event.payload.amount.currency, conversionRef: event.payload.conversionId };
    default:
      return null;
  }
}

/** Volume rule (BUILD §11.4): full ceremony until the 100th of a kind; then payments strictly above p75 (or flagged accounts). */
export function shouldPlayFullMatchDay(kind: ConversionKind, nthOfKind: number, amountMinor: number, p75: number | null, flagged = false): boolean {
  if (nthOfKind <= FULL_MATCH_DAY_UNTIL) return true;
  if (flagged) return true;
  if (kind !== "payment") return false;
  return p75 !== null && amountMinor > p75;
}

export interface ConversionOutcome {
  conversion: Conversion;
  journey: Journey;
  /** The `customer.converted` event written for this conversion. */
  convertedEventId: string;
  nthOfKind: number;
  fullMatchDay: boolean;
}

/** Hours between two instants, never negative. */
const hoursBetween = (a: Date, b: Date): number => Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);

/**
 * Record the conversion, a first-pass journey and the `customer.converted` event for a conversion-kind
 * platform event that was just written. Runs inside the caller's transaction.
 */
export async function recordConversionForEvent(
  tx: Executor,
  event: PlatformEvent,
  facts: ConversionFacts,
  actor: Actor,
  writeEvent: (tx: Executor, input: WriteEventInput) => Promise<{ id: string }>,
): Promise<ConversionOutcome> {
  const businessId = event.businessId;
  // The connector's entity id is deterministic but only links when the CRM holds that record; otherwise the
  // conversion keeps a null entity and the event carries the id for later resolution (no FK on events.entity_ids).
  let entityId: string | null = null;
  try {
    const entity = await repos.entities.resolve(tx, businessId, facts.entityId);
    entityId = entity.id;
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }

  const conversion = await repos.journeys.recordConversion(tx, businessId, {
    entityId,
    kind: facts.kind,
    amountMinor: Math.max(0, facts.amountMinor),
    ...(facts.currency ? { currency: facts.currency } : {}),
    occurredAt: event.occurredAt,
    sourceEventId: event.id,
  });

  const [nthOfKind, p75] = await Promise.all([
    repos.journeys.nthOfKind(tx, businessId, conversion.id),
    facts.kind === "payment" ? repos.journeys.paymentPercentile75(tx, businessId) : Promise.resolve<number | null>(null),
  ]);
  const matchdayLevel = MATCHDAY_LEVEL_FOR_KIND[facts.kind];
  const fullMatchDay = shouldPlayFullMatchDay(facts.kind, nthOfKind, facts.amountMinor, p75);

  // First-pass team sheet: the entity's own touches before the conversion; the closer is the captain. The
  // journey builder (orchestrator) replaces weights/xC with the attribution model later.
  const touches = entityId ? await repos.journeys.pathForEntity(tx, businessId, entityId, event.occurredAt) : [];
  const sorted = [...touches].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const weights: Record<string, number> = {};
  if (sorted.length > 0) {
    const w = 1 / sorted.length;
    for (const t of sorted) weights[t.id] = w;
  }
  const closer = sorted.at(-1);
  const first = sorted[0];

  const journey = await repos.journeys.create(tx, businessId, {
    conversionId: conversion.id,
    touchIds: sorted.map((t) => t.id),
    weights,
    xcSeries: [],
    commentary: [],
    agents: [],
    matchdayLevel,
  });

  const converted = buildEvent({
    businessId,
    type: "customer.converted",
    actor,
    entityIds: [facts.entityId],
    occurredAt: event.occurredAt,
    payload: {
      entityId: facts.entityId,
      conversionId: conversion.id,
      journeyId: journey.id,
      kind: facts.kind,
      matchdayLevel,
      amount: facts.amountMinor > 0 ? { amountMinor: facts.amountMinor, currency: conversion.currency } : null,
      nthOfKind,
      fullMatchDay,
      captainChannelKey: (closer?.channelKey as ChannelKey | null | undefined) ?? null,
      touchCount: sorted.length,
      timeToConvertHours: first ? hoursBetween(new Date(first.occurredAt), event.occurredAt) : null,
      acquisitionCost: null,
    },
  });
  const written = await writeEvent(tx, {
    businessId,
    type: converted.type,
    actor: converted.actor,
    entityIds: converted.entityIds,
    occurredAt: converted.occurredAt,
    payload: converted.payload,
    id: converted.id,
  });
  return { conversion, journey, convertedEventId: written.id, nthOfKind, fullMatchDay };
}
