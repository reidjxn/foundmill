/**
 * agents, agent_versions, agent_sessions, agent_metrics — the squad (BUILD §9.1–9.2, §11.9, §11.10;
 * routers team.agents.*, agent.profile.*, agent.model.*, agent.autonomy.*, dev.sessions.*).
 */
import { AGENT_LAYERS, AGENT_PAUSE_REASONS, AGENT_STATUSES, AGENT_STOP_REASONS, AGENT_VERSION_STATES, MODEL_KEYS, personaByKey, pickPersonaKeys, uuid, ValidationError, type AgentPauseReason, type AgentStatus } from "@foundmill/shared";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { agentMetrics, agentSessions, agentVersions, agents, businesses, CREATED_BY_KINDS, departments, tasks, type Agent, type AgentMetric, type AgentSession, type AgentVersion } from "../schema";
import { assertAgentsOwned, assertDepartmentsOwned } from "./_refs";
import { Currency, DayRange, dayRange, changes, defined, Id, JsonArray, JsonObject, MinorAmount, numericText, one, PageInput, parseInput, rowsOf, timeKeyset, toPage, type Executor, type Page, patchSchema } from "./_shared";

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
  /**
   * The persona (anthropomorphic agents, 0067): a key of `PERSONAS` in @foundmill/shared. Leave it out and the repo
   * picks one (`assignPersonaKeys`): unique within the business, avoiding the owner's other businesses' keys.
   */
  personaKey: z.string().refine((k) => personaByKey(k) !== null, "not a persona catalog key").optional(),
  /** When given, version 1 is created `live` with these instructions/tools and becomes current. */
  initialVersion: CreateAgentVersionInput.omit({ state: true }).optional(),
});
export type CreateAgentInput = z.input<typeof CreateAgentInput>;

/** The persona key is given once at hire and never changes (a rename keeps it), so an update cannot carry one. */
export const UpdateAgentInput = patchSchema(CreateAgentInput.omit({ initialVersion: true, agentType: true, status: true, personaKey: true }));
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

/**
 * How an ended session counts in an agent's form: done (or a seeded `completed`) is a success, blocked a partial, failed
 * a failure. Stopped and handed-over sessions did not end on their merits and do not count.
 */
export const SESSION_FORM_OUTCOMES: ReadonlyMap<string, "success" | "partial" | "failure"> = new Map([
  ["done", "success"],
  ["completed", "success"],
  ["blocked", "partial"],
  ["failed", "failure"],
  ["failure", "failure"],
]);

/** `rosterActivity` per agent. */
export interface AgentRosterActivity {
  /** Last five outcomes, oldest first. */
  form: ("success" | "partial" | "failure")[];
  /** The open session, else the one that ended last, with its task's title. */
  latest: { open: boolean; outcome: string | null; startedAt: Date; endedAt: Date | null; taskId: string | null; taskTitle: string | null } | null;
  /** An open session's last sign of life (its task moved), else when the last session ended. */
  lastActivityAt: Date | null;
  /** Sessions that ended in the last 24 hours (stopped ones aside), and how many of them failed. */
  sessions24h: number;
  failed24h: number;
}

/** `dailyActivity` per UTC day (cost in US cents, an Estimate). */
export interface AgentDailyActivity {
  day: string;
  tasksDone: number;
  /** Sessions that ended on their merits (stopped and handed-over ones aside). */
  sessions: number;
  failed: number;
  costMinor: number;
  approvalsRejected: number;
}

/** What department.list shows of an agent: the lead and the team strip. */
export type AgentRosterRow = Pick<Agent, "id" | "name" | "role" | "status" | "modelKey" | "avatarSeed" | "departmentIds" | "personaKey" | "layer" | "agentType">;

const scoped = (businessId: string, agentId: string) => and(eq(agents.businessId, businessId), eq(agents.id, agentId));

