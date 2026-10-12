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
import { getEventDeclaration, isEventType } from "@foundmill/events";
import { writeEventRow } from "./events";
import { buildManifest, checkComposerText, type ManifestEntityInput } from "@foundmill/entity-linker";
import { ComposerOutput, type ModelClient } from "@foundmill/models";
import { APP_NAME, LIMITS } from "@foundmill/config";
import { HOUSE_STYLE } from "@foundmill/agents";
import { AppError, type EntityKind } from "@foundmill/shared";
import type { ApiLogger } from "./log";
import { noteModelCall } from "./model-calls";

export interface ComposeResult {
  item: InboxItem;
  source: "composer" | "local";
  /**
   * Which Refresh rule wrote the note (the composer service's `slot`): `events` narrated new events; `insight` and
   * `decision` mean nothing new happened, so the page can say so ("Nothing new since your last note").
   */
  slot?: "events" | "insight" | "decision" | "narrate";
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
  /**
   * How long refresh and narrate wait for the composer (default `LIMITS.composerClientTimeoutMs`, env
   * COMPOSER_TIMEOUT_MS). A cold Refresh is a live Opus call; the composer abandons a note at its own, shorter deadline.
   */
  timeoutMs?: number;
  /** Run the composer logic in-process when the service is unreachable (development/test). */
  allowFallback: boolean;
}

export class ComposerUnavailableError extends AppError {
  constructor(reason: string) {
    super("composer_unavailable", `The composer service is unavailable: ${reason}`, 503);
  }
}

/**
 * The composer did not answer within the client's wait. It may still be writing, so this is not "unavailable" (audit
 * CML-04): the note appears in the Inbox if it finishes. With the default waits it cannot happen while a note is being
 * written, since the composer gives up on a note (and answers 504 `composer_timeout`) before the client does.
 */
export class ComposerTimeoutError extends AppError {
  constructor(timeoutMs: number) {
    super("composer_timeout", `The composer did not answer within ${Math.round(timeoutMs / 1000)} seconds. If a note was being written, it will appear in your Inbox.`, 504);
  }
}

/** Why a call to the composer service failed: no answer at all, no answer in time, or an answer that was an error. */
type CallFailure = { kind: "unreachable"; message: string } | { kind: "timeout" } | { kind: "answered"; error: AppError };

class ComposerCallError extends Error {
  constructor(readonly failure: CallFailure) {
    super(failure.kind === "unreachable" ? failure.message : failure.kind === "timeout" ? "timed out" : failure.error.message);
  }
}

