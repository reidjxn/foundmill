/**
 * Builders shared by both demo businesses: the channel formation, agent and founder CRM entities, specification
 * blocks, roadmap items, tasks in mixed states with sessions, Inbox items with validated entity links, integrations
 * in mock status, legal records and the founder's Home dashboard. The business modules supply the words.
 */
import { CHANNEL_KEYS, CHANNEL_META, ENTITY_MARKUP_RE, MODULE_KEYS, type ChannelKey, type InboxItemType, type TaskKind, type TaskStatus } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { repos, type ComposerItem } from "../repos";
import { agentSessions, inboxItems as inboxItemsTable, tasks as tasksTable, type Agent, type Channel, type Entity, type InboxItem, type NewAgentSession, type Task } from "../schema";
import { addDays, addHours, atHour, bulkInsert, DAY_MS, mention, proseDoc, type SeedCtx } from "./context";
import type { SeededAgent, SquadResult } from "./squad";

// --- channels ---------------------------------------------------------------------------------------------------------

export interface ChannelPlan {
  enabled: ChannelKey[];
  recommended: ChannelKey[];
  /** Overrides of fit (1-20) by key; others get a deterministic score around the archetype's mix. */
  fit?: Partial<Record<ChannelKey, number>>;
  budgetMinor?: Partial<Record<ChannelKey, number>>;
  kitMode?: Partial<Record<ChannelKey, boolean>>;
  why?: Partial<Record<ChannelKey, string>>;
}

export async function seedChannels(ctx: SeedCtx, businessId: string, squad: SquadResult, currency: string, plan: ChannelPlan): Promise<Channel[]> {
  const rng = ctx.rng.fork(`channels:${businessId}`);
  return repos.channels.upsertMany(
    ctx.db,
    businessId,
    CHANNEL_KEYS.map((channelKey) => {
      const enabled = plan.enabled.includes(channelKey);
      const recommended = plan.recommended.includes(channelKey);
      const fit = plan.fit?.[channelKey] ?? (recommended ? rng.int(13, 18) : enabled ? rng.int(9, 14) : rng.int(3, 10));
      return {
        channelKey,
        line: CHANNEL_META[channelKey].line,
        enabled,
        recommended,
        fit,
        potential: Math.min(100, fit * 4 + rng.int(0, 15)),
        whyMd: plan.why?.[channelKey] ?? `${CHANNEL_META[channelKey].label}: fit ${fit}/20 for this business (Estimate). ${recommended ? "Recommended starter." : enabled ? "Running." : "Available on request."}`,
        budgetMinor: plan.budgetMinor?.[channelKey] ?? (enabled ? rng.int(4, 24) * 2_500 : 0),
        currency,
        kitMode: plan.kitMode?.[channelKey] ?? CHANNEL_META[channelKey].kitModeByDefault,
        ownerAgentId: squad.byTemplate.get(`channel_${channelKey}`)?.agent.id ?? null,
      };
    }),
  );
}

// --- CRM entities for agents and the founder --------------------------------------------------------------------------

export interface AgentEntities {
  byAgentId: Map<string, Entity>;
  founder: Entity;
}

export async function seedAgentEntities(ctx: SeedCtx, businessId: string, squad: SquadResult, founderName: string): Promise<AgentEntities> {
  const byAgentId = new Map<string, Entity>();
  for (const a of squad.agents) {
    const entity = await repos.entities.create(ctx.db, businessId, {
      kind: "agent",
      displayName: a.agent.name,
      aliases: [a.agent.role],
      identifiers: { agent_type: a.agent.agentType, template: a.template.key },
      source: "squad",
      visibility: "private",
      agentId: a.agent.id,
    });
    byAgentId.set(a.agent.id, entity);
  }
  const founder = await repos.entities.create(ctx.db, businessId, {
    kind: "team_member",
    displayName: founderName,
    aliases: ["the founder"],
    identifiers: { email: ctx.owner.email, user_id: ctx.owner.userId },
    source: "membership",
    visibility: "private",
  });
  await repos.entities.addRole(ctx.db, businessId, founder.id, { role: "founder", stage: "active" });
  return { byAgentId, founder };
}

