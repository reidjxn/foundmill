/**
 * Composer client (docs/ARCHITECTURE.md §11). `inbox.refresh` and narration call the composer HTTP service
 * (`COMPOSER_URL`); when it is unreachable in development/test the same logic runs in-process through the models
 * client (mock or live) so the golden path never depends on a second process.
 *
 * The in-process path follows BUILD §11.3: manifest → Opus writes `[[ent:id|Name]]` from manifest ids only →
 * validator (entity-linker) rejects unknown/invisible ids → one `inbox_items` row, source events marked narrated,
 * `inbox.item_created` through the outbox. It never fabricates an event: with no un-narrated events the composer is
 * given the business's current state and asked for an insight or the next-best decision (AC-11.3.2).
 */
import { repos, type Db, type DbTx, type InboxItem } from "@foundmill/db";
import { writeEventRow } from "./events";
import { buildManifest, checkComposerText, type ManifestEntityInput } from "@foundmill/entity-linker";
import { ComposerOutput, type ModelClient } from "@foundmill/models";
import { APP_NAME } from "@foundmill/config";
import { AppError, type EntityKind } from "@foundmill/shared";
import type { ApiLogger } from "./log";

export interface ComposeResult {
  item: InboxItem;
  source: "composer" | "local";
}

export interface ComposerClient {
  /** Exactly one new item (BUILD §11.3 Refresh). */
  refresh(businessId: string, opts?: { actorUserId?: string | null }): Promise<ComposeResult>;
  /** Narrate specific events into one item. */
  narrate(businessId: string, eventIds: readonly string[], opts?: { actorUserId?: string | null }): Promise<ComposeResult>;
  /** True when the HTTP service answered recently (health). */
  reachable(): Promise<boolean>;
}

export interface CreateComposerClientOptions {
  url: string;
  db: Db;
  models: ModelClient;
  log: ApiLogger;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Run the composer logic in-process when the service is unreachable (development/test). */
  allowFallback: boolean;
}

export class ComposerUnavailableError extends AppError {
  constructor(reason: string) {
    super("composer_unavailable", `The composer service is unavailable: ${reason}`, 503);
  }
}