export function createComposerClient(opts: CreateComposerClientOptions): ComposerClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? LIMITS.composerClientTimeoutMs;

  const post = async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${opts.url.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.ok) return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      throw new ComposerCallError(controller.signal.aborted ? { kind: "timeout" } : { kind: "unreachable", message: (err as Error).message });
    } finally {
      clearTimeout(t);
    }
    // The composer answered with an error (`{ error, message }`): its own words and status, not "unavailable".
    const json = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown; details?: unknown } | null;
    if (typeof json?.error === "string" && typeof json.message === "string") throw new ComposerCallError({ kind: "answered", error: new AppError(json.error, json.message, res.status, json.details ?? undefined) });
    throw new ComposerCallError({ kind: "unreachable", message: `composer ${path} answered ${res.status}` });
  };

  const itemFromResponse = async (businessId: string, json: Record<string, unknown>): Promise<InboxItem> => {
    const item = (json.item as { id?: string } | undefined) ?? (json as { id?: string });
    if (!item?.id) throw new Error("composer response carried no item id");
    return repos.inbox.get(opts.db, businessId, item.id);
  };

  const viaService = async (path: string, body: Record<string, unknown>, businessId: string): Promise<ComposeResult> => {
    const json = await post(path, body);
    const slot = typeof json.slot === "string" && ["events", "insight", "decision", "narrate"].includes(json.slot) ? (json.slot as ComposeResult["slot"]) : undefined;
    return { item: await itemFromResponse(businessId, json), source: "composer", slot };
  };

  const run = async (path: string, body: Record<string, unknown>, businessId: string, local: () => Promise<LocalComposed>): Promise<ComposeResult> => {
    // The composer service may call a model for this request, so the request's allowance counts as spent
    // (services/model-calls.ts), unless the composer's credits gate refused it (402 `credits_exhausted`): then the
    // credits are used up and no further call can follow, so giving the hit back cannot be farmed. The in-process
    // path notes its calls through the api's client.
    try {
      const composed = await viaService(path, body, businessId);
      noteModelCall();
      return composed;
    } catch (err) {
      const failure: CallFailure = err instanceof ComposerCallError ? err.failure : { kind: "unreachable", message: (err as Error).message };
      if (!(failure.kind === "answered" && failure.error.code === "credits_exhausted")) noteModelCall();
      // Never compose a second note in-process while the service may still be writing one, nor over its answer.
      if (failure.kind === "timeout") throw new ComposerTimeoutError(timeoutMs);
      if (failure.kind === "answered" && (failure.error.status < 500 || !opts.allowFallback)) throw failure.error;
      if (!opts.allowFallback) throw new ComposerUnavailableError(failure.kind === "unreachable" ? failure.message : failure.error.message);
      opts.log.debug({ err: failure.kind === "unreachable" ? failure.message : failure.error.message, path }, "composer unreachable; composing in-process");
      const composed = await local();
      return { item: composed.item, source: "local", slot: composed.slot };
    }
  };

  return {
    refresh: (businessId, o = {}) => run("/v1/refresh", { businessId }, businessId, () => composeLocallyWithSlot(opts.db, opts.models, businessId, { actorUserId: o.actorUserId ?? null })),
    narrate: (businessId, eventIds, o = {}) =>
      run("/v1/narrate", { businessId, eventIds }, businessId, () => composeLocallyWithSlot(opts.db, opts.models, businessId, { eventIds, actorUserId: o.actorUserId ?? null })),
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

function isNarratableEvent(type: string): boolean {
  return isEventType(type) && getEventDeclaration(type).narratable;
}

interface LocalComposed {
  item: InboxItem;
  slot: "events" | "decision";
}

export interface LocalDecisionState {
  tasks: Partial<Record<string, number>>;
  channelsEnabled: number;
  customers30d: number;
  signups30d: number;
}

export interface LocalDecision {
  kind: "unblock_tasks" | "start_distribution" | "plan_next_cycle";
  title: string;
  facts: Record<string, number>;
  options: Array<{ id: string; label: string; recommended: boolean; consequence: string; cost_minor: number; reversible: boolean }>;
  exhibit: { kind: "table" | "chart"; spec_ref: (typeof NAMED_QUERIES)[number]["id"] };
}

/**
 * The next-best decisions grounded in the current state, in priority order: the same candidates and wording as the
 * composer service (apps/composer/src/decisions.ts) for the state the in-process path can read. The last one always
 * applies, so Refresh still yields exactly one note (AC-11.3.2) and never a "nothing new" filler.
 */
export function localNextBestDecisions(s: LocalDecisionState): LocalDecision[] {
  const n = (k: string) => s.tasks[k] ?? 0;
  const out: LocalDecision[] = [];
  if (n("blocked") > 0) {
    out.push({
      kind: "unblock_tasks",
      title: "Blocked tasks need a call",
      facts: { blocked_tasks: n("blocked"), running_tasks: n("running") },
      options: [
        { id: "review", label: "Review the blocked tasks now", recommended: true, consequence: "The team gets answers this cycle and work resumes.", cost_minor: 0, reversible: true },
        { id: "reassign", label: "Reassign them to the department lead", recommended: false, consequence: "The lead triages and comes back only with hard gates.", cost_minor: 0, reversible: true },
        { id: "park", label: "Park them until the next cycle", recommended: false, consequence: "Nothing moves on those tasks; dependents wait.", cost_minor: 0, reversible: true },
      ],
      exhibit: { kind: "table", spec_ref: "tasks_by_status" },
    });
  }
  if (s.channelsEnabled === 0) {
    out.push({
      kind: "start_distribution",
      title: "No distribution channel is live",
      facts: { channels_enabled: s.channelsEnabled, signups_30d: s.signups30d, customers_30d: s.customers30d },
      options: [
        { id: "recommend", label: "Ask the strategist for a channel plan", recommended: true, consequence: "The Distribution Strategist scores all channels and proposes starters.", cost_minor: 0, reversible: true },
        { id: "wait", label: "Hold until the product is further along", recommended: false, consequence: "No acquisition work; the pipeline stays empty.", cost_minor: 0, reversible: true },
      ],
      exhibit: { kind: "chart", spec_ref: "channel_cpa" },
    });
  }
  const quiet = s.customers30d === 0 && s.signups30d === 0;
  out.push({
    kind: "plan_next_cycle",
    title: "Set the focus for the next cycle",
    facts: { planned_tasks: n("planned"), running_tasks: n("running"), done_tasks: n("done"), customers_30d: s.customers30d },
    options: [
      { id: "product", label: "Lead with product work", recommended: quiet, consequence: "The next cycle starts from the roadmap's now items.", cost_minor: 0, reversible: true },
      { id: "distribution", label: "Lead with distribution", recommended: !quiet, consequence: "The next cycle prioritizes enabled channels and follow-ups.", cost_minor: 0, reversible: true },
      { id: "balanced", label: "Keep the current balance", recommended: false, consequence: "The Chief of Staff plans as usual within budget and capacity.", cost_minor: 0, reversible: true },
    ],
    exhibit: { kind: "table", spec_ref: "tasks_by_status" },
  });
  return out;
}

/** Compose one inbox item in-process (what the composer service does, without the buffer). */
export async function composeLocally(db: Db, models: ModelClient, businessId: string, options: ComposeLocallyOptions = {}): Promise<InboxItem> {
  return (await composeLocallyWithSlot(db, models, businessId, options)).item;
}

async function composeLocallyWithSlot(db: Db, models: ModelClient, businessId: string, options: ComposeLocallyOptions = {}): Promise<LocalComposed> {
  const business = await repos.businesses.get(db, businessId);
  const agentsPage = await repos.agents.list(db, businessId, { limit: 200 });
  const agents = agentsPage.items;
  if (agents.length === 0) throw new AppError("no_agents", "The business has no agents to write from", 409);
  const chief = (await repos.agents.chiefOfStaff(db, businessId)) ?? agents[0]!;

  // Like the composer service (apps/composer/src/context.ts), only narratable events become notes: an
  // `inbox.item_created` or `cycle.started` row picked here used to be narrated into a note about a note, and that note
  // about another ("Chief of Staff: Chief of Staff: Update: …"). Non-narratable rows found on the way are marked narrated.
  const candidates = options.eventIds && options.eventIds.length > 0 ? await repos.events.byIds(db, businessId, options.eventIds) : await repos.events.unnarrated(db, businessId, 20);
  const skipped = candidates.filter((e) => !isNarratableEvent(e.type));
  if (skipped.length && !(options.eventIds && options.eventIds.length > 0)) await repos.events.markNarrated(db, businessId, skipped.map((e) => e.id));
  const events = candidates.filter((e) => isNarratableEvent(e.type)).slice(0, options.eventIds && options.eventIds.length > 0 ? undefined : 3);

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

  // No new event: the next-best decision grounded in the current state (composer service parity), skipping one the
  // founder already has open so consecutive refreshes rotate instead of repeating the same note.
  let grounded: LocalDecision | null = null;
  if (events.length === 0) {
    const candidates = localNextBestDecisions({ tasks: taskCounts, channelsEnabled: channels.length, customers30d: conversions.payment ?? 0, signups30d: conversions.signup ?? 0 });
    const open = await repos.inbox.list(db, businessId, { type: "decision", state: ["unread", "read"], limit: 100 });
    const openSubjects = new Set(open.items.map((i) => i.subject));
    grounded = candidates.find((c) => !openSubjects.has(c.title)) ?? candidates[open.items.length % candidates.length]!;
  }

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
    ...(grounded
      ? {
          type: "decision",
          decision_needed: true,
          next_best_decision: { kind: grounded.kind, title: grounded.title, facts: grounded.facts, exhibit: grounded.exhibit },
          options: grounded.options,
          note: "No new event and no data change. Offer the next-best decision grounded in the current state using the options given. Never invent an event.",
        }
      : {}),
  };

  const result = await models.complete({
    route: "inboxComposer",
    schema: ComposerOutput,
    system: `You are the Inbox Composer for ${business.name} on ${APP_NAME}. Write fact → why it matters → ask in 60-180 words. Mention entities only as [[ent:<id>|Name]] using manifest ids. ${HOUSE_STYLE}`,
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

  const created = await db.transaction(async (tx: DbTx) => {
    const created = await repos.inbox.createItem(tx, businessId, item, { costMinor: result.cost.costMinorInt, currency: business.glossary.currency ?? "EUR" });
    if (eventIds.length) await repos.events.markNarrated(tx, businessId, eventIds);
    const createdEventId = await writeEventRow(tx, {
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
    // Not narratable (catalogue): marked at once so Refresh never narrates its own notes, as the composer service does.
    await repos.events.markNarrated(tx, businessId, [createdEventId]);
    return created;
  });
  return { item: created, slot: grounded ? "decision" : "events" };
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
