/**
 * `journey.get` → the Dugout JourneyStage inputs (BUILD §11.4). The journeys row stores touch ids, weights, the xC
 * series, commentary, the team sheet and the level; everything the stage shows beyond that (channels, captain,
 * standout agent, stats, nth of kind, full-day rule) is derived here, deterministically from the record
 * (AC-11.4.3), with the same helpers the journey builder used.
 */
import { LIMITS } from "@foundmill/config";
import type { CustomerFacts, Journey as StageJourney, JourneyAgent as StageAgent, StageAgentMeta, Touch as StageTouch, TouchKind, TouchSource, XcPoint } from "@foundmill/dugout";
import { JourneyAgent, XcPoint as XcPointSchema, channelWeights, chooseModel, shouldPlayFullMatchDay } from "@foundmill/journey";
import type { AgentStatus, ChannelKey, ConversionKind, DeptColourToken, EntityKind, MatchdayLevel } from "@foundmill/shared";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const HOUR_MS = 3_600_000;

const iso = (d: Date | string): string => (typeof d === "string" ? d : d.toISOString());

export interface JourneyRowLike {
  id: string;
  conversionId: string;
  touchIds: readonly string[];
  weights: Record<string, number>;
  xcSeries: unknown[];
  commentary: unknown[];
  agents: unknown[];
  matchdayLevel: MatchdayLevel;
  viewedAt: Date | string | null;
  conversion: { id: string; entityId: string | null; kind: ConversionKind; amountMinor: number; currency: string; occurredAt: Date | string };
  touches: readonly TouchRowLike[];
  entity: { id: string; displayName: string; kind: string } | null;
}

export interface TouchRowLike {
  id: string;
  visitorId?: string | null;
  entityId?: string | null;
  occurredAt: Date | string;
  channelKey: ChannelKey | null;
  campaignId?: string | null;
  kind: string;
  source: Record<string, unknown>;
}

function hasClickIds(source: Record<string, unknown>): boolean {
  const ids = source.clickIds;
  return !!ids && typeof ids === "object" && Object.values(ids as Record<string, unknown>).some((v) => typeof v === "string" && v.length > 0);
}