export function createComposerClient(opts: CreateComposerClientOptions): ComposerClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  const post = async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${opts.url.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`composer ${path} answered ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(t);
    }
  };

  const itemFromResponse = async (businessId: string, json: Record<string, unknown>): Promise<InboxItem> => {
    const item = (json.item as { id?: string } | undefined) ?? (json as { id?: string });
    if (!item?.id) throw new Error("composer response carried no item id");
    return repos.inbox.get(opts.db, businessId, item.id);
  };

  const viaService = async (path: string, body: Record<string, unknown>, businessId: string): Promise<ComposeResult> => ({
    item: await itemFromResponse(businessId, await post(path, body)),
    source: "composer",
  });

  const run = async (path: string, body: Record<string, unknown>, businessId: string, local: () => Promise<InboxItem>): Promise<ComposeResult> => {
    try {
      return await viaService(path, body, businessId);
    } catch (err) {
      if (!opts.allowFallback) throw new ComposerUnavailableError((err as Error).message);
      opts.log.debug({ err: (err as Error).message, path }, "composer unreachable; composing in-process");
      return { item: await local(), source: "local" };
    }
  };

  return {
    refresh: (businessId, o = {}) => run("/v1/refresh", { businessId }, businessId, () => composeLocally(opts.db, opts.models, businessId, { actorUserId: o.actorUserId ?? null })),
    narrate: (businessId, eventIds, o = {}) =>
      run("/v1/narrate", { businessId, eventIds }, businessId, () => composeLocally(opts.db, opts.models, businessId, { eventIds, actorUserId: o.actorUserId ?? null })),
    async reachable() {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 1_000);
        const res = await fetchImpl(`${opts.url.replace(/\/$/, "")}/health`, { signal: controller.signal }).finally(() => clearTimeout(t));
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/** Named queries the composer may reference as exhibits (AC-11.3.6: charts only reference named queries). */
export const NAMED_QUERIES = [
  { id: "tasks_by_status", title: "Tasks by status", kind: "table" },
  { id: "conversions_30d", title: "Conversions, last 30 days", kind: "chart" },
  { id: "channel_cpa", title: "Cost per customer by channel", kind: "chart" },
  { id: "cash_position", title: "Cash position", kind: "table" },
] as const;

export interface ComposeLocallyOptions {
  eventIds?: readonly string[];
  actorUserId?: string | null;
}

/** Compose one inbox item in-process (what the composer service does, without the buffer). */
export async function composeLocally(db: Db, models: ModelClient, businessId: string, options: ComposeLocallyOptions = {}): Promise<InboxItem> {
  const business = await repos.businesses.get(db, businessId);
  const agentsPage = await repos.agents.list(db, businessId, { limit: 200 });
  const agents = agentsPage.items;
  if (agents.length === 0) throw new AppError("no_agents", "The business has no agents to write from", 409);
  const chief = (await repos.agents.chiefOfStaff(db, businessId)) ?? agents[0]!;

  const events = options.eventIds && options.eventIds.length > 0 ? await repos.events.byIds(db, businessId, options.eventIds) : await repos.events.unnarrated(db, businessId, 3);

  const crm = await repos.entities.manifest(db, businessId, { limit: 300 });
  const manifestInput: ManifestEntityInput[] = [
    ...crm.map((e) => ({ id: e.id, kind: e.kind as EntityKind, name: e.displayName, aliases: e.aliases })),
    ...agents.map((a) => ({ id: a.id, kind: "agent" as const, name: a.name, aliases: [], role: a.role })),
  ];
  const manifest = buildManifest(manifestInput, { strictKinds: false });
  const crmIds = new Set(crm.map((e) => e.id));

  const [taskCounts, conversions, channels] = await Promise.all([
    repos.tasks.countByStatus(db, businessId),
    repos.journeys.countConversions(db, businessId, { from: new Date(Date.now() - 30 * 86_400_000) }),
    repos.channels.list(db, businessId, { enabled: true }),
  ]);

  const metrics = [
    { metric: "tasks_running", value: String(taskCounts.running ?? 0), source: "tasks_by_status" },
    { metric: "customers_30d", value: String(conversions.payment ?? 0), source: "conversions_30d" },
    { metric: "signups_30d", value: String(conversions.signup ?? 0), source: "conversions_30d" },
    { metric: "channels_enabled", value: String(channels.length), source: "channel_cpa" },
  ];

  const input = {
    business: { id: business.id, name: business.name, archetype: business.archetype, business_mode: business.businessMode, glossary: business.glossary },
    business_name: business.name,
    app_name: APP_NAME,
    from_agent: { id: chief.id, name: chief.name, role: chief.role || "Chief of Staff" },
    agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role, agent_type: a.agentType, department_id: a.departmentIds[0] ?? null, status: a.status })),
    manifest: manifest.toJSON(),
    events: events.map((e) => ({ id: e.id, type: e.type, occurred_at: e.occurredAt, payload: e.payload, entity_ids: e.entityIds })),
    metrics,
    named_queries: NAMED_QUERIES,
    ...(events.length === 0 ? { decision_needed: true, note: "No new events. Offer an insight from the metrics or the next-best decision grounded in current state. Never invent an event." } : {}),
  };

  const result = await models.complete({
    route: "inboxComposer",
    schema: ComposerOutput,
    system: `You are the Inbox Composer for ${business.name} on ${APP_NAME}. Write fact → why it matters → ask in 60-180 words. Mention entities only as [[ent:<id>|Name]] using manifest ids.`,
    messages: [{ role: "user", content: "```json\n" + JSON.stringify(input) + "\n```" }],
    attribution: { businessId, kind: "inbox_composer" },
    cacheSystem: true,
  });
  const out = result.json;

  // Validate links (unknown/invisible ids never reach render); one re-ask is the service's job, the fallback strips.
  const check = checkComposerText(out.body_md, manifest);
  const bodyMd = check.ok ? out.body_md : check.fallbackText;
  const entityIds = check.validation.entityIds.filter((id) => crmIds.has(id));
  const agentIds = new Set(agents.map((a) => a.id));
  const eventIds = events.map((e) => e.id);

  const item = {
    type: out.type,
    from_agent_id: agentIds.has(out.from_agent_id) ? out.from_agent_id : chief.id,
    subject: out.subject.slice(0, 80),
    body_md: bodyMd.trim().length > 0 ? bodyMd : out.subject,
    status_strip: out.status_strip.slice(0, 4),
    exhibit: NAMED_QUERIES.some((q) => q.id === out.exhibit.spec_ref) ? out.exhibit : { kind: "none" as const, spec_ref: null },
    decision: out.type === "decision" || out.type === "customer_won" ? (out.decision ?? defaultDecision()) : out.decision,
    blocks_continue: out.type === "decision" || out.type === "customer_won" ? true : out.blocks_continue,
    source_event_ids: eventIds,
    entity_ids: entityIds,
  };

  return db.transaction(async (tx: DbTx) => {
    const created = await repos.inbox.createItem(tx, businessId, item, { costMinor: result.cost.costMinorInt, currency: business.glossary.currency ?? "EUR" });
    if (eventIds.length) await repos.events.markNarrated(tx, businessId, eventIds);
    await writeEventRow(tx, {
      businessId,
      type: "inbox.item_created",
      actor: { kind: "agent", id: item.from_agent_id },
      entityIds,
      payload: {
        inboxItemId: created.id,
        type: created.type,
        fromAgentId: created.fromAgentId,
        subject: created.subject,
        blocksContinue: created.blocksContinue,
        sourceEventIds: eventIds,
        cost: { amountMinor: result.cost.costMinorInt, currency: "EUR" },
      },
    });
    return created;
  });
}

function defaultDecision() {
  return {
    options: [
      { id: "proceed", label: "Proceed as recommended", recommended: true, consequence: "The team continues with the recommended next step.", cost_minor: 0, reversible: true },
      { id: "hold", label: "Hold for now", recommended: false, consequence: "Nothing changes until you decide.", cost_minor: 0, reversible: true },
    ],
    free_text: true,
    expires_at: null,
  };
}