export const agentMention = (entities: AgentEntities, a: SeededAgent | Agent): string => {
  const agent = "agent" in a ? a.agent : a;
  const e = entities.byAgentId.get(agent.id);
  return e ? mention(e.id, e.displayName) : agent.name;
};

// --- specification ------------------------------------------------------------------------------------------------------

export async function seedSpec(ctx: SeedCtx, businessId: string, outline: readonly string[], text: Record<string, string[]>, authorAgentId: string | null): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [position, section] of outline.entries()) {
    const paragraphs = text[section] ?? [`${section}: to be drafted by the Product lead in the next cycle.`];
    const block = await repos.product.createBlock(ctx.db, businessId, {
      section,
      position,
      content: proseDoc(...paragraphs),
      authoredByKind: authorAgentId ? "agent" : "system",
      authoredBy: authorAgentId,
      pinned: position === 0,
    });
    ids.set(section, block.id);
  }
  await repos.product.publishVersion(ctx.db, businessId, { changelogMd: "Specification v1 drafted from the concept card (synthetic demo).", publishedBy: ctx.owner.userId });
  return ids;
}

/**
 * A seeded source's `relevance` in the shape the Source Watcher writes (packages/agents source-watcher.ts) and the
 * Sources and Research tabs read: a summary, the spec blocks it touches with scores, topics, and when it was checked.
 */
export function seededRelevance(
  specIds: ReadonlyMap<string, string>,
  input: { summary: string; sections: readonly (readonly [string, number])[]; topics: readonly string[]; checkedAt: Date; severity?: "low" | "normal" | "critical"; extra?: Record<string, unknown> },
): Record<string, unknown> {
  const blocks = input.sections.flatMap(([section, score]) => {
    const blockId = specIds.get(section);
    return blockId ? [{ blockId, score, reason: "" }] : [];
  });
  return { summary: input.summary, blocks, topics: [...input.topics], severity: input.severity ?? "normal", ...input.extra, watch: { status: "scored", checkedAt: input.checkedAt.toISOString(), costLabel: "Estimate" } };
}

// --- roadmap ----------------------------------------------------------------------------------------------------------------

export interface RoadmapSpec {
  title: string;
  horizon: "now" | "next" | "later";
  status: string;
  confidence: number;
  startOffsetDays: number;
  durationDays: number;
  section?: string;
  ownerDepartmentSlug?: string;
}

export async function seedRoadmap(ctx: SeedCtx, businessId: string, items: RoadmapSpec[], specIds: Map<string, string>, squad: SquadResult): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let position = 0;
  for (const item of items) {
    const start = addDays(ctx.today, item.startOffsetDays);
    const dept = item.ownerDepartmentSlug ? squad.departmentBySlug.get(item.ownerDepartmentSlug) : undefined;
    const row = await repos.product.upsertRoadmapItem(ctx.db, businessId, {
      title: item.title,
      descriptionMd: `${item.title} (${item.horizon}).`,
      horizon: item.horizon,
      targetStart: start.toISOString().slice(0, 10),
      targetEnd: addDays(start, item.durationDays).toISOString().slice(0, 10),
      confidence: item.confidence,
      ownerRef: dept ? { kind: "department", id: dept.id } : null,
      specBlockIds: item.section && specIds.get(item.section) ? [specIds.get(item.section)!] : [],
      status: item.status,
      position: position++,
    });
    ids.set(item.title, row.id);
  }
  return ids;
}

// --- tasks and sessions ------------------------------------------------------------------------------------------------------

export interface TaskSpec {
  kind: TaskKind;
  title: string;
  goal: string;
  acceptance: string[];
  status: TaskStatus;
  departmentSlug: string;
  assigneeTemplateKey: string;
  roadmapTitle?: string;
  /** Days ago the task started (0 = today). Done tasks ended `durationHours` later. */
  startedDaysAgo?: number;
  durationHours?: number;
  progress?: number;
  phase?: "planning" | "implementing" | "testing" | "review" | "merge" | "done";
  fileScope?: string[];
  recordingRef?: string | null;
  dependsOn?: string[];
}

