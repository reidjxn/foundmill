/**
 * agents, agent_versions, agent_sessions, agent_metrics — the squad (BUILD §9.1–9.2, §11.9, §11.10;
 * routers team.agents.*, agent.profile.*, agent.model.*, agent.autonomy.*, dev.sessions.*).
 */
import { AGENT_LAYERS, AGENT_PAUSE_REASONS, AGENT_STATUSES, AGENT_STOP_REASONS, AGENT_VERSION_STATES, MODEL_KEYS, uuid, ValidationError, type AgentPauseReason, type AgentStatus } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { agentMetrics, agentSessions, agentVersions, agents, CREATED_BY_KINDS, departments, tasks, type Agent, type AgentMetric, type AgentSession, type AgentVersion } from "../schema";
import { Currency, DayRange, dayRange, defined, Id, JsonArray, JsonObject, MinorAmount, numericText, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page, patchSchema } from "./_shared";

export const AgentInstructions = z.object({
  role: z.string().default(""),
  goals: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  playbook: z.array(z.string()).default([]),
  tone: z.string().default(""),
  examples: z.array(z.unknown()).default([]),
});

export const CreateAgentVersionInput = z.object({
  instructions: AgentInstructions.prefault({}),
  tools: JsonArray.default([]),
  modelKey: z.enum(MODEL_KEYS).optional(),
  state: z.enum(AGENT_VERSION_STATES).default("draft"),
  createdByKind: z.enum(CREATED_BY_KINDS).default("user"),
  createdBy: Id.nullable().optional(),
});
export type CreateAgentVersionInput = z.input<typeof CreateAgentVersionInput>;

export const CreateAgentInput = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().max(120).default(""),
  agentType: z.string().trim().min(1).max(80),
  layer: z.enum(AGENT_LAYERS).default("worker"),
  descriptionMd: z.string().default(""),
  departmentIds: z.array(Id).default([]),
  lineManagerId: Id.nullable().optional(),
  modelKey: z.enum(MODEL_KEYS).default("sonnet"),
  status: z.enum(AGENT_STATUSES).default("idle"),
  autonomy: JsonObject.default({}),
  negotiation: JsonObject.default({}),
  schedule: JsonObject.default({}),
  wageCapMinor: MinorAmount.nullable().optional(),
  currency: Currency.optional(),
  avatarSeed: z.string().max(80).optional(),
  /** When given, version 1 is created `live` with these instructions/tools and becomes current. */
  initialVersion: CreateAgentVersionInput.omit({ state: true }).optional(),
});
export type CreateAgentInput = z.input<typeof CreateAgentInput>;

export const UpdateAgentInput = patchSchema(CreateAgentInput.omit({ initialVersion: true, agentType: true, status: true }));
export type UpdateAgentInput = z.input<typeof UpdateAgentInput>;

export const AgentListFilter = PageInput.extend({
  departmentId: Id.optional(),
  status: z.enum(AGENT_STATUSES).optional(),
  layer: z.enum(AGENT_LAYERS).optional(),
  agentType: z.string().optional(),
  includeArchived: z.boolean().default(false),
});
export type AgentListFilter = z.input<typeof AgentListFilter>;

/**
 * A session's workflow id (ARCHITECTURE §10: `session:{sessionId}`). Every row stores exactly this, written with the
 * row, so a signal (pause, nudge, stop, the kill switch) always names a workflow that exists; there is no placeholder.
 */
export const sessionWorkflowId = (sessionId: string): string => `session:${sessionId}`;

export const CreateSessionInput = z.object({
  /** Supply the id when the caller needs it before the insert; otherwise one is generated. */
  id: Id.optional(),
  agentId: Id,
  versionId: Id.nullable().optional(),
  taskId: Id.nullable().optional(),
  modelKey: z.enum(MODEL_KEYS).default("sonnet"),
  startedAt: z.coerce.date().optional(),
  recordingRef: z.string().max(2048).nullable().optional(),
});
export type CreateSessionInput = z.input<typeof CreateSessionInput>;

