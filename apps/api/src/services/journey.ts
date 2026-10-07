/**
 * The full `@foundmill/journey` Journey record for `journey.get` (BUILD §11.4; AC-11.4.3 deterministic replays).
 *
 * The `journeys` row stores touch ids, weights, the xC series, commentary, the agents who were involved and the
 * update level. Everything else the Customer Update shows (channels, captain, standout agent, attribution model,
 * xC model source, consent and the partial-journey flag, the nth of its kind, the full-update rule, stats) is derived
 * here with the same helpers the journey builder used, from repositories, and validated against the `Journey` schema,
 * so the web renders the record instead of deriving it.
 */
import { LIMITS } from "@foundmill/config";
import { repos, type Executor, type JourneyDetail } from "@foundmill/db";
import { Journey, JourneyAgent, Touch, XcPoint, channelWeights, chooseModel, shouldPlayFullMatchDay, type ConsentState, type JourneyCaptain, type Journey as JourneyRecord, type Touch as JourneyTouch } from "@foundmill/journey";
import type { ChannelKey } from "@foundmill/shared";

const HOUR_MS = 3_600_000;

function hasClickIds(source: Record<string, unknown>): boolean {
  const ids = source.clickIds;
  return !!ids && typeof ids === "object" && Object.values(ids as Record<string, unknown>).some((v) => typeof v === "string" && v.length > 0);
}

/** DB touch rows → journey touches, time-sorted (ties by id); third-party click ids mark a touch as not first-party. */
export function toJourneyTouches(rows: JourneyDetail["touches"]): JourneyTouch[] {
  const out: JourneyTouch[] = [];
  for (const t of rows) {
    const parsed = Touch.safeParse({ id: t.id, visitorId: t.visitorId, entityId: t.entityId, occurredAt: t.occurredAt, channelKey: t.channelKey, campaignId: t.campaignId, kind: t.kind, source: t.source, firstParty: !hasClickIds(t.source) });
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

export function parseAgents(raw: readonly unknown[]): JourneyAgent[] {
  const out: JourneyAgent[] = [];
  for (const a of raw) {
    const r = JourneyAgent.safeParse(a);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => b.contribution - a.contribution || a.agentId.localeCompare(b.agentId));
}

export function parseXcSeries(raw: readonly unknown[]): XcPoint[] {
  const out: XcPoint[] = [];
  for (const p of raw) {
    const r = XcPoint.safeParse(p);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** The heaviest touch is the captain (the later touch wins a tie, then id); its agent is the one named on the touch, else the agent whose touch list holds it. */
export function captainOf(touches: readonly JourneyTouch[], weights: Record<string, number>, agents: readonly JourneyAgent[]): JourneyCaptain | null {
  let best: JourneyTouch | null = null;
  for (const t of touches) {
    const w = weights[t.id] ?? 0;
    const bw = best ? (weights[best.id] ?? 0) : -1;
    if (!best || w > bw + 1e-12 || (Math.abs(w - bw) <= 1e-12 && (t.occurredAt > best.occurredAt || (t.occurredAt === best.occurredAt && t.id > best.id)))) best = t;
  }
  if (!best) return null;
  const named = best.source.agentId;
  const owner = named ?? agents.find((a) => a.touchIds.includes(best!.id))?.agentId ?? null;
  return { touchId: best.id, channelKey: best.channelKey, agentId: owner, weight: weights[best.id] ?? 0 };
}

export interface JourneyRecordResult {
  journey: JourneyRecord;
  touches: JourneyTouch[];
  /** Labelled conversions the business had when the record was read (drives the model labels). */
  conversionCount: number;
  acquisitionCostLabel: "Estimate";
}

/** Build and validate the full record from the stored row. Pure over repositories. */
export async function buildJourneyRecord(db: Executor, businessId: string, detail: JourneyDetail): Promise<JourneyRecordResult> {
  const touches = toJourneyTouches(detail.touches);
  const agents = parseAgents(detail.agents);
  const weights = detail.weights ?? {};
  const [counts, nthOfKind, p75, cpa] = await Promise.all([
    repos.journeys.countConversions(db, businessId),
    repos.journeys.nthOfKind(db, businessId, detail.conversionId),
    detail.conversion.kind === "payment" ? repos.journeys.paymentPercentile75(db, businessId) : Promise.resolve(null),
    repos.channels.metricsSummary(db, businessId).catch(() => null),
  ]);
  const conversionCount = Object.values(counts).reduce((s, n) => s + n, 0);

  // Consent from the visitor the touches were stitched through (first-party only without consent, BUILD §11.4).
  let consent: ConsentState = "unknown";
  const visitorId = touches.find((t) => t.visitorId)?.visitorId ?? detail.touches.find((t) => t.visitorId)?.visitorId ?? null;
  if (visitorId) {
    try {
      consent = (await repos.journeys.getVisitor(db, businessId, visitorId)).consentState;
    } catch {
      consent = "unknown";
    }
  }
  const partialJourney = consent !== "granted";

  const cpaByChannel = new Map<ChannelKey, number>();
  for (const c of cpa?.channels ?? []) if (c.cpaMinor !== null) cpaByChannel.set(c.channelKey, c.cpaMinor);
  let acquisitionCostMinor: number | null = null;
  if (cpaByChannel.size > 0) {
    let sum = 0;
    for (const t of touches) {
      const c = t.channelKey ? cpaByChannel.get(t.channelKey) : undefined;
      if (c !== undefined) sum += (weights[t.id] ?? 0) * c;
    }
    acquisitionCostMinor = Math.round(sum);
  }

  const convertedAt = detail.conversion.occurredAt.toISOString();
  const first = touches[0]?.occurredAt ?? null;
  const last = touches[touches.length - 1]?.occurredAt ?? null;
  const journey = Journey.parse({
    id: detail.id,
    businessId,
    conversionId: detail.conversionId,
    entityId: detail.conversion.entityId,
    kind: detail.conversion.kind,
    touchIds: [...detail.touchIds],
    weights,
    xcSeries: parseXcSeries(detail.xcSeries),
    commentary: detail.commentary,
    agents,
    matchdayLevel: detail.matchdayLevel,
    viewedAt: detail.viewedAt,
    channels: channelWeights(touches, weights),
    captain: captainOf(touches, weights, agents),
    playerOfTheMatch: agents[0]?.agentId ?? null,
    attributionModel: chooseModel(conversionCount),
    xcModelSource: conversionCount >= LIMITS.xcArchetypePriorUntilConversions ? "trained" : "archetype_prior",
    consent,
    partialJourney,
    nthOfKind,
    fullMatchDay: shouldPlayFullMatchDay(detail.conversion.kind, nthOfKind, detail.conversion.amountMinor, p75, false),
    stats: {
      touchCount: touches.length,
      firstTouchAt: first,
      lastTouchAt: last,
      timeToConvertHours: first ? Math.max(0, (Date.parse(convertedAt) - Date.parse(first)) / HOUR_MS) : null,
      acquisitionCostMinor,
      currency: detail.conversion.currency,
    },
    convertedAt,
  });
  return { journey, touches, conversionCount, acquisitionCostLabel: "Estimate" };
}