export interface SeededTask {
  task: Task;
  sessionIds: string[];
}

export async function seedTasks(ctx: SeedCtx, businessId: string, specs: TaskSpec[], squad: SquadResult, roadmapIds: Map<string, string>, currency: string): Promise<Map<string, SeededTask>> {
  const rng = ctx.rng.fork(`tasks:${businessId}`);
  const out = new Map<string, SeededTask>();
  const sessions: NewAgentSession[] = [];
  for (const s of specs) {
    const dept = squad.departmentBySlug.get(s.departmentSlug);
    const assignee = squad.byTemplate.get(s.assigneeTemplateKey);
    const task = await repos.tasks.create(ctx.db, businessId, {
      kind: s.kind,
      title: s.title,
      goalMd: s.goal,
      acceptance: s.acceptance,
      fileScope: s.fileScope ?? [],
      roadmapItemId: s.roadmapTitle ? (roadmapIds.get(s.roadmapTitle) ?? null) : null,
      departmentId: dept?.id ?? null,
      assigneeAgentId: assignee?.agent.id ?? null,
      status: s.status,
      phase: s.phase ?? (s.status === "done" ? "done" : s.status === "running" ? "implementing" : s.status === "review" ? "review" : s.status === "merging" ? "merge" : null),
      priority: rng.int(1, 5),
      currency,
      dependsOn: (s.dependsOn ?? []).map((t) => out.get(t)?.task.id).filter((id): id is string => Boolean(id)),
    });
    const progress = s.progress ?? (s.status === "done" ? 1 : s.status === "running" ? rng.range(0.2, 0.8) : s.status === "review" || s.status === "merging" ? 0.95 : 0);
    await ctx.db.update(tasksTable).set({ progress: progress.toFixed(4) }).where(eq(tasksTable.id, task.id));
    const sessionIds: string[] = [];
    if (assignee && s.startedDaysAgo !== undefined) {
      const startedAt = addHours(atHour(addDays(ctx.today, -s.startedDaysAgo), 9, rng.int(0, 50)), 0);
      const hours = s.durationHours ?? rng.range(1, 4);
      const open = s.status === "running";
      const endedAt = open ? null : new Date(startedAt.getTime() + hours * 3_600_000);
      const tokensIn = Math.round(hours * 200_000 * rng.range(0.7, 1.3));
      const id = rng.uuid();
      sessions.push({
        id,
        businessId,
        agentId: assignee.agent.id,
        versionId: assignee.versionId,
        taskId: task.id,
        workflowId: `session:${id}`,
        modelKey: assignee.agent.modelKey,
        startedAt,
        endedAt,
        tokensIn,
        tokensOut: Math.round(tokensIn * 0.12),
        costMinor: Math.round(hours * 180),
        currency,
        outcome: open ? null : s.status === "done" ? "completed" : s.status === "failed" ? "failed" : s.status === "stopped" ? "stopped" : "handed_over",
        recordingRef: s.recordingRef ?? null,
      });
      sessionIds.push(id);
      const ended = s.status === "done" ? endedAt : null;
      await ctx.db.update(tasksTable).set({ startedAt, endedAt: ended, eta: open ? addHours(startedAt, hours + 2) : null }).where(eq(tasksTable.id, task.id));
    }
    out.set(s.title, { task, sessionIds });
  }
  await bulkInsert(ctx.db, agentSessions, sessions);
  return out;
}

