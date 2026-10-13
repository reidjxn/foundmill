/**
 * `journey.get` → the Dugout JourneyStage inputs (BUILD §11.4). The API returns the full `@foundmill/journey`
 * Journey record (channels, captain, standout agent, attribution model, xC model source, consent, partial-journey
 * flag, nth of kind, full-update rule, stats) built server-side, so the replay is deterministic (AC-11.4.3) and
 * nothing is derived here: this module only reshapes rows for the stage (ISO strings, presentation metadata).
 */
import type { CustomerFacts, Journey as StageJourney, JourneyAgent as StageAgent, StageAgentMeta, Touch as StageTouch, TouchKind, TouchSource } from "@foundmill/dugout";
import type { Journey as JourneyRecord } from "@foundmill/journey";
import { CHANNEL_META, type AgentStatus, type ConversionKind, type DeptColourToken, type EntityKind } from "@foundmill/shared";
import { plainWords } from "@/lib/format";

const iso = (d: Date | string): string => (typeof d === "string" ? d : d.toISOString());

/** The parts of the `journey.get` row the stage needs beyond the record. */
export interface JourneyRowLike {
  conversion: { id: string; entityId: string | null; kind: ConversionKind; amountMinor: number; currency: string; occurredAt: Date | string };
  entity: { id: string; displayName: string; kind: string } | null;
  viewedAt?: Date | string | null;
}

export interface TouchRowLike {
  id: string;
  visitorId?: string | null;
  entityId?: string | null;
  occurredAt: Date | string;
  channelKey: StageTouch["channelKey"];
  campaignId?: string | null;
  kind: string;
  source: Record<string, unknown>;
  /** Present on the record's touches; derived from click ids for raw rows. */
  firstParty?: boolean;
}

function hasClickIds(source: Record<string, unknown>): boolean {
  const ids = source.clickIds;
  return !!ids && typeof ids === "object" && Object.values(ids as Record<string, unknown>).some((v) => typeof v === "string" && v.length > 0);
}

/** Touches → stage touches, time-sorted (ties by id) with ISO strings; third-party click ids mark a touch as not first-party. */
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
      firstParty: typeof t.firstParty === "boolean" ? t.firstParty : !hasClickIds(t.source),
    }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

/** The API's Journey record → what `JourneyStage` renders (the record plus the conversion's amount and currency). */
export function stageJourneyFromRecord(record: JourneyRecord, row: JourneyRowLike): StageJourney {
  return {
    id: record.id,
    businessId: record.businessId,
    conversionId: record.conversionId,
    entityId: record.entityId,
    kind: record.kind,
    touchIds: [...record.touchIds],
    weights: record.weights,
    xcSeries: record.xcSeries,
    commentary: record.commentary,
    agents: record.agents,
    matchdayLevel: record.matchdayLevel,
    viewedAt: record.viewedAt ?? (row.viewedAt ? iso(row.viewedAt) : null),
    channels: record.channels,
    captain: record.captain,
    playerOfTheMatch: record.playerOfTheMatch,
    attributionModel: record.attributionModel,
    xcModelSource: record.xcModelSource,
    consent: record.consent,
    partialJourney: record.partialJourney,
    nthOfKind: record.nthOfKind,
    fullMatchDay: record.fullMatchDay,
    stats: record.stats,
    convertedAt: record.convertedAt,
    amountMinor: row.conversion.amountMinor,
    currency: row.conversion.currency,
  };
}

export interface EntityProfileLike {
  identifiers?: Record<string, unknown> | null;
  roles?: readonly { role?: string | null }[];
}

/** Customer rail facts: identity, first channel, touches, time to convert, consent when it is known. */
export function customerFactsFor(row: JourneyRowLike, journey: StageJourney, touches: readonly StageTouch[], profile?: EntityProfileLike | null): CustomerFacts {
  const facts: CustomerFacts["facts"] = [];
  const ids = profile?.identifiers ?? {};
  if (typeof ids.domain === "string") facts.push({ label: "Domain", value: ids.domain });
  else if (typeof ids.email === "string") facts.push({ label: "Email", value: ids.email });
  // Stored keys read as words: the role ("customer" → "Customer") and the first channel by its name ("seo" → "SEO").
  const role = profile?.roles?.find((r) => typeof r.role === "string")?.role;
  if (role) facts.push({ label: "Role", value: plainWords(role) });
  const firstChannel = touches[0]?.channelKey;
  facts.push({ label: "First touch", value: firstChannel ? CHANNEL_META[firstChannel].label : "Direct" });
  facts.push({ label: "Touches", value: journey.partialJourney ? `${touches.length} (consented touches only)` : String(touches.length) });
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

/** Avatar seeds, department colours, status and model per agent who was involved. */
export function stageAgentMeta(agents: readonly StageAgent[], departments: readonly SquadLike[]): StageAgentMeta[] {
  return agents.map((a) => {
    for (const d of departments) {
      const found = d.squad.find((s) => s.id === a.agentId);
      if (found) return { agentId: a.agentId, seed: found.avatarSeed || a.agentId, dept: d.colourToken as DeptColourToken, status: found.status as AgentStatus | undefined, model: found.modelKey };
    }
    return { agentId: a.agentId, seed: a.agentId, dept: "dept-3" as DeptColourToken };
  });
}

/** Entity kinds for commentary links: the customer plus every agent who was involved. */
export function entityKindsFor(row: JourneyRowLike, agents: readonly StageAgent[]): Record<string, EntityKind> {
  const out: Record<string, EntityKind> = {};
  if (row.entity) out[row.entity.id] = row.entity.kind as EntityKind;
  for (const a of agents) out[a.agentId] = "agent";
  return out;
}

export interface ReplayOrigin {
  /** Where the back button and the breadcrumb lead. */
  href: string;
  /** What they call it ("CRM", "Milestones", "Attribution", …). */
  label: string;
}

export interface DepartmentTabsLike {
  slug: string;
  tabs: readonly { slug: string; title: string }[];
}

/**
 * Where the founder opened the replay from (`?from=`, an in-app path of this business), so back returns there; the
 * Inbox when the link carried none or anything else (another business's path, an absolute URL: never followed).
 */
export function replayOrigin(from: string | null | undefined, businessId: string, departments: readonly DepartmentTabsLike[] = []): ReplayOrigin {
  const inbox = { href: `/b/${businessId}/inbox`, label: "Inbox" };
  const base = `/b/${businessId}`;
  if (!from || !from.startsWith(`${base}/`) || from.includes("//") || from.includes("\\") || [...from].some((ch) => ch.charCodeAt(0) < 32)) return inbox;
  const [path = ""] = from.split(/[?#]/);
  const parts = path.slice(base.length + 1).split("/").filter(Boolean);
  const [section, ...rest] = parts;
  const label = (() => {
    switch (section) {
      case "home":
        return "Home";
      case "inbox":
        return "Inbox";
      case "crm":
        return rest.length ? "CRM profile" : "CRM";
      case "milestones":
        return "Milestones";
      case "agents":
        return "Agent profile";
      case "d": {
        const dept = departments.find((d) => d.slug === rest[0]);
        return dept?.tabs.find((t) => t.slug === rest[1])?.title ?? null;
      }
      default:
        return null;
    }
  })();
  return label ? { href: from, label } : inbox;
}
