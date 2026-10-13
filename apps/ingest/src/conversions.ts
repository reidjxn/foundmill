/**
 * Conversions and the first Customer Update record (BUILD §11.4 "Triggers", §8.1 `customer.converted`).
 *
 * Signups, activations and payments arriving as platform events become `conversions` rows in the same transaction as
 * the event, so the journey tables and the event log can never disagree. The payer is linked to (or added to) the CRM
 * first (`customers.ts`). Only a customer's first payment wins a customer: a renewal or a repeat order (the connector's
 * `firstPayment` is false, or the CRM record has paid before) is recorded as revenue (`first_payment = false`) with no
 * journey and no `customer.converted`.
 *
 * A conversion that wins a customer gets its first-pass journey from `buildJourney` (packages/journey) over the
 * customer's own touches, including the touch this event reports (parsed with `parseTouchSource`): 40/20/40 weights
 * and the archetype-prior xC curve, stored with the models actually used, so the composer can write the `customer_won`
 * item within seconds (AC-11.4.1). After commit ingest starts the orchestrator's `journeyBuild`, which adds who was
 * involved, the data-driven models once the business has enough conversions, and commentary (`followups.ts`). Every
 * number here that is not counted from rows is null until the journey builder estimates it (`acquisitionCost`).
 */
import { repos, type Conversion, type Journey } from "@foundmill/db";
import type { Executor } from "@foundmill/db/repos/_shared";
import type { PlatformEvent } from "@foundmill/events";
import { buildEvent, type WriteEventInput } from "@foundmill/events";
import { buildJourney, parseTouchSource, Touch, TouchKind, type ConsentState } from "@foundmill/journey";
import { CHANNEL_KEYS, MATCHDAY_LEVEL_FOR_KIND, NotFoundError, type Actor, type ChannelKey, type ConversionKind } from "@foundmill/shared";
import type { ConvertingCustomer } from "./customers";

/** The first hundred of a kind always get a full Match Day; afterwards only payments above the 75th percentile (BUILD §11.4). */
export const FULL_MATCH_DAY_UNTIL = 100;

/** Where a conversion came from, when the event says (a signup's UTM tags and channel, an order's landing page). */
export interface ConversionTouch {
  visitorId: string | null;
  channelKey: ChannelKey | null;
  campaignId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
  code: string | null;
}

export interface ConversionFacts {
  kind: ConversionKind;
  /** The connector's deterministic entity id (`payload.entityId`); ingest links it to a CRM record. */
  entityId: string;
  amountMinor: number;
  /** A payment's own currency; null (a sign-up or an activation, no money) takes the business's own (0025). */
  currency: string | null;
  conversionRef: string;
  provider: string;
  /** Payments: the connector's view of whether this is the customer's first payment (renewals and repeat orders are not). */
  firstPayment: boolean;
  customer: ConvertingCustomer | null;
  touch: ConversionTouch | null;
  /** The consent the event reports (signups), used when no stitched visitor says otherwise. */
  consent: ConsentState | null;
}

type EventTouchSource = { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; referrer: string | null; code: string | null } | null;

function touchFrom(source: EventTouchSource, extra: { visitorId?: string | null; channelKey?: ChannelKey | null; campaignId?: string | null } = {}): ConversionTouch | null {
  const t: ConversionTouch = {
    visitorId: extra.visitorId ?? null,
    channelKey: extra.channelKey ?? null,
    campaignId: extra.campaignId ?? null,
    utmSource: source?.utmSource ?? null,
    utmMedium: source?.utmMedium ?? null,
    utmCampaign: source?.utmCampaign ?? null,
    referrer: source?.referrer ?? null,
    code: source?.code ?? null,
  };
  return t.channelKey || t.campaignId || t.utmSource || t.utmMedium || t.utmCampaign || t.referrer || t.code ? t : null;
}