/** Older "done" tasks spread across the history so Development's Plan and the department cards have a past. */
export async function seedHistoricalTasks(ctx: SeedCtx, businessId: string, squad: SquadResult, titles: Array<{ kind: TaskKind; departmentSlug: string; assigneeTemplateKey: string; title: string }>, count: number, currency: string): Promise<number> {
  const rng = ctx.rng.fork(`history-tasks:${businessId}`);
  const sessions: NewAgentSession[] = [];
  let made = 0;
  for (let i = 0; i < count; i++) {
    const t = titles[i % titles.length]!;
    const dept = squad.departmentBySlug.get(t.departmentSlug);
    const assignee = squad.byTemplate.get(t.assigneeTemplateKey);
    if (!dept || !assignee) continue;
    const daysAgo = rng.int(2, Math.max(3, ctx.days - 20));
    const startedAt = atHour(addDays(ctx.today, -daysAgo), rng.int(8, 15), rng.int(0, 59));
    const hours = rng.range(0.5, 3.5);
    const endedAt = new Date(startedAt.getTime() + hours * 3_600_000);
    const failed = rng.bool(0.06);
    const task = await repos.tasks.create(ctx.db, businessId, {
      kind: t.kind,
      title: `${t.title} #${Math.floor(i / titles.length) + 1}`,
      goalMd: `${t.title}.`,
      acceptance: ["Acceptance criteria met", "Reviewed"],
      departmentId: dept.id,
      assigneeAgentId: assignee.agent.id,
      status: failed ? "failed" : "done",
      phase: "done",
      currency,
    });
    await ctx.db.update(tasksTable).set({ startedAt, endedAt, progress: failed ? "0.6000" : "1.0000" }).where(eq(tasksTable.id, task.id));
    const id = rng.uuid();
    const tokensIn = Math.round(hours * 180_000);
    sessions.push({
      id, businessId, agentId: assignee.agent.id, versionId: assignee.versionId, taskId: task.id, workflowId: `session:${id}`, modelKey: assignee.agent.modelKey,
      startedAt, endedAt, tokensIn, tokensOut: Math.round(tokensIn * 0.11), costMinor: Math.round(hours * 180), currency, outcome: failed ? "failed" : "completed", recordingRef: null,
    });
    made += 1;
  }
  await bulkInsert(ctx.db, agentSessions, sessions);
  return made;
}

// --- inbox ---------------------------------------------------------------------------------------------------------------------

export interface InboxSpec {
  type: Exclude<InboxItemType, "human_message">;
  fromAgentId: string;
  subject: string;
  bodyMd: string;
  statusStrip?: Array<{ metric: string; source: string }>;
  exhibit?: { kind: "chart" | "table" | "entity_card" | "diagram" | "diff" | "agent_tile"; spec_ref: string };
  decision?: { options: Array<{ id: string; label: string; recommended: boolean; consequence: string; cost_minor: number; reversible: boolean }>; free_text: boolean; expires_at: string | null };
  blocksContinue?: boolean;
  sourceEventIds?: string[];
  /** Extra entity ids beyond those found in the body markup. */
  entityIds?: string[];
  state?: "unread" | "read" | "answered" | "archived";
  createdDaysAgo?: number;
  costMinor?: number;
  /** For decisions already taken (answered state). */
  decided?: { chosenOption?: string; freeText?: string; byKind: "user" | "chief_of_staff" };
}

export const entityIdsIn = (body: string): string[] => [...new Set([...body.matchAll(ENTITY_MARKUP_RE)].map((m) => m[1]!))];