/**
 * The status a new agent starts with. While the team is stopped (0023: Stop all agents, a revoked key, used-up credits)
 * it starts paused with the stop's reason, like every agent `stopBusinessAgents` paused: a hire, a clone or a plan's
 * hire during a stop never adds an agent that can work, and Resume agents brings it back with the others.
 */
async function startingStatus(db: Executor, businessId: string, requested: AgentStatus): Promise<{ status: AgentStatus; pausedReason: AgentPauseReason | null }> {
  const rows = await db.select({ stoppedAt: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const stop = rows[0];
  if (!stop?.stoppedAt) return { status: requested, pausedReason: null };
  return { status: "paused", pausedReason: stop.reason ?? "kill_switch" };
}

/**
 * Serializes persona assignment per business until the transaction ends, so two hires at once (a double click, a plan
 * hiring while the founder hires) read each other's keys instead of picking the same one.
 */
async function lockPersonas(db: Executor, businessId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('agents_persona'), hashtext(${businessId}::uuid::text))`);
}

/**
 * What persona assignment must respect for one business, in one statement: `taken`, every key the business's agents
 * hold (archived ones too, so a released agent's face never comes back as someone else), `live`, the keys its live
 * (not released) agents hold, and `avoid`, the keys live agents hold in the other businesses owned by this business's
 * owners (membership role owner), so one founder's businesses greet them with different names while the catalog allows.
 */
export async function personaContext(db: Executor, businessId: string): Promise<{ taken: string[]; live: string[]; avoid: string[] }> {
  const rows = rowsOf<{ kind: "taken" | "live" | "avoid"; key: string }>(
    await db.execute(sql`
      select 'taken' as kind, a.persona_key as key from agents a
       where a.business_id = ${businessId}::uuid and a.persona_key is not null
      union
      select 'live' as kind, a.persona_key as key from agents a
       where a.business_id = ${businessId}::uuid and a.persona_key is not null and a.archived_at is null
      union
      select 'avoid' as kind, a.persona_key as key from agents a
       where a.persona_key is not null and a.archived_at is null and a.business_id <> ${businessId}::uuid
         and a.business_id in (
           select o.business_id from memberships o
            where o.role in ('owner', 'cofounder')
              and o.user_id in (select m.user_id from memberships m where m.business_id = ${businessId}::uuid and m.role in ('owner', 'cofounder')))`),
  );
  const of = (kind: "taken" | "live" | "avoid") => rows.filter((r) => r.kind === kind).map((r) => r.key);
  return { taken: of("taken"), live: of("live"), avoid: of("avoid") };
}

/**
 * Persona keys for new agents of one business: a key the caller asks for is kept unless a live agent of the business
 * already holds it (or an earlier agent of the same call asked for it), in which case it is replaced like a missing one;
 * the rest are picked with `pickPersonaKeys` seeded by the business id (so the same business and history always pick the
 * same keys). Takes the business's persona lock; call inside a transaction so the lock holds until the agents are inserted.
 */
export async function assignPersonaKeys(db: Executor, businessId: string, requested: readonly (string | null | undefined)[]): Promise<string[]> {
  if (requested.length === 0) return [];
  await lockPersonas(db, businessId);
  const ctx = await personaContext(db, businessId);
  const held = new Set(ctx.live);
  const kept = requested.map((k) => {
    if (typeof k !== "string" || held.has(k)) return null;
    held.add(k);
    return k;
  });
  const given = kept.filter((k): k is string => k !== null);
  const picked = pickPersonaKeys(kept.length - given.length, { seed: businessId, taken: [...ctx.taken, ...given], avoid: ctx.avoid });
  let next = 0;
  return kept.map((k) => k ?? picked[next++]!);
}

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
      .select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status, modelKey: agents.modelKey, avatarSeed: agents.avatarSeed, departmentIds: agents.departmentIds, personaKey: agents.personaKey, layer: agents.layer, agentType: agents.agentType })
      .from(agents)
      .where(and(eq(agents.businessId, businessId), isNull(agents.archivedAt)))
      .orderBy(...ks.orderBy)
      .limit(limit);
  },

  async get(db: Executor, businessId: string, agentId: string): Promise<Agent> {
    return one(await db.select().from(agents).where(scoped(businessId, agentId)).limit(1), "agent", agentId);
  },

  /**
   * The agent's row, locked until the caller's transaction ends (`SELECT … FOR UPDATE`): a check over the agent's
   * other rows (its skills' limits) then sees every write made before it, and a second writer waits. 404 outside the business.
   */
  async lockForUpdate(tx: Executor, businessId: string, agentId: string): Promise<Agent> {
    return one(await tx.select().from(agents).where(scoped(businessId, agentId)).limit(1).for("update"), "agent", agentId);
  },

  /** Records the release of role defaults these agents were given (0143); never lowers it. */
  async setDefaultSkillsVersion(db: Executor, businessId: string, agentIds: readonly string[], version: number): Promise<void> {
    if (agentIds.length === 0) return;
    await db
      .update(agents)
      .set({ defaultSkillsVersion: version })
      .where(and(eq(agents.businessId, businessId), inArray(agents.id, [...agentIds]), sql`${agents.defaultSkillsVersion} < ${version}`));
  },

  /** Businesses with a live agent on an older release of role defaults than `version` (the boot backfill, 0143). */
  async businessesBehindOnDefaults(db: Executor, version: number): Promise<string[]> {
    const rows = await db
      .selectDistinct({ businessId: agents.businessId })
      .from(agents)
      .where(and(isNull(agents.archivedAt), sql`${agents.defaultSkillsVersion} < ${version}`))
      .orderBy(asc(agents.businessId));
    return rows.map((r) => r.businessId);
  },

  /** Locks and returns the business's live agents on an older release of role defaults than `version` (0143). */
  async lockBehindOnDefaults(tx: Executor, businessId: string, version: number): Promise<Pick<Agent, "id" | "agentType" | "defaultSkillsVersion">[]> {
    // A boot job: never wait long on a lock another transaction holds (that business is tried again next boot).
    await tx.execute(sql`set local lock_timeout = '5s'`);
    return tx
      .select({ id: agents.id, agentType: agents.agentType, defaultSkillsVersion: agents.defaultSkillsVersion })
      .from(agents)
      .where(and(eq(agents.businessId, businessId), isNull(agents.archivedAt), sql`${agents.defaultSkillsVersion} < ${version}`))
      .orderBy(asc(agents.createdAt))
      .for("update");
  },

  /** Agents by ids (only those in the business). */
  async byIds(db: Executor, businessId: string, ids: readonly string[]): Promise<Agent[]> {
    if (ids.length === 0) return [];
    return db.select().from(agents).where(and(eq(agents.businessId, businessId), inArray(agents.id, [...ids])));
  },

  /**
   * agent id → persona key (null until the boot backfill gave it one) for the agents among `ids` that belong to the
   * business (archived ones too); another business's agent is simply absent. One projected statement (crm.entity.lookup
   * marks agent records with the face to show).
   */
  async personaKeysByIds(db: Executor, businessId: string, ids: readonly string[]): Promise<Map<string, string | null>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();
    const rows = await db.select({ id: agents.id, personaKey: agents.personaKey }).from(agents).where(and(eq(agents.businessId, businessId), inArray(agents.id, wanted)));
    return new Map(rows.map((r) => [r.id, r.personaKey] as const));
  },

  /** The business's Chief of Staff (assistant layer), or null before hiring. */
  async chiefOfStaff(db: Executor, businessId: string): Promise<Agent | null> {
    const rows = await db.select().from(agents).where(and(eq(agents.businessId, businessId), eq(agents.layer, "assistant"), isNull(agents.archivedAt))).orderBy(asc(agents.createdAt), asc(agents.id)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Hire: inserts the agent (+ optional live version 1) in one transaction. While the team is stopped the agent starts
   * paused (`startingStatus`), whatever status was asked for.
   */
  async create(db: Executor, businessId: string, input: CreateAgentInput): Promise<Agent & { currentVersion: AgentVersion | null }> {
    const v = parseInput(CreateAgentInput, input, "agent");
    return db.transaction(async (tx) => {
      await assertDepartmentsOwned(tx, businessId, v.departmentIds, "departmentIds");
      await assertAgentsOwned(tx, businessId, [v.lineManagerId], "lineManagerId");
      const start = await startingStatus(tx, businessId, v.status);
      const [personaKey] = await assignPersonaKeys(tx, businessId, [v.personaKey]);
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
            status: start.status,
            pausedReason: start.pausedReason,
            autonomy: v.autonomy,
            negotiation: v.negotiation,
            schedule: v.schedule,
            wageCapMinor: v.wageCapMinor ?? null,
            ...(v.currency ? { currency: v.currency } : {}),
            avatarSeed: v.avatarSeed ?? `${v.agentType}:${v.name}`,
            personaKey: personaKey ?? null,
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
   * however large the team (commit hires about 26), plus the read of the stop flag and the persona keys (taken under the
   * business's persona lock, `assignPersonaKeys`). Results come back in the order given.
   */
  async createMany(db: Executor, businessId: string, inputs: (CreateAgentInput & { id: string })[]): Promise<(Agent & { currentVersion: AgentVersion | null })[]> {
    if (inputs.length === 0) return [];
    const parsed = inputs.map((i) => ({ ...parseInput(CreateAgentInput, i, "agent"), id: parseInput(Id, i.id, "agent id") }));
    // One transaction (a savepoint inside the caller's) so the persona lock holds until the agents are in.
    return db.transaction(async (tx) => {
      const personaKeys = await assignPersonaKeys(tx, businessId, parsed.map((v) => v.personaKey));
      const list = parsed.map((v, i) => ({ ...v, personaKey: personaKeys[i]! }));
      const stopped = await startingStatus(tx, businessId, "idle");
      const created = await tx
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
            ...(stopped.status === "paused" ? stopped : { status: v.status }),
            autonomy: v.autonomy,
            negotiation: v.negotiation,
            schedule: v.schedule,
            wageCapMinor: v.wageCapMinor ?? null,
            ...(v.currency ? { currency: v.currency } : {}),
            avatarSeed: v.avatarSeed ?? `${v.agentType}:${v.name}`,
            personaKey: v.personaKey,
          })),
        )
        .returning();
      const withVersion = list.filter((v) => v.initialVersion);
      const versions = withVersion.length
        ? await tx
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
        ? await tx
            .update(agents)
            .set({ currentVersionId: sql`(select ${agentVersions.id} from ${agentVersions} where ${agentVersions.agentId} = ${agents.id} and ${agentVersions.version} = 1)` })
            .where(and(eq(agents.businessId, businessId), inArray(agents.id, withVersion.map((v) => v.id))))
            .returning()
        : [];
      const agentById = new Map([...created, ...linked].map((a) => [a.id, a] as const));
      const versionByAgent = new Map(versions.map((v) => [v.agentId, v] as const));
      return list.map((v) => ({ ...one([agentById.get(v.id)].filter((a): a is Agent => a !== undefined), "agent", v.id), currentVersion: versionByAgent.get(v.id) ?? null }));
    });
  },

  /**
   * Gives a persona key to every agent of the business that has none (agents hired before 0067), oldest first, with
   * the same rules as a hire. Idempotent: agents that have a key keep it, so a second run changes nothing. Returns the
   * number of agents given a key.
   */
  async assignMissingPersonas(db: Executor, businessId: string): Promise<number> {
    return db.transaction(async (tx) => {
      await lockPersonas(tx, businessId);
      const missing = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.businessId, businessId), isNull(agents.personaKey)))
        .orderBy(asc(agents.createdAt), asc(agents.id));
      if (missing.length === 0) return 0;
      const keys = await assignPersonaKeys(tx, businessId, missing.map(() => null));
      const values = sql.join(missing.map((a, i) => sql`(${a.id}::uuid, ${keys[i]!}::text)`), sql`, `);
      const updated = await tx.execute(sql`
        update agents set persona_key = v.key from (values ${values}) as v(id, key)
         where agents.id = v.id and agents.business_id = ${businessId}::uuid and agents.persona_key is null
        returning agents.id`);
      return rowsOf(updated).length;
    });
  },

  /**
   * The boot backfill (apps/api, after migrations): `assignMissingPersonas` for every business with an agent that has
   * no persona key, one business at a time in id order. Idempotent; a business that fails is reported in `failed` and
   * the others still run. Service connection only (it reads every business).
   */
  async backfillPersonas(db: Executor): Promise<{ businesses: number; agents: number; failed: { businessId: string; error: string }[] }> {
    const pending = rowsOf<{ business_id: string }>(await db.execute(sql`select distinct business_id from agents where persona_key is null order by business_id`));
    let assigned = 0;
    const failed: { businessId: string; error: string }[] = [];
    for (const { business_id: businessId } of pending) {
      try {
        assigned += await agentsRepo.assignMissingPersonas(db, businessId);
      } catch (err) {
        failed.push({ businessId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { businesses: pending.length - failed.length, agents: assigned, failed };
  },

  async update(db: Executor, businessId: string, agentId: string, input: UpdateAgentInput): Promise<Agent> {
    const v = parseInput(UpdateAgentInput, input, "agent update");
    // A reference field must name this business's own rows: the foreign keys do not know about tenants (audit RA-07).
    if (v.departmentIds) await assertDepartmentsOwned(db, businessId, v.departmentIds, "departmentIds");
    if (v.lineManagerId) await agentsRepo.assertLineManager(db, businessId, agentId, v.lineManagerId);
    return one(await db.update(agents).set(changes(v, "agent")).where(scoped(businessId, agentId)).returning(), "agent", agentId);
  },

  /**
   * A line manager must be another agent of the same business that is still on the team, and must not report (at any
   * depth) to the agent itself, so the hierarchy stays a tree.
   */
  async assertLineManager(db: Executor, businessId: string, agentId: string, managerId: string): Promise<void> {
    if (managerId === agentId) throw new ValidationError("An agent cannot be its own line manager");
    // A reference field names this business's own rows: another tenant's agent is a 400, not a 404 (audit RA-07).
    await assertAgentsOwned(db, businessId, [managerId], "lineManagerId");
    const manager = await agentsRepo.get(db, businessId, managerId);
    if (manager.archivedAt) throw new ValidationError(`${manager.name} has left the team and cannot be a line manager`);
    const chain = rowsOf<{ id: string }>(
      await db.execute(sql`
        with recursive up(id, line_manager_id, depth) as (
          select id, line_manager_id, 0 from agents where business_id = ${businessId}::uuid and id = ${managerId}::uuid
          union all
          select a.id, a.line_manager_id, up.depth + 1 from agents a join up on a.id = up.line_manager_id
          where a.business_id = ${businessId}::uuid and up.depth < 64
        )
        select id from up where id = ${agentId}::uuid limit 1`),
    );
    if (chain.length > 0) throw new ValidationError(`${manager.name} reports to this agent, so it cannot be its line manager`);
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

  /**
   * 0082 — the founder's own choice of how the agent sounds on a Team call (a `SPEECH_ACCENTS` key; the api checks the
   * key is known, this checks its shape), or null to go back to the derived default (`defaultSpeechAccents`). Only an
   * owner or an admin may change it under RLS (trigger `fm_agents_speech_accent_guard`).
   */
  async setSpeechAccent(db: Executor, businessId: string, agentId: string, key: string | null): Promise<Agent> {
    const k = parseInput(z.string().regex(/^[a-z]{2,20}$/, "a speech accent key is 2 to 20 lowercase letters").nullable(), key, "speech accent");
    return one(await db.update(agents).set({ speechAccent: k }).where(scoped(businessId, agentId)).returning(), "agent", agentId);
  },

  async setAutonomy(db: Executor, businessId: string, agentId: string, autonomy: Record<string, unknown>): Promise<Agent> {
    return agentsRepo.update(db, businessId, agentId, { autonomy: parseInput(JsonObject, autonomy, "autonomy") });
  },

  async setNegotiation(db: Executor, businessId: string, agentId: string, negotiation: Record<string, unknown>): Promise<Agent> {
    return agentsRepo.update(db, businessId, agentId, { negotiation: parseInput(JsonObject, negotiation, "negotiation") });
  },

  /**
   * Release: archives the agent and pauses it, and leaves no pointer at it behind: a department it led has no lead
   * until the founder picks one, and the agents that reported to it report to its own line manager (the founder when
   * it had none). Its open tasks are handed back by `tasks.handBack`. An agent already released is returned as it is.
   */
  async release(db: Executor, businessId: string, agentId: string): Promise<Agent> {
    return db.transaction(async (tx) => {
      const agent = one(await tx.select().from(agents).where(scoped(businessId, agentId)).limit(1).for("update"), "agent", agentId);
      if (agent.archivedAt) return agent;
      await tx.update(departments).set({ leadAgentId: null }).where(and(eq(departments.businessId, businessId), eq(departments.leadAgentId, agentId)));
      await tx.update(agents).set({ lineManagerId: agent.lineManagerId }).where(and(eq(agents.businessId, businessId), eq(agents.lineManagerId, agentId)));
      return one(await tx.update(agents).set({ archivedAt: new Date(), status: "paused", pausedReason: null }).where(scoped(businessId, agentId)).returning(), "agent", agentId);
    });
  },

  /**
   * Clone: a new agent with the same configuration and a copy of the current version as live version 1. It gets a
   * persona of its own (the source's key is taken), never the source's.
   */
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
        // Sessions read a system-written version 1 as "follow the template" (apps/orchestrator `followsTemplate`), so the
        // copy is written by the system only when the source's live version follows its template too. Otherwise it is
        // the user's, and the clone keeps the tools and instructions the source runs with (narrowed grants included).
        initialVersion: current ? { instructions: current.instructions as z.input<typeof AgentInstructions>, tools: current.tools, modelKey: current.modelKey, createdByKind: current.version === 1 && current.createdByKind === "system" ? "system" : "user" } : undefined,
      });
    });
  },

  // versions ----------------------------------------------------------------------------------------------------------
  async listVersions(db: Executor, businessId: string, agentId: string): Promise<AgentVersion[]> {
    return db.select().from(agentVersions).where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.agentId, agentId))).orderBy(desc(agentVersions.version));
  },

  /** Versions by ids (only those in the business), in one statement: the team table's live tool grants. */
  async versionsByIds(db: Executor, businessId: string, versionIds: readonly string[]): Promise<AgentVersion[]> {
    if (versionIds.length === 0) return [];
    return db.select().from(agentVersions).where(and(eq(agentVersions.businessId, businessId), inArray(agentVersions.id, [...versionIds])));
  },

  async getVersion(db: Executor, businessId: string, versionId: string): Promise<AgentVersion> {
    return one(await db.select().from(agentVersions).where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.id, versionId))).limit(1), "agent version", versionId);
  },

  /**
   * Saves a draft (or live) version numbered max + 1. The agent's row is locked first, so two saves at once (a double
   * click, two tabs) number their versions one after the other instead of colliding on the same number.
   */
  async createVersion(db: Executor, businessId: string, agentId: string, input: CreateAgentVersionInput): Promise<AgentVersion> {
    const v = parseInput(CreateAgentVersionInput, input, "agent version");
    return db.transaction(async (tx) => {
      // One numbering at a time per agent (a founder's Save draft and the coach's draft can land together): the second
      // waits here and reads the first one's number, instead of failing on the unique (agent_id, version) index.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agent_versions'), hashtext(${agentId}::text))`);
      const agent = one(await tx.select().from(agents).where(scoped(businessId, agentId)).limit(1).for("update"), "agent", agentId);
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

  /**
   * Promotes a version to live: retires the previous live version and points the agent at the new one. The agent also
   * takes the model the version carries (a rollback to an earlier version brings its model back, a model change's retest
   * copy makes the new model live), unless `keepAgentModel`: the agent keeps running on the model it runs now. A draft
   * keeps the model it was saved with, which can be one the agent has since moved off; promoting it must not move the
   * agent back (`trainingRepo.decide` keeps the model for every draft but a retest copy).
   */
  async promoteVersion(db: Executor, businessId: string, agentId: string, versionId: string, options: { keepAgentModel?: boolean } = {}): Promise<Agent> {
    return db.transaction(async (tx) => {
      const version = await agentsRepo.getVersion(tx, businessId, versionId);
      if (version.agentId !== agentId) throw new ValidationError("Version belongs to another agent", { versionId, agentId });
      await tx
        .update(agentVersions)
        .set({ state: "retired" })
        .where(and(eq(agentVersions.businessId, businessId), eq(agentVersions.agentId, agentId), eq(agentVersions.state, "live"), sql`${agentVersions.id} <> ${versionId}::uuid`));
      await tx.update(agentVersions).set({ state: "live" }).where(eq(agentVersions.id, versionId));
      return one(await tx.update(agents).set({ currentVersionId: versionId, ...(options.keepAgentModel ? {} : { modelKey: version.modelKey }) }).where(scoped(businessId, agentId)).returning(), "agent", agentId);
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

  /**
   * What the Team table and Health board show of each agent's sessions, from `agent_sessions` (and the session's task),
   * in three statements whatever the team size: its form (the last five sessions that ended on their merits, oldest
   * first), its latest session with the task's title (the latest update), its last sign of life (an open session's
   * task moving, else the last session's end) and its sessions over the last 24 hours (the error rate).
   */
  async rosterActivity(db: Executor, businessId: string, agentIds: readonly string[], options: { now?: Date } = {}): Promise<Map<string, AgentRosterActivity>> {
    const out = new Map<string, AgentRosterActivity>();
    if (agentIds.length === 0) return out;
    const ids = parseInput(z.array(Id), [...agentIds], "agent ids");
    const since = new Date((options.now ?? new Date()).getTime() - 86_400_000);
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    // The three statements go out together (one round trip on a pipelining driver), whatever the team size.
    const [formRes, latestRes, dayRes] = await Promise.all([
      db.execute(sql`
        select agent_id, outcome from (
          select s.agent_id, s.outcome, s.ended_at, s.id, row_number() over (partition by s.agent_id order by s.ended_at desc, s.id desc) as rn
          from agent_sessions s
          where s.business_id = ${businessId}::uuid and s.agent_id in (${idList}) and s.ended_at is not null and s.outcome in (${sql.join([...SESSION_FORM_OUTCOMES.keys()].map((o) => sql`${o}`), sql`, `)})
        ) f where rn <= 5 order by agent_id, ended_at asc, id asc`),
      db.execute(sql`
        select distinct on (s.agent_id) s.agent_id, s.outcome, s.started_at, s.ended_at, s.task_id, t.title as task_title, t.updated_at as task_updated_at
        from agent_sessions s left join tasks t on t.id = s.task_id and t.business_id = s.business_id
        where s.business_id = ${businessId}::uuid and s.agent_id in (${idList})
        order by s.agent_id, (s.ended_at is null) desc, coalesce(s.ended_at, s.started_at) desc, s.id desc`),
      db.execute(sql`
        select agent_id, count(*) as ended, count(*) filter (where outcome in ('failed', 'failure')) as failed
        from agent_sessions
        where business_id = ${businessId}::uuid and agent_id in (${idList}) and ended_at is not null and ended_at >= ${since.toISOString()}::timestamptz and outcome is distinct from 'stopped'
        group by agent_id`),
    ]);
    const formRows = rowsOf<{ agent_id: string; outcome: string }>(formRes);
    const latestRows = rowsOf<{ agent_id: string; outcome: string | null; started_at: Date | string; ended_at: Date | string | null; task_id: string | null; task_title: string | null; task_updated_at: Date | string | null }>(latestRes);
    const dayRows = rowsOf<{ agent_id: string; ended: number | string; failed: number | string }>(dayRes);
    const at = (d: Date | string | null): Date | null => (d === null ? null : d instanceof Date ? d : new Date(d));
    for (const id of ids) out.set(id, { form: [], latest: null, lastActivityAt: null, sessions24h: 0, failed24h: 0 });
    for (const r of formRows) out.get(r.agent_id)?.form.push(SESSION_FORM_OUTCOMES.get(r.outcome)!);
    for (const r of latestRows) {
      const entry = out.get(r.agent_id);
      if (!entry) continue;
      const startedAt = at(r.started_at)!;
      const endedAt = at(r.ended_at);
      const taskMoved = at(r.task_updated_at);
      entry.latest = { open: endedAt === null, outcome: r.outcome, startedAt, endedAt, taskId: r.task_id, taskTitle: r.task_title };
      entry.lastActivityAt = endedAt ?? (taskMoved && taskMoved > startedAt ? taskMoved : startedAt);
    }
    for (const r of dayRows) {
      const entry = out.get(r.agent_id);
      if (!entry) continue;
      entry.sessions24h = Number(r.ended);
      entry.failed24h = Number(r.failed);
    }
    return out;
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

  /**
   * An agent's activity per UTC day over a range, from the rows themselves (the profile's 30-day strip): sessions that
   * ended on their merits and how many finished their task or failed (`agent_sessions`), its metered cost in US cents
   * (`usage_ledger`, the same source as its wage) and the approvals of its that were rejected. Days with nothing are
   * left out.
   */
  async dailyActivity(db: Executor, businessId: string, agentId: string, range: { from: Date; to: Date }): Promise<AgentDailyActivity[]> {
    const from = range.from.toISOString();
    const to = range.to.toISOString();
    const rows = rowsOf<{ day: string; done: number | string | null; ended: number | string | null; failed: number | string | null; cost: number | string | null; rejected: number | string | null }>(
      await db.execute(sql`
        with s as (
          select to_char(ended_at at time zone 'UTC', 'YYYY-MM-DD') as day,
                 count(*) filter (where outcome in ('done', 'completed')) as done,
                 count(*) as ended,
                 count(*) filter (where outcome in ('failed', 'failure')) as failed
          from agent_sessions
          where business_id = ${businessId}::uuid and agent_id = ${agentId}::uuid and ended_at >= ${from}::timestamptz and ended_at < ${to}::timestamptz
            and outcome is not null and outcome not in ('stopped', 'handed_over')
          group by 1
        ), u as (
          select to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD') as day, sum(cost_minor) as cost
          from usage_ledger
          where business_id = ${businessId}::uuid and agent_id = ${agentId}::uuid and currency = ${CREDITS_CURRENCY} and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz
          group by 1
        ), a as (
          select to_char(resolved_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as rejected
          from approvals
          where business_id = ${businessId}::uuid and agent_id = ${agentId}::uuid and outcome = 'rejected' and resolved_at >= ${from}::timestamptz and resolved_at < ${to}::timestamptz
          group by 1
        ), days as (select day from s union select day from u union select day from a)
        select days.day, s.done, s.ended, s.failed, u.cost, a.rejected
        from days left join s on s.day = days.day left join u on u.day = days.day left join a on a.day = days.day
        order by days.day`),
    );
    return rows.map((r) => ({ day: r.day, tasksDone: Number(r.done ?? 0), sessions: Number(r.ended ?? 0), failed: Number(r.failed ?? 0), costMinor: Number(r.cost ?? 0), approvalsRejected: Number(r.rejected ?? 0) }));
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
