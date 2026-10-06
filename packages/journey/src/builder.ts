/**
 * Journey builder (BUILD §11.4, §9.4 `journeyBuild`): conversion + touches + agents + consent + counts → the journey
 * record with attribution weights, xC curve, team sheet, captain, Match Day level and the volume rule.
 * Pure and deterministic: the same input always yields the same record (AC-11.4.3).
 */
import { MATCHDAY_LEVEL_FOR_KIND, type Archetype, type ChannelKey, type ConversionKind, type MatchdayLevel } from "@founder-manager/shared";
import { LIMITS } from "@founder-manager/config";
import { attribute, channelWeights, chooseModel, filterTouchesForConsent, selectJourneyTouches, type MarkovModel } from "./attribution";
import { compareByTimeThenId, hoursBetween } from "./time";
import {
  Conversion, ConsentState, Journey, Touch,
  type ConversionInput, type JourneyAgent, type JourneyCaptain, type TouchInput, type XcModel,
} from "./types";
import { selectXcModel, xcSeries } from "./xc";

export interface JourneyAgentInput {
  agentId: string;
  name: string;
  role?: string | null;
  departmentId?: string | null;
  /** Channels this agent runs (touches on these channels count towards it unless another agent is named on the touch). */
  channelKeys?: readonly ChannelKey[];
  /** Campaigns this agent runs (more specific than channels). */
  campaignIds?: readonly string[];
}

export interface JourneyCounts {
  /** Labelled conversions the business already has (drives attribution and xC model selection). */
  conversions: number;
  /** This conversion is the nth of its kind for the business, 1-based and including itself. */
  nthOfKind: number;
  /** 75th percentile of payment value so far (minor units); null when unknown. */
  valuePercentile75Minor?: number | null;
  /** Account flagged high-value by the founder or the CRM. */
  flaggedHighValue?: boolean;
}

export interface JourneyCosts {
  /** Estimated cost per acquisition per channel (minor units) — from channel_metrics. */
  cpaByChannelMinor?: Partial<Record<ChannelKey, number>>;
  /** Estimated cost per acquisition per campaign (minor units); wins over the channel figure. */
  cpaByCampaignMinor?: Record<string, number>;
}

export interface BuildJourneyInput {
  conversion: ConversionInput;
  /** Candidate touches (the entity's and its stitched visitors'); the builder selects, filters and sorts them. */
  touches: readonly TouchInput[];
  agents?: readonly JourneyAgentInput[];
  consent: ConsentState;
  counts: JourneyCounts;
  /** For the xC prior; defaults to b2b_saas. */
  archetype?: Archetype;
  /** Fitted removal-effect model; required for data-driven attribution (otherwise position-based is used). */
  markov?: MarkovModel | null;
  /** Trained xC model; used from 50 labelled conversions. */
  xcModel?: XcModel | null;
  costs?: JourneyCosts;
  /** Anonymous visitors stitched to the entity (first-party). Touches with entityId equal to the conversion's are always included. */
  visitorIds?: readonly string[];
  lookbackDays?: number;
  businessId?: string;
}

/**
 * Volume rule (BUILD §11.4): every conversion gets a full Match Day until the 100th of its kind; after that only
 * payments above the 75th percentile of value, or accounts flagged high-value, get the full ceremony. The rest roll
 * into the daily round-up.
 */
export function shouldPlayFullMatchDay(
  kind: ConversionKind,
  countOfKind: number,
  valueMinor: number,
  valuePercentile75: number | null | undefined,
  flaggedHighValue: boolean,
): boolean {
  if (countOfKind <= LIMITS.matchDayFullUntilCount) return true;
  if (flaggedHighValue) return true;
  if (kind === "payment" && valuePercentile75 != null) return valueMinor > valuePercentile75;
  return false;
}

export const matchdayLevelFor = (kind: ConversionKind): MatchdayLevel => MATCHDAY_LEVEL_FOR_KIND[kind];

