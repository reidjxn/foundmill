/**
 * Composer inputs (BUILD §12.2 "Inputs: business brief; the source events; current metrics; the entity manifest (id,
 * kind, name, aliases); named queries available for exhibits; glossary"). Everything here is read through repositories
 * with the business id first (ARCHITECTURE §4) so a note can never see another club's rows.
 */
import { prompts } from "@foundmill/agents";
import { repos, type Agent, type Business, type Event, type Executor } from "@foundmill/db";
import { buildManifest, type Manifest, type ManifestEntityInput } from "@foundmill/entity-linker";
import { getEventDeclaration } from "@foundmill/events";
import { AppError, EVENT_TYPES, type EntityKind, type EventType } from "@foundmill/shared";
import { loadMetricsSnapshot, statusMetrics, type MetricsSnapshot, type StatusMetric } from "./metrics";

export type FounderExperience = prompts.FounderExperience;

/** How many CRM entities (beyond the ones the events name) the manifest offers for linking. */
export const MANIFEST_LIMIT = 300;
/** How many un-narrated events the Refresh plan looks at (the buffer pre-writes the first few). */
export const UNNARRATED_LOOKAHEAD = 10;

export interface ComposeContext {
  businessId: string;
  business: Business;
  glossary: Record<string, string>;
  agents: Agent[];
  /** The persona the note is written in: the Chief of Staff, else the first agent. */
  voice: Agent;
  manifest: Manifest;
  /** Ids of CRM `entities` rows in the manifest (what `inbox_items.entity_ids` may carry). */
  crmIds: Set<string>;
  agentIds: Set<string>;
  metrics: MetricsSnapshot;
  status: StatusMetric[];
  /** Un-narrated events, highest priority first (Refresh rule 1). */
  unnarrated: Event[];
  /**
   * Who the note is written to (UX plan §7.19, E3): the business owner's founder profile experience, read as one of
   * the four profile answers; a first-time founder when the owner has no profile or wrote something else.
   */
  founderExperience: FounderExperience;
  now: Date;
}

/** The owner's founder profile experience, as the Composer prompt reads it. Never throws: no owner or no profile reads as first-time. */
export async function loadFounderExperience(db: Executor, businessId: string): Promise<FounderExperience> {
  const owner = await repos.memberships.owner(db, businessId);
  const profile = owner ? await repos.founders.get(db, owner.userId) : null;
  return prompts.founderExperienceFrom(profile?.experience);
}

export class NoAgentsError extends AppError {
  constructor(businessId: string) {
    super("no_agents", "The business has no agents to write from", 409, { businessId });
  }
}

export interface LoadContextOptions {
  now?: Date;
  /** Entities named by the events being narrated are always in the manifest. */
  entityIds?: readonly string[];
  /** Skip the un-narrated lookahead (narrate knows its events). */
  skipUnnarrated?: boolean;
}

export async function loadContext(db: Executor, businessId: string, options: LoadContextOptions = {}): Promise<ComposeContext> {
  const now = options.now ?? new Date();
  const business = await repos.businesses.get(db, businessId);
  const [agentsPage, crm, named, metrics, unnarrated, chief, founderExperience] = await Promise.all([
    repos.agents.list(db, businessId, { limit: 200 }),
    repos.entities.manifest(db, businessId, { limit: MANIFEST_LIMIT }),
    options.entityIds && options.entityIds.length > 0 ? repos.entities.manifest(db, businessId, { ids: options.entityIds }) : Promise.resolve([]),
    loadMetricsSnapshot(db, businessId, now),
    options.skipUnnarrated ? Promise.resolve([] as Event[]) : unnarratedNarratable(db, businessId),
    repos.agents.chiefOfStaff(db, businessId),
    loadFounderExperience(db, businessId),
  ]);
  const agents = agentsPage.items;
  if (agents.length === 0) throw new NoAgentsError(businessId);
  const voice = chief ?? agents[0]!;

  const seen = new Set<string>();
  const entityInputs: ManifestEntityInput[] = [];
  for (const e of [...named, ...crm]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    entityInputs.push({ id: e.id, kind: e.kind as EntityKind, name: e.displayName, aliases: e.aliases, visible: true });
  }
  const crmIds = new Set(entityInputs.map((e) => e.id));
  for (const a of agents) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    entityInputs.push({ id: a.id, kind: "agent", name: a.name, aliases: [], visible: true, role: a.role || a.agentType });
  }
  const manifest = buildManifest(entityInputs, { strictKinds: false });

  return {
    businessId,
    business,
    glossary: business.glossary ?? {},
    agents,
    voice,
    manifest,
    crmIds,
    agentIds: new Set(agents.map((a) => a.id)),
    metrics,
    status: statusMetrics(metrics),
    unnarrated,
    founderExperience,
    now,
  };
}

/** Events the catalogue marks `narratable: false` (inbox.item_created, cycle.started, …) never become notes; unknown types are skipped too. */
export function isNarratable(type: string): boolean {
  try {
    return getEventDeclaration(type as EventType).narratable;
  } catch {
    return false;
  }
}

/** Every event type the composer may narrate (the catalogue's `narratable: true`). */
export const NARRATABLE_EVENT_TYPES: readonly EventType[] = EVENT_TYPES.filter((t) => isNarratable(t));

/**
 * The Refresh lookahead: the highest-priority un-narrated events of a narratable type only. Filtering after the limit
 * let a cycle's dozens of task.progressed / cycle.started rows fill the window on every Refresh, so wins and cycle
 * reports were never reached (audit EXTRA-STARVE). Those rows are marked narrated on the way, as the api's in-process
 * path does: they never become notes and would otherwise pile up in the un-narrated index.
 */
async function unnarratedNarratable(db: Executor, businessId: string): Promise<Event[]> {
  await repos.events.markUnnarratable(db, businessId, NARRATABLE_EVENT_TYPES);
  return repos.events.unnarrated(db, businessId, UNNARRATED_LOOKAHEAD, { types: NARRATABLE_EVENT_TYPES });
}

/** The business brief as the model sees it (no numbers beyond what the metrics carry). */
export function businessBrief(ctx: ComposeContext): Record<string, unknown> {
  const b = ctx.business;
  return {
    id: b.id,
    name: b.name,
    archetype: b.archetype,
    game_mode: b.gameMode,
    business_mode: b.businessMode,
    region: b.region,
    kit: { primary: b.kitPrimary, secondary: b.kitSecondary },
    // The currency the business keeps its money in (0025): an amount an event does not price is in it.
    currency: b.currency,
    glossary: ctx.glossary,
    departments_note: "Departments are labels over modules; refer to agents by their manifest entry.",
  };
}