export async function seedInbox(ctx: SeedCtx, businessId: string, specs: InboxSpec[], currency: string): Promise<InboxItem[]> {
  const out: InboxItem[] = [];
  for (const s of specs) {
    const item: ComposerItem = {
      type: s.type,
      from_agent_id: s.fromAgentId,
      subject: s.subject,
      body_md: s.bodyMd,
      status_strip: s.statusStrip ?? [],
      exhibit: s.exhibit ?? { kind: "none", spec_ref: null },
      decision: s.decision ?? null,
      blocks_continue: s.blocksContinue ?? false,
      source_event_ids: s.sourceEventIds ?? [],
      entity_ids: [...new Set([...entityIdsIn(s.bodyMd), ...(s.entityIds ?? [])])],
    };
    let row = await repos.inbox.createItem(ctx.db, businessId, item, { costMinor: s.costMinor ?? 180, currency, state: s.decided ? "unread" : (s.state ?? "unread") });
    if (s.decided) {
      const decided = await repos.inbox.decide(ctx.db, businessId, row.id, {
        chosenOption: s.decided.chosenOption ?? null,
        freeText: s.decided.freeText ?? null,
        decidedByKind: s.decided.byKind,
        decidedBy: s.decided.byKind === "user" ? ctx.owner.userId : s.fromAgentId,
      });
      row = decided.item;
    }
    if (s.createdDaysAgo !== undefined) {
      const createdAt = addHours(addDays(ctx.today, -s.createdDaysAgo), -(s.createdDaysAgo === 0 ? 2 : 6));
      await ctx.db.update(inboxItemsTable).set({ createdAt, updatedAt: createdAt }).where(eq(inboxItemsTable.id, row.id));
      row = { ...row, createdAt };
    }
    out.push(row);
  }
  return out;
}

// --- integrations -------------------------------------------------------------------------------------------------------------

export interface IntegrationSpec {
  connectorKey: string;
  authKind: "oauth" | "api_key" | "app" | "none";
  accountLabel: string;
  scopes?: string[];
  settings?: Record<string, unknown>;
  status?: "connected" | "degraded" | "expired" | "disconnected" | "mock";
}

export async function seedIntegrations(ctx: SeedCtx, businessId: string, specs: IntegrationSpec[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const s of specs) {
    const row = await repos.integrations.upsert(ctx.db, businessId, {
      connectorKey: s.connectorKey,
      status: s.status ?? "mock",
      authKind: s.authKind,
      scopes: s.scopes ?? [],
      accountLabel: s.accountLabel,
      settings: { mode: "mock", ...(s.settings ?? {}) },
      connectedBy: ctx.owner.userId,
    });
    const degraded = (s.status ?? "mock") === "degraded";
    await repos.integrations.recordHealth(ctx.db, businessId, row.id, { ok: !degraded, error: degraded ? "token refresh failed twice (mock)" : null, at: addHours(ctx.today, -1) });
    ids.set(s.connectorKey, row.id);
  }
  return ids;
}

// --- dashboard ---------------------------------------------------------------------------------------------------------------

/** The "Founder's view" preset exactly as apps/api/src/presets.ts stores it (12-column grid, 8 px rows). */
export const FOUNDER_PRESET_LAYOUT = {
  widgets: [
    { key: "journey_ribbon", x: 0, y: 0, w: 12, h: 38, settings: {} },
    { key: "status_strip", x: 0, y: 38, w: 12, h: 12, settings: {} },
    { key: "department_card", x: 0, y: 50, w: 4, h: 30, settings: { slot: 0 } },
    { key: "department_card", x: 4, y: 50, w: 4, h: 30, settings: { slot: 1 } },
    { key: "department_card", x: 8, y: 50, w: 4, h: 30, settings: { slot: 2 } },
    { key: "department_card", x: 0, y: 80, w: 4, h: 30, settings: { slot: 3 } },
    { key: "department_card", x: 4, y: 80, w: 4, h: 30, settings: { slot: 4 } },
    { key: "department_card", x: 8, y: 80, w: 4, h: 30, settings: { slot: 5 } },
    { key: "squad_pulse", x: 0, y: 110, w: 8, h: 32, settings: {} },
    { key: "inbox_preview", x: 8, y: 110, w: 4, h: 32, settings: {} },
  ],
};

export async function seedDashboards(ctx: SeedCtx, businessId: string): Promise<void> {
  for (const owner of ctx.owners) {
    await repos.dashboards.create(ctx.db, businessId, { userId: owner.userId, name: "Home", preset: "founder", layout: FOUNDER_PRESET_LAYOUT, isActive: true });
  }
}

/** Every module key the departments cover (sanity for tests). */
export const allModuleKeys = (): readonly string[] => MODULE_KEYS;

export const daysAgo = (ctx: SeedCtx, n: number): Date => new Date(ctx.today.getTime() - n * DAY_MS);