/** Which conversion a platform event represents, or null when it is not a conversion trigger. */
export function conversionFactsFor(event: PlatformEvent): ConversionFacts | null {
  switch (event.type) {
    case "signup.created": {
      const p = event.payload;
      return {
        kind: "signup", entityId: p.entityId, amountMinor: 0, currency: null, conversionRef: p.conversionId, provider: p.provider, firstPayment: true, customer: p.customer ?? null,
        touch: touchFrom(p.source, { visitorId: p.visitorId, channelKey: p.channelKey, campaignId: p.campaignId }), consent: p.consentState,
      };
    }
    case "activation.reached":
      return { kind: "activation", entityId: event.payload.entityId, amountMinor: 0, currency: null, conversionRef: event.payload.conversionId, provider: event.payload.provider, firstPayment: true, customer: null, touch: null, consent: null };
    case "payment.received": {
      const p = event.payload;
      return {
        kind: "payment", entityId: p.entityId, amountMinor: p.amount.amountMinor, currency: p.amount.currency, conversionRef: p.conversionId, provider: p.provider, firstPayment: p.firstPayment, customer: p.customer ?? null,
        touch: touchFrom(p.source ?? null), consent: null,
      };
    }
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

/** A conversion that won a customer: its journey and the `customer.converted` event written for it. */
export interface CustomerWin {
  journey: Journey;
  /** The `customer.converted` event written for this conversion. */
  convertedEventId: string;
  convertedPayload: Record<string, unknown>;
  nthOfKind: number;
  fullMatchDay: boolean;
}

export interface ConversionOutcome {
  conversion: Conversion;
  /** The CRM record the conversion is linked to (null only when the vendor reported nobody). */
  entityId: string | null;
  /** False for a renewal or a repeat order: revenue only, so `win` is null. */
  firstPayment: boolean;
  win: CustomerWin | null;
}

const isChannelKey = (v: unknown): v is ChannelKey => typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);

/**
 * Stored touches → the journey builder's touches. A row the builder cannot read (a kind it does not know is read as a
 * visit; a malformed source drops the touch) never fails the delivery that is being written.
 */
export function journeyTouchesFrom(rows: readonly { id: string; visitorId: string | null; entityId: string | null; occurredAt: Date; channelKey: string | null; campaignId: string | null; kind: string; source: unknown }[], businessId: string): Touch[] {
  const out: Touch[] = [];
  for (const t of rows) {
    const parsed = Touch.safeParse({ id: t.id, businessId, visitorId: t.visitorId, entityId: t.entityId, occurredAt: t.occurredAt.toISOString(), channelKey: t.channelKey, campaignId: t.campaignId, kind: TouchKind.safeParse(t.kind).success ? t.kind : "visit", source: t.source ?? {} });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Records the touch the event itself reports, through `parseTouchSource`, stitching the signup's visitor to the person. */
async function recordConversionTouch(tx: Executor, businessId: string, entityId: string, facts: ConversionFacts, at: Date): Promise<void> {
  const t = facts.touch;
  if (!t) return;
  let visitorId: string | null = null;
  if (t.visitorId) {
    try {
      await repos.journeys.getVisitor(tx, businessId, t.visitorId);
      await repos.journeys.identifyVisitor(tx, businessId, t.visitorId, entityId);
      visitorId = t.visitorId;
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  const parsed = parseTouchSource({ utm: { source: t.utmSource, medium: t.utmMedium, campaign: t.utmCampaign }, referrer: t.referrer, code: t.code, provider: facts.provider });
  const channelKey = t.channelKey ?? (isChannelKey(parsed.channelKey) ? parsed.channelKey : null);
  let campaignId = t.campaignId ?? parsed.campaignId;
  if (campaignId) {
    try {
      await repos.campaigns.get(tx, businessId, campaignId);
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
      campaignId = null;
    }
  }
  await repos.journeys.recordTouch(tx, businessId, { entityId, visitorId, occurredAt: at, channelKey, campaignId, source: parsed.source as Record<string, unknown>, kind: facts.kind === "signup" ? "form_submit" : parsed.kind });
}

/**
 * Record the conversion and, when it wins a customer, the first-pass journey and the `customer.converted` event, for a
 * conversion-kind platform event that was just written. `entityId` is the CRM record `linkCustomer` resolved (null when
 * the vendor reported nobody). Runs inside the caller's transaction.
 */
export async function recordConversionForEvent(
  tx: Executor,
  event: PlatformEvent,
  facts: ConversionFacts,
  actor: Actor,
  writeEvent: (tx: Executor, input: WriteEventInput) => Promise<{ id: string }>,
  entityId: string | null = null,
): Promise<ConversionOutcome> {
  const businessId = event.businessId;
  // Only a first payment wins a customer: the connector says so (Stripe billing_reason, Shopify orders_count) and the
  // CRM record has not paid before (a one-off checkout by a returning customer is a repeat order).
  let firstPayment = facts.kind !== "payment" || facts.firstPayment;
  if (facts.kind === "payment" && firstPayment && entityId) firstPayment = !(await repos.journeys.hasPaidBefore(tx, businessId, entityId, event.occurredAt));

  const conversion = await repos.journeys.recordConversion(tx, businessId, {
    entityId,
    kind: facts.kind,
    amountMinor: Math.max(0, facts.amountMinor),
    ...(facts.currency ? { currency: facts.currency } : {}),
    occurredAt: event.occurredAt,
    sourceEventId: event.id,
    firstPayment,
  });
  if (!firstPayment) return { conversion, entityId, firstPayment, win: null };

  if (entityId) await recordConversionTouch(tx, businessId, entityId, facts, event.occurredAt);

  const [business, nthOfKind, p75, counts] = await Promise.all([
    repos.businesses.get(tx, businessId),
    repos.journeys.nthOfKind(tx, businessId, conversion.id),
    facts.kind === "payment" ? repos.journeys.paymentPercentile75(tx, businessId) : Promise.resolve<number | null>(null),
    repos.journeys.countConversions(tx, businessId),
  ]);
  const matchdayLevel = MATCHDAY_LEVEL_FOR_KIND[facts.kind];
  const fullMatchDay = shouldPlayFullMatchDay(facts.kind, nthOfKind, facts.amountMinor, p75);

  // First pass: the customer's own touches (and their stitched visitors') before the conversion, attributed by the
  // journey builder. The orchestrator's journeyBuild adds the team, the data-driven models and commentary.
  const touchRows = entityId ? await repos.journeys.pathForEntity(tx, businessId, entityId, event.occurredAt) : [];
  const visitorIds = [...new Set(touchRows.map((t) => t.visitorId).filter((v): v is string => v !== null))];
  let consent: ConsentState = facts.consent ?? "unknown";
  if (visitorIds[0]) {
    try {
      consent = (await repos.journeys.getVisitor(tx, businessId, visitorIds[0])).consentState as ConsentState;
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  const touches = journeyTouchesFrom(touchRows, businessId);
  const record = buildJourney({
    conversion: { id: conversion.id, businessId, entityId, kind: facts.kind, amountMinor: Math.max(0, facts.amountMinor), currency: conversion.currency, occurredAt: event.occurredAt.toISOString(), sourceEventId: event.id, firstPayment: true },
    touches,
    consent,
    counts: { conversions: Object.values(counts).reduce((a, b) => a + b, 0), nthOfKind, valuePercentile75Minor: p75 },
    archetype: business.archetype ?? undefined,
    visitorIds,
    businessId,
  });

  const journey = await repos.journeys.create(tx, businessId, {
    conversionId: conversion.id,
    touchIds: record.touchIds,
    weights: record.weights,
    xcSeries: record.xcSeries,
    commentary: [],
    agents: [],
    matchdayLevel,
    attributionModel: record.attributionModel,
    xcModelSource: record.xcModelSource,
  });

  const customerId = entityId ?? facts.entityId;
  const converted = buildEvent({
    businessId,
    type: "customer.converted",
    actor,
    entityIds: [customerId],
    occurredAt: event.occurredAt,
    payload: {
      entityId: customerId,
      conversionId: conversion.id,
      journeyId: journey.id,
      kind: facts.kind,
      matchdayLevel,
      amount: facts.amountMinor > 0 ? { amountMinor: facts.amountMinor, currency: conversion.currency } : null,
      nthOfKind,
      fullMatchDay,
      captainChannelKey: record.captain?.channelKey ?? null,
      touchCount: record.stats.touchCount,
      timeToConvertHours: record.stats.timeToConvertHours,
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
  return { conversion, entityId, firstPayment, win: { journey, convertedEventId: written.id, convertedPayload: converted.payload as Record<string, unknown>, nthOfKind, fullMatchDay } };
}