/** DB touch rows → stage touches, time-sorted (ties by id) with ISO strings; third-party click ids mark a touch as not first-party. */
export function toStageTouches(rows: readonly TouchRowLike[]): StageTouch[] {
  return rows
    .map((t): StageTouch => ({
      id: t.id,
      visitorId: t.visitorId ?? null,
      entityId: t.entityId ?? null,
      occurredAt: iso(t.occurredAt),
      channelKey: t.channelKey,
      campaignId: t.campaignId ?? null,
      kind: t.kind as TouchKind,
      source: t.source as TouchSource,
      firstParty: !hasClickIds(t.source),
    }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

export function parseXcSeries(raw: readonly unknown[]): XcPoint[] {
  const out: XcPoint[] = [];
  for (const p of raw) {
    const r = XcPointSchema.safeParse(p);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function parseAgents(raw: readonly unknown[]): StageAgent[] {
  const out: StageAgent[] = [];
  for (const a of raw) {
    const r = JourneyAgent.safeParse(a);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** The heaviest touch is the captain; its agent is the one named on the touch, else the agent whose touch list holds it. */
export function captainOf(touches: readonly StageTouch[], weights: Record<string, number>, agents: readonly StageAgent[]): StageJourney["captain"] {
  let best: StageTouch | null = null;
  for (const t of touches) {
    if (!best || (weights[t.id] ?? 0) > (weights[best.id] ?? 0)) best = t;
  }
  if (!best) return null;
  const named = typeof best.source?.agentId === "string" ? best.source.agentId : null;
  const owner = named ?? agents.find((a) => a.touchIds.includes(best!.id))?.agentId ?? null;
  return { touchId: best.id, channelKey: best.channelKey, agentId: owner, weight: weights[best.id] ?? 0 };
}

/** Standout agent: highest contribution, then rating, then name. */
export function standoutAgent(agents: readonly StageAgent[]): string | null {
  return [...agents].sort((a, b) => b.contribution - a.contribution || b.rating - a.rating || a.name.localeCompare(b.name))[0]?.agentId ?? null;
}

export interface DailyRowLike {
  day: string;
  departmentId: string | null;
  signups: number;
  activations: number;
  payments: number;
}

export interface ConversionLike {
  id: string;
  kind: ConversionKind;
  occurredAt: Date | string;
}

const COUNT_FIELD: Record<ConversionKind, "signups" | "activations" | "payments"> = { signup: "signups", activation: "activations", payment: "payments" };

/**
 * "The nth payment": business-wide daily rows before the conversion's day plus the same-kind conversions on that day
 * up to and including it. Falls back to 1 when there is no history (day one).
 */
export function nthOfKind(conversion: ConversionLike, rows: readonly DailyRowLike[] | undefined, sameDay: readonly ConversionLike[] | undefined): number {
  const at = iso(conversion.occurredAt);
  const day = at.slice(0, 10);
  const field = COUNT_FIELD[conversion.kind];
  const wide = (rows ?? []).filter((r) => r.departmentId === null || r.departmentId === NIL_UUID);
  const source = wide.length ? wide : (rows ?? []);
  const before = source.filter((r) => r.day < day).reduce((s, r) => s + (r[field] ?? 0), 0);
  const today = (sameDay ?? []).filter((c) => c.kind === conversion.kind && iso(c.occurredAt).slice(0, 10) === day && (iso(c.occurredAt) < at || (iso(c.occurredAt) === at && c.id <= conversion.id)));
  return Math.max(1, before + (today.length || 1));
}

export interface StageJourneyOptions {
  nthOfKind: number;
  /** Labelled conversions the business has (drives the attribution/xC model labels). Default 0. */
  conversionCount?: number;
}

/** The stored record + derived fields → what `JourneyStage` renders. */
export function toStageJourney(row: JourneyRowLike, touches: readonly StageTouch[], opts: StageJourneyOptions): StageJourney {
  const agents = parseAgents(row.agents);
  const weights = row.weights ?? {};
  const convertedAt = iso(row.conversion.occurredAt);
  const first = touches[0]?.occurredAt ?? null;
  const last = touches[touches.length - 1]?.occurredAt ?? null;
  const conversionCount = opts.conversionCount ?? 0;
  return {
    id: row.id,
    conversionId: row.conversionId,
    entityId: row.conversion.entityId,
    kind: row.conversion.kind,
    touchIds: [...row.touchIds],
    weights,
    xcSeries: parseXcSeries(row.xcSeries),
    commentary: row.commentary,
    agents,
    matchdayLevel: row.matchdayLevel,
    viewedAt: row.viewedAt ? iso(row.viewedAt) : null,
    channels: channelWeights(touches, weights),
    captain: captainOf(touches, weights, agents),
    playerOfTheMatch: standoutAgent(agents),
    attributionModel: chooseModel(conversionCount),
    xcModelSource: conversionCount >= LIMITS.xcArchetypePriorUntilConversions ? "trained" : "archetype_prior",
    consent: "unknown",
    partialJourney: false,
    nthOfKind: opts.nthOfKind,
    fullMatchDay: shouldPlayFullMatchDay(row.conversion.kind, opts.nthOfKind, row.conversion.amountMinor, null, false),
    stats: {
      touchCount: touches.length,
      firstTouchAt: first,
      lastTouchAt: last,
      timeToConvertHours: first ? Math.max(0, (Date.parse(convertedAt) - Date.parse(first)) / HOUR_MS) : null,
      acquisitionCostMinor: null,
      currency: row.conversion.currency,
    },
    convertedAt,
    amountMinor: row.conversion.amountMinor,
    currency: row.conversion.currency,
  };
}

export interface EntityProfileLike {
  identifiers?: Record<string, unknown> | null;
  roles?: readonly { role?: string | null }[];
}

/** Customer rail facts: identity, first channel, touches, time to convert, the amount. */
export function customerFactsFor(row: JourneyRowLike, journey: StageJourney, touches: readonly StageTouch[], profile?: EntityProfileLike | null): CustomerFacts {
  const facts: CustomerFacts["facts"] = [];
  const ids = profile?.identifiers ?? {};
  if (typeof ids.domain === "string") facts.push({ label: "Domain", value: ids.domain });
  else if (typeof ids.email === "string") facts.push({ label: "Email", value: ids.email });
  const role = profile?.roles?.find((r) => typeof r.role === "string")?.role;
  if (role) facts.push({ label: "Role", value: role });
  const firstChannel = touches[0]?.channelKey;
  facts.push({ label: "First touch", value: firstChannel ? firstChannel.replace(/_/g, " ") : "Direct" });
  facts.push({ label: "Touches", value: String(touches.length) });
  if (journey.stats.timeToConvertHours !== null) {
    const h = journey.stats.timeToConvertHours;
    facts.push({ label: "Time to convert", value: h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h` });
  }
  const kind = row.entity?.kind === "organisation" ? "organisation" : "person";
  return { name: row.entity?.displayName ?? "A new customer", kind, entityId: row.entity?.id ?? row.conversion.entityId, facts: facts.slice(0, 5) };
}

export interface SquadLike {
  colourToken: string;
  squad: readonly { id: string; avatarSeed: string; status?: string; modelKey?: string }[];
}

/** Avatar seeds, department colours, status and model per agent on the team sheet. */
export function stageAgentMeta(agents: readonly StageAgent[], departments: readonly SquadLike[]): StageAgentMeta[] {
  return agents.map((a) => {
    for (const d of departments) {
      const found = d.squad.find((s) => s.id === a.agentId);
      if (found) return { agentId: a.agentId, seed: found.avatarSeed || a.agentId, dept: d.colourToken as DeptColourToken, status: found.status as AgentStatus | undefined, model: found.modelKey };
    }
    return { agentId: a.agentId, seed: a.agentId, dept: "dept-3" as DeptColourToken };
  });
}

/** Entity kinds for commentary links: the customer plus every agent on the team sheet. */
export function entityKindsFor(row: JourneyRowLike, agents: readonly StageAgent[]): Record<string, EntityKind> {
  const out: Record<string, EntityKind> = {};
  if (row.entity) out[row.entity.id] = row.entity.kind as EntityKind;
  for (const a of agents) out[a.agentId] = "agent";
  return out;
}

/** The replay a Ribbon marker opens is addressed by conversion id (the widget only knows the marker); match it to a journey. */
export function journeyIdForConversion(conversionId: string, journeys: readonly { id: string; conversionId: string }[] | undefined): string | null {
  return journeys?.find((j) => j.conversionId === conversionId)?.id ?? null;
}