export const EndSessionInput = z.object({
  endedAt: z.coerce.date().optional(),
  tokensIn: z.number().int().min(0).optional(),
  tokensOut: z.number().int().min(0).optional(),
  costMinor: MinorAmount.optional(),
  outcome: z.string().max(80).nullable().optional(),
  recordingRef: z.string().max(2048).nullable().optional(),
});
export type EndSessionInput = z.input<typeof EndSessionInput>;

export const UpsertMetricInput = z.object({
  agentId: Id,
  day: z.string().date(),
  tasksDone: z.number().int().min(0).default(0),
  successRate: z.number().min(0).max(1).nullable().optional(),
  reviewFindings: z.number().int().min(0).default(0),
  approvalsRejected: z.number().int().min(0).default(0),
  ratingAvg: z.number().min(0).max(10).nullable().optional(),
  costMinor: MinorAmount.default(0),
});
export type UpsertMetricInput = z.input<typeof UpsertMetricInput>;

/** What department.list shows of an agent: the lead and the team strip. */
export type AgentRosterRow = Pick<Agent, "id" | "name" | "role" | "status" | "modelKey" | "avatarSeed" | "departmentIds">;

const scoped = (businessId: string, agentId: string) => and(eq(agents.businessId, businessId), eq(agents.id, agentId));