export function buildJourney(input: BuildJourneyInput): Journey {
  const conversion = Conversion.parse(input.conversion);
  const consent = ConsentState.parse(input.consent);
  const archetype = input.archetype ?? "b2b_saas";
  const allTouches = input.touches.map((t) => Touch.parse(t));

  // 1. Stitch anonymous → identified, window, sort.
  const stitched = selectJourneyTouches({
    touches: allTouches, entityId: conversion.entityId, visitorIds: input.visitorIds ?? [], before: conversion.occurredAt, lookbackDays: input.lookbackDays,
  });
  // Touches passed without any owner (neither visitor nor entity) are treated as the conversion's own.
  const orphans = allTouches.filter((t) => t.entityId === null && t.visitorId === null && Date.parse(t.occurredAt) <= Date.parse(conversion.occurredAt));
  const candidates = [...stitched, ...orphans.filter((o) => !stitched.some((s) => s.id === o.id))].sort(compareByTimeThenId);

  // 2. Consent.
  const { touches, partialJourney } = filterTouchesForConsent(candidates, consent);

  // 3. Attribution.
  const model = chooseModel(input.counts.conversions);
  const attribution = attribute(touches, { model, conversionCount: input.counts.conversions, markov: input.markov ?? null });
  const weights = attribution.weights;
  const channels = channelWeights(touches, weights);

  // 4. Team sheet: agents and their contributions.
  const agentsOnTouch = new Map<string, string[]>();
  const contribution = new Map<string, { input: JourneyAgentInput; contribution: number; touchIds: string[] }>();
  for (const a of input.agents ?? []) contribution.set(a.agentId, { input: a, contribution: 0, touchIds: [] });
  for (const t of touches) {
    const ids = agentsForTouch(t, input.agents ?? []);
    agentsOnTouch.set(t.id, ids);
    if (ids.length === 0) continue;
    const share = (weights[t.id] ?? 0) / ids.length;
    for (const id of ids) {
      const c = contribution.get(id)!;
      c.contribution += share;
      c.touchIds.push(t.id);
    }
  }
  const contributors = [...contribution.values()].filter((c) => c.contribution > 0).sort((a, b) => b.contribution - a.contribution || cmp(a.input.agentId, b.input.agentId));
  const best = contributors[0]?.contribution ?? 0;
  const agents: JourneyAgent[] = contributors.map((c) => ({
    agentId: c.input.agentId,
    name: c.input.name,
    role: c.input.role ?? null,
    departmentId: c.input.departmentId ?? null,
    contribution: round9(c.contribution),
    touchIds: c.touchIds,
    rating: Math.min(10, Math.max(1, Math.round(5 + 5 * (c.contribution / best)))),
  }));
  const playerOfTheMatch = agents[0]?.agentId ?? null;

  // 5. Captain: the touch with the highest weight (latest wins a tie, then id).
  let captain: JourneyCaptain | null = null;
  for (const t of touches) {
    const w = weights[t.id] ?? 0;
    if (!captain || w > captain.weight + 1e-12 || (Math.abs(w - captain.weight) <= 1e-12 && isLater(t, touches, captain.touchId))) {
      const ids = agentsOnTouch.get(t.id) ?? [];
      const agentId = ids.map((id) => contribution.get(id)!).sort((a, b) => b.contribution - a.contribution || cmp(a.input.agentId, b.input.agentId))[0]?.input.agentId ?? null;
      captain = { touchId: t.id, channelKey: t.channelKey, agentId, weight: round9(w) };
    }
  }

  // 6. xC curve.
  const xcModel = selectXcModel({ archetype, conversionCount: input.counts.conversions, trained: input.xcModel ?? null });
  const series = xcSeries({ touches, model: xcModel, conversion });

  // 7. Stats.
  const first = touches[0] ?? null;
  const last = touches[touches.length - 1] ?? null;
  const acquisitionCostMinor = estimateAcquisitionCost(touches, weights, input.costs);

  // 8. Match Day level and volume rule.
  const matchdayLevel = matchdayLevelFor(conversion.kind);
  const fullMatchDay = shouldPlayFullMatchDay(
    conversion.kind, input.counts.nthOfKind, conversion.amountMinor, input.counts.valuePercentile75Minor ?? null, input.counts.flaggedHighValue ?? false,
  );

  const journey: Journey = {
    businessId: input.businessId ?? conversion.businessId,
    conversionId: conversion.id,
    entityId: conversion.entityId,
    kind: conversion.kind,
    touchIds: touches.map((t) => t.id),
    weights: Object.fromEntries(touches.map((t) => [t.id, round9(weights[t.id] ?? 0)])),
    xcSeries: series,
    commentary: [],
    agents,
    matchdayLevel,
    viewedAt: null,
    channels: channels.map((c) => ({ ...c, weight: round9(c.weight) })),
    captain,
    playerOfTheMatch,
    attributionModel: attribution.model,
    xcModelSource: xcModel.source,
    consent,
    partialJourney,
    nthOfKind: input.counts.nthOfKind,
    fullMatchDay,
    stats: {
      touchCount: touches.length,
      firstTouchAt: first?.occurredAt ?? null,
      lastTouchAt: last?.occurredAt ?? null,
      timeToConvertHours: first ? round3(Math.max(0, hoursBetween(first.occurredAt, conversion.occurredAt))) : null,
      acquisitionCostMinor,
      currency: conversion.currency,
    },
    convertedAt: conversion.occurredAt,
  };
  if (journey.businessId === undefined) delete journey.businessId;
  return Journey.parse(journey);
}

function agentsForTouch(t: Touch, agents: readonly JourneyAgentInput[]): string[] {
  if (t.source.agentId && agents.some((a) => a.agentId === t.source.agentId)) return [t.source.agentId];
  const byCampaign = t.campaignId ? agents.filter((a) => a.campaignIds?.includes(t.campaignId!)) : [];
  if (byCampaign.length) return byCampaign.map((a) => a.agentId).sort(cmp);
  if (t.channelKey) return agents.filter((a) => a.channelKeys?.includes(t.channelKey!)).map((a) => a.agentId).sort(cmp);
  return [];
}

function estimateAcquisitionCost(touches: readonly Touch[], weights: Record<string, number>, costs: JourneyCosts | undefined): number | null {
  if (!costs || (!costs.cpaByCampaignMinor && !costs.cpaByChannelMinor)) return null;
  let total = 0;
  for (const t of touches) {
    const cpa = (t.campaignId ? costs.cpaByCampaignMinor?.[t.campaignId] : undefined) ?? (t.channelKey ? costs.cpaByChannelMinor?.[t.channelKey] : undefined) ?? 0;
    total += (weights[t.id] ?? 0) * cpa;
  }
  return Math.max(0, Math.round(total));
}

const isLater = (t: Touch, touches: readonly Touch[], otherId: string): boolean => {
  const other = touches.find((x) => x.id === otherId);
  return other ? compareByTimeThenId(t, other) > 0 : true;
};
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round9 = (x: number): number => Math.round(x * 1e9) / 1e9;
const round3 = (x: number): number => Math.round(x * 1e3) / 1e3;