export const agentsRepo = {
  async list(db: Executor, businessId: string, filter: AgentListFilter = {}): Promise<Page<Agent>> {
    const f = parseInput(AgentListFilter, filter, "agent filter");
    const ks = timeKeyset<Agent>(agents.createdAt, agents.id, (r) => ({ at: r.createdAt, id: r.id }), "asc");
    const rows = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.businessId, businessId),
          f.includeArchived ? undefined : isNull(agents.archivedAt),
          f.departmentId ? sql`${agents.departmentIds} @> array[${f.departmentId}::uuid]` : undefined,
          f.status ? eq(agents.status, f.status) : undefined,
          f.layer ? eq(agents.layer, f.layer) : undefined,
          f.agentType ? eq(agents.agentType, f.agentType) : undefined,
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /**
   * The live agents with only the columns a department's lead and team strip show (department.list), in `list`
   * order (oldest first). One projected query instead of whole agent rows.
   */
  async listRoster(db: Executor, businessId: string, options: { limit?: number } = {}): Promise<AgentRosterRow[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500), 1), 1000);
    const ks = timeKeyset<Agent>(agents.createdAt, agents.id, (r) => ({ at: r.createdAt, id: r.id }), "asc");
    return db
      .select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status, modelKey: agents.modelKey, avatarSeed: agents.avatarSeed, departmentIds: agents.departmentIds })
      .from(agents)
      .where(and(eq(agents.businessId, businessId), isNull(agents.archivedAt)))
      .orderBy(...ks.orderBy)
      .limit(limit);
  },

  async get(db: Executor, businessId: string, agentId: string): Promise<Agent> {
    return one(await db.select().from(agents).where(scoped(businessId, agentId)).limit(1), "agent", agentId);
  },

  /** Agents by ids (only those in the business). */
  async byIds(db: Executor, businessId: string, ids: readonly string[]): Promise<Agent[]> {
    if (ids.length === 0) return [];
    return db.select().from(agents).where(and(eq(agents.businessId, businessId), inArray(agents.id, [...ids])));
  },

  /** The business's Chief of Staff (assistant layer), or null before hiring. */
  async chiefOfStaff(db: Executor, businessId: string): Promise<Agent | null> {
    const rows = await db.select().from(agents).where(and(eq(agents.businessId, businessId), eq(agents.layer, "assistant"), isNull(agents.archivedAt))).orderBy(asc(agents.createdAt)).limit(1);
    return rows[0] ?? null;
  },

  /** Hire: inserts the agent (+ optional live version 1) in one transaction. */
  async create(db: Executor, businessId: string, input: CreateAgentInput): Promise<Agent & { currentVersion: AgentVersion | null }> {
    const v = parseInput(CreateAgentInput, input, "agent");
    return db.transaction(async (tx) => {
      const agent = one(
        await tx
          .insert(agents)
          .values({
            businessId,
            name: v.name,
            role: v.role,
            agentType: v.agentType,
            layer: v.layer,
            descriptionMd: v.descriptionMd,
            departmentIds: v.departmentIds,
            lineManagerId: v.lineManagerId ?? null,
            modelKey: v.modelKey,
            status: v.status,
            autonomy: v.autonomy,
            negotiation: v.negotiation,
            schedule: v.schedule,
            wageCapMinor: v.wageCapMinor ?? null,
            ...(v.currency ? { currency: v.currency } : {}),
            avatarSeed: v.avatarSeed ?? `${v.agentType}:${v.name}`,
          })
          .returning(),
        "agent",
      );
      if (!v.initialVersion) return { ...agent, currentVersion: null };
      const version = one(
        await tx
          .insert(agentVersions)
          .values({
            businessId,
            agentId: agent.id,
            version: 1,
            instructions: v.initialVersion.instructions,
            tools: v.initialVersion.tools,
            modelKey: v.initialVersion.modelKey ?? v.modelKey,
            state: "live",
            createdByKind: v.initialVersion.createdByKind,
            createdBy: v.initialVersion.createdBy ?? null,
          })
          .returning(),
        "agent version",
      );
      const updated = one(await tx.update(agents).set({ currentVersionId: version.id }).where(eq(agents.id, agent.id)).returning(), "agent");
      return { ...updated, currentVersion: version };
    });
  },

  /**
   * Many agents at once, each with its id chosen by the caller (so line managers can point at agents created in the
   * same call): one insert for the agents, one for their first versions, one update linking them. Three round trips
   * however large the team (commit hires about 26). Results come back in the order given.
   */
  async createMany(db: Executor, businessId: string, inputs: (CreateAgentInput & { id: string })[]): Promise<(Agent & { currentVersion: AgentVersion | null })[]> {
    if (inputs.length === 0) return [];
    const list = inputs.map((i) => ({ ...parseInput(CreateAgentInput, i, "agent"), id: parseInput(Id, i.id, "agent id") }));
    const created = await db
      .insert(agents)
      .values(
        list.map((v) => ({
          id: v.id,
          businessId,
          name: v.name,
          role: v.role,
          agentType: v.agentType,
          layer: v.layer,
          descriptionMd: v.descriptionMd,
          departmentIds: v.departmentIds,
          lineManagerId: v.lineManagerId ?? null,
          modelKey: v.modelKey,
          status: v.status,
          autonomy: v.autonomy,
          negotiation: v.negotiation,
          schedule: v.schedule,
          wageCapMinor: v.wageCapMinor ?? null,
          ...(v.currency ? { currency: v.currency } : {}),
          avatarSeed: v.avatarSeed ?? `${v.agentType}:${v.name}`,
        })),
      )
      .returning();
    const withVersion = list.filter((v) => v.initialVersion);
    const versions = withVersion.length
      ? await db
          .insert(agentVersions)
          .values(
            withVersion.map((v) => ({
              businessId,
              agentId: v.id,
              version: 1,
              instructions: v.initialVersion!.instructions,
              tools: v.initialVersion!.tools,
              modelKey: v.initialVersion!.modelKey ?? v.modelKey,
              state: "live" as const,
              createdByKind: v.initialVersion!.createdByKind,
              createdBy: v.initialVersion!.createdBy ?? null,
            })),
          )
          .returning()
      : [];
    const linked = versions.length
      ? await db
          .update(agents)
          .set({ currentVersionId: sql`(select ${agentVersions.id} from ${agentVersions} where ${agentVersions.agentId} = ${agents.id} and ${agentVersions.version} = 1)` })
          .where(and(eq(agents.businessId, businessId), inArray(agents.id, withVersion.map((v) => v.id))))
          .returning()
      : [];
    const agentById = new Map([...created, ...linked].map((a) => [a.id, a] as const));
    const versionByAgent = new Map(versions.map((v) => [v.agentId, v] as const));
    return list.map((v) => ({ ...one([agentById.get(v.id)].filter((a): a is Agent => a !== undefined), "agent", v.id), currentVersion: versionByAgent.get(v.id) ?? null }));
  },

  async update(db: Executor, businessId: string, agentId: string, input: UpdateAgentInput): Promise<Agent> {
    const v = parseInput(UpdateAgentInput, input, "agent update");
    return one(await db.update(agents).set(defined(v)).where(scoped(businessId, agentId)).returning(), "agent", agentId);
  },

  /** Sets the status; a pause may say why (0023, `paused_reason`; leaving `paused` drops the reason). */
  async setStatus(db: Executor, businessId: string, agentId: string, status: AgentStatus, options: { pausedReason?: AgentPauseReason | null } = {}): Promise<Agent> {
    const s = parseInput(z.enum(AGENT_STATUSES), status, "agent status");
    const reason = s === "paused" ? parseInput(z.enum(AGENT_PAUSE_REASONS).nullable(), options.pausedReason ?? null, "pause reason") : null;
    return one(await db.update(agents).set({ status: s, pausedReason: reason }).where(scoped(businessId, agentId)).returning(), "agent", agentId);
  },

  /**
   * A computed health status (session end, health refresh) for an agent that is not paused: a pause (the founder's,
   * the kill switch's, credits', a key revoke's, a wage cap's) is never overwritten by a computation. Null when the
   * agent is paused (or gone), so the caller writes no `agent.health_changed`.
   */
  async setHealthStatus(db: Executor, businessId: string, agentId: string, status: Exclude<AgentStatus, "paused">): Promise<Agent | null> {
    const s = parseInput(z.enum(AGENT_STATUSES).exclude(["paused"]), status, "agent status");
    const rows = await db.update(agents).set({ status: s }).where(and(scoped(businessId, agentId), sql`${agents.status} <> 'paused'`)).returning();
    return rows[0] ?? null;
  },

  /** Stop-all: pauses every non-archived agent (with the reason, when given). Returns the number paused. */
  async pauseAll(db: Executor, businessId: string, options: { reason?: AgentPauseReason } = {}): Promise<number> {
    return (await agentsRepo.pauseEveryone(db, businessId, options)).length;
  },

  /**
   * Pauses every live agent that is not paused yet, recording why; returns each with the status it had (for
   * `agent.health_changed`). Agents already paused keep their own reason (a wage cap stays a wage cap).
   */
  async pauseEveryone(db: Executor, businessId: string, options: { reason?: AgentPauseReason } = {}): Promise<{ id: string; from: AgentStatus }[]> {
    const reason = options.reason ? parseInput(z.enum(AGENT_PAUSE_REASONS), options.reason, "pause reason") : null;
    return db.transaction(async (tx) => {
      const before = await tx
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(and(eq(agents.businessId, businessId), isNull(agents.archivedAt), sql`${agents.status} <> 'paused'`))
        .for("update");
      if (before.length === 0) return [];
      await tx.update(agents).set({ status: "paused", pausedReason: reason }).where(and(eq(agents.businessId, businessId), inArray(agents.id, before.map((a) => a.id))));
      return before.map((a) => ({ id: a.id, from: a.status }));
    });
  },

  /**
   * The way back from a team-wide stop: live agents paused by a stop (kill switch, key revoke, credits) or with no
   * recorded reason become idle. A wage-cap pause stays until the agent is under its cap again. Returns the ids.
   */
  async resumeStopped(db: Executor, businessId: string): Promise<string[]> {
    const rows = await db
      .update(agents)
      .set({ status: "idle" })
      .where(and(eq(agents.businessId, businessId), isNull(agents.archivedAt), eq(agents.status, "paused"), sql`(${agents.pausedReason} is null or ${inArray(agents.pausedReason, [...AGENT_STOP_REASONS])})`))
      .returning({ id: agents.id });
    return rows.map((r) => r.id);
  },

  async setModel(db: Executor, businessId: string, agentId: string, modelKey: (typeof MODEL_KEYS)[number]): Promise<Agent> {
    const m = parseInput(z.enum(MODEL_KEYS), modelKey, "model key");
    return one(await db.update(agents).set({ modelKey: m }).where(scoped(businessId, agentId)).returning(), "agent", agentId);
  },

  async setAutonomy(db: Executor, businessId: string, agentId: string, autonomy: Record<string, unknown>): Promise<Agent> {
    return agentsRepo.update(db, businessId, agentId, { autonomy: parseInput(JsonObject, autonomy, "autonomy") });
  },

  async setNegotiation(db: Executor, businessId: string, agentId: string, negotiation: Record<string, unknown>): Promise<Agent> {
    return agentsRepo.update(db, businessId, agentId, { negotiation: parseInput(JsonObject, negotiation, "negotiation") });
  },

  /** Release: archives the agent and pauses it. */
  async release(db: Executor, businessId: string, agentId: string): Promise<Agent> {
    return one(await db.update(agents).set({ archivedAt: new Date(), status: "paused" }).where(scoped(businessId, agentId)).returning(), "agent", agentId);
  },

  /** Clone: a new agent with the same configuration and a copy of the current version as live version 1. */
  async clone(db: Executor, businessId: string, agentId: string, overrides: { name: string; departmentIds?: string[] }): Promise<Agent & { currentVersion: AgentVersion | null }> {
    const o = parseInput(z.object({ name: z.string().trim().min(1).max(80), departmentIds: z.array(Id).optional() }), overrides, "clone");
    return db.transaction(async (tx) => {
      const source = await agentsRepo.get(tx, businessId, agentId);
      const current = source.currentVersionId ? await agentsRepo.getVersion(tx, businessId, source.currentVersionId) : null;
      return agentsRepo.create(tx, businessId, {
        name: o.name,
        role: source.role,
        agentType: source.agentType,
        layer: source.layer,
        descriptionMd: source.descriptionMd,
        departmentIds: o.departmentIds ?? source.departmentIds,
        lineManagerId: source.lineManagerId,
        modelKey: source.modelKey,
        autonomy: source.autonomy,
        negotiation: source.negotiation,
        schedule: source.schedule,
        wageCapMinor: source.wageCapMinor,
        currency: source.currency,
        initialVersion: current ? { instructions: current.instructions as z.input<typeof AgentInstructions>, tools: current.tools, modelKey: current.modelKey, createdByKind: "system" } : undefined,
      });
    });
  },

  // versions ----------------------------------------------------------------------------------------------------------
  async listVersions(db: Executor, businessId: string, agentId: string): Promise<AgentVersion[]> {
    return db.select().from(agentVersions).where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.agentId, agentId))).orderBy(desc(agentVersions.version));
  },

  async getVersion(db: Executor, businessId: string, versionId: string): Promise<AgentVersion> {
    return one(await db.select().from(agentVersions).where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.id, versionId))).limit(1), "agent version", versionId);
  },

  /** Saves a draft (or live) version numbered max + 1. */
  async createVersion(db: Executor, businessId: string, agentId: string, input: CreateAgentVersionInput): Promise<AgentVersion> {
    const v = parseInput(CreateAgentVersionInput, input, "agent version");
    return db.transaction(async (tx) => {
      const agent = await agentsRepo.get(tx, businessId, agentId);
      const next = one(await tx.select({ n: sql<number>`coalesce(max(${agentVersions.version}), 0) + 1` }).from(agentVersions).where(eq(agentVersions.agentId, agentId)), "version");
      const version = one(
        await tx
          .insert(agentVersions)
          .values({ businessId, agentId, version: Number(next.n), instructions: v.instructions, tools: v.tools, modelKey: v.modelKey ?? agent.modelKey, state: v.state, createdByKind: v.createdByKind, createdBy: v.createdBy ?? null })
          .returning(),
        "agent version",
      );
      if (v.state === "live") await agentsRepo.promoteVersion(tx, businessId, agentId, version.id);
      return version;
    });
  },

  /** Promotes a version to live: retires the previous live version and points the agent at the new one. */
  async promoteVersion(db: Executor, businessId: string, agentId: string, versionId: string): Promise<Agent> {
    return db.transaction(async (tx) => {
      const version = await agentsRepo.getVersion(tx, businessId, versionId);
      if (version.agentId !== agentId) throw new ValidationError("Version belongs to another agent", { versionId, agentId });
      await tx
        .update(agentVersions)
        .set({ state: "retired" })
        .where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.agentId, agentId), eq(agentVersions.state, "live"), sql`${agentVersions.id} <> ${versionId}::uuid`));
      await tx.update(agentVersions).set({ state: "live" }).where(eq(agentVersions.id, versionId));
      return one(await tx.update(agents).set({ currentVersionId: versionId, modelKey: version.modelKey }).where(scoped(businessId, agentId)).returning(), "agent", agentId);
    });
  },

  /** Rollback: promotes an earlier (retired) version again. */
  async rollback(db: Executor, businessId: string, agentId: string, versionId: string): Promise<Agent> {
    return agentsRepo.promoteVersion(db, businessId, agentId, versionId);
  },

  // sessions ----------------------------------------------------------------------------------------------------------
  async listSessions(db: Executor, businessId: string, filter: { agentId?: string; taskId?: string; openOnly?: boolean } & PageInput = {}): Promise<Page<AgentSession>> {
    const p = parseInput(PageInput, filter, "page");
    const ks = timeKeyset<AgentSession>(agentSessions.startedAt, agentSessions.id, (r) => ({ at: r.startedAt, id: r.id }));
    const rows = await db
      .select()
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.businessId, businessId),
          filter.agentId ? eq(agentSessions.agentId, filter.agentId) : undefined,
          filter.taskId ? eq(agentSessions.taskId, filter.taskId) : undefined,
          filter.openOnly ? isNull(agentSessions.endedAt) : undefined,
          ks.after(p.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async getSession(db: Executor, businessId: string, sessionId: string): Promise<AgentSession> {
    return one(await db.select().from(agentSessions).where(and(eq(agentSessions.businessId, businessId), eq(agentSessions.id, sessionId))).limit(1), "agent session", sessionId);
  },

  /**
   * The module keys of the department a session's work is filed under: its task's department, else the agent's own
   * departments. With Development they are the sections its live output belongs to (`sessionSections` in
   * @foundmill/shared; dev.sessions.* in apps/api and `as:<sessionId>` in apps/stream read them).
   */
  async sessionModuleKeys(db: Executor, businessId: string, session: Pick<AgentSession, "agentId" | "taskId">): Promise<string[]> {
    const [task] = session.taskId ? await db.select({ departmentId: tasks.departmentId }).from(tasks).where(and(eq(tasks.businessId, businessId), eq(tasks.id, session.taskId))).limit(1) : [];
    let departmentIds: string[] = task?.departmentId ? [task.departmentId] : [];
    if (departmentIds.length === 0) {
      const [agent] = await db.select({ departmentIds: agents.departmentIds }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, session.agentId))).limit(1);
      departmentIds = agent?.departmentIds ?? [];
    }
    if (departmentIds.length === 0) return [];
    const rows = await db.select({ moduleKeys: departments.moduleKeys }).from(departments).where(and(eq(departments.businessId, businessId), inArray(departments.id, departmentIds)));
    return [...new Set(rows.flatMap((r) => r.moduleKeys))].sort();
  },

  /** Opens a session row; its workflow id is `session:<id>` from the start (`sessionWorkflowId`). */
  async createSession(db: Executor, businessId: string, input: CreateSessionInput): Promise<AgentSession> {
    const v = parseInput(CreateSessionInput, input, "agent session");
    await agentsRepo.get(db, businessId, v.agentId);
    const id = v.id ?? uuid();
    return one(
      await db
        .insert(agentSessions)
        .values({ id, businessId, agentId: v.agentId, versionId: v.versionId ?? null, taskId: v.taskId ?? null, workflowId: sessionWorkflowId(id), modelKey: v.modelKey, startedAt: v.startedAt ?? new Date(), recordingRef: v.recordingRef ?? null })
        .returning(),
      "agent session",
    );
  },

  /**
   * The latest ended sessions of some tasks or agents, newest first (outcome and end time only): the cycle reads how
   * many times in a row a task or an agent failed, to back off before trying again.
   */
  async recentOutcomes(db: Executor, businessId: string, filter: { taskIds?: readonly string[]; agentIds?: readonly string[]; limit?: number }): Promise<Pick<AgentSession, "id" | "agentId" | "taskId" | "outcome" | "startedAt" | "endedAt">[]> {
    if ((filter.taskIds && filter.taskIds.length === 0) || (filter.agentIds && filter.agentIds.length === 0)) return [];
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 500), 1), 2000);
    return db
      .select({ id: agentSessions.id, agentId: agentSessions.agentId, taskId: agentSessions.taskId, outcome: agentSessions.outcome, startedAt: agentSessions.startedAt, endedAt: agentSessions.endedAt })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.businessId, businessId),
          sql`${agentSessions.endedAt} is not null`,
          filter.taskIds ? inArray(agentSessions.taskId, [...filter.taskIds]) : undefined,
          filter.agentIds ? inArray(agentSessions.agentId, [...filter.agentIds]) : undefined,
        ),
      )
      .orderBy(desc(agentSessions.startedAt), desc(agentSessions.id))
      .limit(limit);
  },

  async endSession(db: Executor, businessId: string, sessionId: string, input: EndSessionInput): Promise<AgentSession> {
    const v = parseInput(EndSessionInput, input, "session end");
    return one(
      await db
        .update(agentSessions)
        .set({ ...defined(v), endedAt: v.endedAt ?? new Date() })
        .where(and(eq(agentSessions.businessId, businessId), eq(agentSessions.id, sessionId)))
        .returning(),
      "agent session",
      sessionId,
    );
  },

  // metrics -----------------------------------------------------------------------------------------------------------
  async metrics(db: Executor, businessId: string, agentId: string, range: DayRange = {}): Promise<AgentMetric[]> {
    const r = parseInput(DayRange, range, "day range");
    return db
      .select()
      .from(agentMetrics)
      .where(and(eq(agentMetrics.businessId, businessId), eq(agentMetrics.agentId, agentId), dayRange(agentMetrics.day, r)))
      .orderBy(asc(agentMetrics.day));
  },

  async upsertMetric(db: Executor, businessId: string, input: UpsertMetricInput): Promise<AgentMetric> {
    const v = parseInput(UpsertMetricInput, input, "agent metric");
    const values = {
      businessId,
      agentId: v.agentId,
      day: v.day,
      tasksDone: v.tasksDone,
      successRate: numericText(v.successRate) ?? null,
      reviewFindings: v.reviewFindings,
      approvalsRejected: v.approvalsRejected,
      ratingAvg: numericText(v.ratingAvg) ?? null,
      costMinor: v.costMinor,
    };
    return one(
      await db
        .insert(agentMetrics)
        .values(values)
        .onConflictDoUpdate({ target: [agentMetrics.agentId, agentMetrics.day], set: values, setWhere: eq(agentMetrics.businessId, businessId) })
        .returning(),
      "agent metric",
    );
  },

  /** Health roll-up for the Team › Health tab: counts per status. */
  async countByStatus(db: Executor, businessId: string): Promise<Record<AgentStatus, number>> {
    const rows = await db
      .select({ status: agents.status, n: sql<number>`count(*)::int` })
      .from(agents)
      .where(and(eq(agents.businessId, businessId), isNull(agents.archivedAt)))
      .groupBy(agents.status);
    const out = Object.fromEntries(AGENT_STATUSES.map((s) => [s, 0])) as Record<AgentStatus, number>;
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  },
};
