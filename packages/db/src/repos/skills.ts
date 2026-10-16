/** skill_definitions, skill_tests, agent_skills — attribute ratings (BUILD §11.10; routers agent.profile.*). */
import { ADDED_SKILL_SOURCES, SKILL_GROUPS, ValidationError, type AddedSkillSource, type SkillGroup } from "@foundmill/shared";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agentSkills, skillDefinitions, skillTests, type AgentSkill, type SkillDefinition, type SkillTest } from "../schema";
import { Id, JsonObject, numericText, one, parseInput, type Executor } from "./_shared";

export const CreateSkillDefinitionInput = z.object({
  agentType: z.string().trim().min(1).max(80),
  skillKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().default(""),
  group: z.enum(SKILL_GROUPS),
  custom: z.boolean().default(true),
});
export type CreateSkillDefinitionInput = z.input<typeof CreateSkillDefinitionInput>;

export const CreateSkillTestInput = z.object({
  skillDefinitionId: Id,
  task: JsonObject,
  rubric: JsonObject.default({}),
  heldOut: z.boolean().default(false),
  fixturesRef: z.string().max(2048).nullable().optional(),
  /** False for a drafted test that waits for the founder's review (0054); only reviewed tests are scored. */
  reviewed: z.boolean().default(true),
});
export type CreateSkillTestInput = z.input<typeof CreateSkillTestInput>;

export const UpsertAgentSkillInput = z.object({
  skillKey: z.string().trim().min(1).max(80),
  group: z.enum(SKILL_GROUPS),
  tested: z.number().min(0).max(20).nullable().optional(),
  proven: z.number().min(0).max(20).nullable().optional(),
  nLive: z.number().int().min(0).default(0),
  displayed: z.number().int().min(1).max(20).default(1),
  potential: z.number().int().min(1).max(20).default(1),
});
export type UpsertAgentSkillInput = z.input<typeof UpsertAgentSkillInput>;

/**
 * A skill the founder added from the library or a skill file (0061): a business definition for the agent's type with
 * the instructions its prompt carries. The api parses and screens a file before it gets here.
 */
export const CreateAddedSkillInput = z.object({
  agentType: z.string().trim().min(1).max(80),
  skillKey: z.string().trim().min(1).max(80).regex(/^(library|upload)_[a-z0-9_]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1024).default(""),
  group: z.enum(SKILL_GROUPS),
  source: z.enum(ADDED_SKILL_SOURCES),
  instructionsMd: z.string().min(1).max(20_000),
  fileName: z.string().min(1).max(255).nullable().default(null),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
});
export type CreateAddedSkillInput = z.input<typeof CreateAddedSkillInput>;

/** An agent's added skill: its rating row and the definition its prompt reads. */
export interface AddedAgentSkill {
  definitionId: string;
  skillKey: string;
  name: string;
  description: string;
  group: SkillGroup;
  source: AddedSkillSource;
  instructionsMd: string;
  fileName: string | null;
  contentHash: string | null;
  tested: string | null;
  displayed: number;
  potential: number;
  addedAt: Date;
}

/** Held-out tests are redacted to id + count for the Training screen (AC-11.10.2). */
export type RedactedSkillTest = Pick<SkillTest, "id" | "skillDefinitionId" | "heldOut">;

export const skillsRepo = {
  /** Platform definitions (business_id null) plus the business's custom ones, optionally for one agent type. */
  async listDefinitions(db: Executor, businessId: string, filter: { agentType?: string } = {}): Promise<SkillDefinition[]> {
    return db
      .select()
      .from(skillDefinitions)
      .where(
        and(
          or(isNull(skillDefinitions.businessId), eq(skillDefinitions.businessId, businessId)),
          isNull(skillDefinitions.archivedAt),
          filter.agentType ? eq(skillDefinitions.agentType, filter.agentType) : undefined,
        ),
      )
      .orderBy(asc(skillDefinitions.agentType), asc(skillDefinitions.group), asc(skillDefinitions.skillKey));
  },

  async getDefinition(db: Executor, businessId: string, definitionId: string): Promise<SkillDefinition> {
    return one(
      await db
        .select()
        .from(skillDefinitions)
        .where(and(eq(skillDefinitions.id, definitionId), or(isNull(skillDefinitions.businessId), eq(skillDefinitions.businessId, businessId))))
        .limit(1),
      "skill definition",
      definitionId,
    );
  },

  /** A custom (business-owned) skill definition. Platform definitions are seeded, never created here. */
  async createCustomDefinition(db: Executor, businessId: string, input: CreateSkillDefinitionInput): Promise<SkillDefinition> {
    const v = parseInput(CreateSkillDefinitionInput, input, "skill definition");
    return one(
      await db
        .insert(skillDefinitions)
        .values({ businessId, agentType: v.agentType, skillKey: v.skillKey, name: v.name, description: v.description, group: v.group, custom: true })
        .onConflictDoUpdate({
          target: [skillDefinitions.businessId, skillDefinitions.agentType, skillDefinitions.skillKey],
          set: { name: v.name, description: v.description, group: v.group, archivedAt: null },
          targetWhere: sql`${skillDefinitions.businessId} is not null`,
        })
        .returning(),
      "skill definition",
    );
  },

  async archiveDefinition(db: Executor, businessId: string, definitionId: string): Promise<SkillDefinition> {
    return one(
      await db.update(skillDefinitions).set({ archivedAt: new Date() }).where(and(eq(skillDefinitions.businessId, businessId), eq(skillDefinitions.id, definitionId))).returning(),
      "skill definition",
      definitionId,
    );
  },

  /**
   * Discards a custom skill: the definition and every test drafted for it are archived together, so adding a skill of
   * the same name later starts from its own tests only.
   */
  async discardCustom(db: Executor, businessId: string, definitionId: string): Promise<SkillDefinition> {
    return db.transaction(async (tx) => {
      const def = await skillsRepo.getDefinition(tx, businessId, definitionId);
      if (!def.custom || def.businessId !== businessId) throw new ValidationError("Only a custom skill can be discarded", { definitionId });
      const now = new Date();
      await tx.update(skillTests).set({ archivedAt: now }).where(and(eq(skillTests.businessId, businessId), eq(skillTests.skillDefinitionId, definitionId), isNull(skillTests.archivedAt)));
      return skillsRepo.archiveDefinition(tx, businessId, definitionId);
    });
  },

  /** The business's (or the platform's) definition of a skill for an agent type, or null. */
  async findDefinition(db: Executor, businessId: string, agentType: string, skillKey: string): Promise<SkillDefinition | null> {
    const rows = await db
      .select()
      .from(skillDefinitions)
      .where(and(or(isNull(skillDefinitions.businessId), eq(skillDefinitions.businessId, businessId)), eq(skillDefinitions.agentType, agentType), eq(skillDefinitions.skillKey, skillKey), isNull(skillDefinitions.archivedAt)))
      .orderBy(sql`${skillDefinitions.businessId} is null`)
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * The business's custom skills for an agent type with their test counts (live tests only): how many were drafted,
   * how many the founder reviewed and how many of those are held out. A skill with tests and none reviewed is awaiting
   * review.
   */
  async listCustom(db: Executor, businessId: string, agentType: string): Promise<(SkillDefinition & { tests: number; reviewed: number; heldOut: number })[]> {
    const defs = await db
      .select()
      .from(skillDefinitions)
      .where(and(eq(skillDefinitions.businessId, businessId), eq(skillDefinitions.agentType, agentType), eq(skillDefinitions.custom, true), isNull(skillDefinitions.archivedAt)))
      .orderBy(asc(skillDefinitions.createdAt));
    if (defs.length === 0) return [];
    const counts = await db
      .select({ id: skillTests.skillDefinitionId, tests: sql<number>`count(*)::int`, reviewed: sql<number>`count(*) filter (where ${skillTests.reviewedAt} is not null)::int`, heldOut: sql<number>`count(*) filter (where ${skillTests.heldOut} and ${skillTests.reviewedAt} is not null)::int` })
      .from(skillTests)
      .where(and(eq(skillTests.businessId, businessId), inArray(skillTests.skillDefinitionId, defs.map((d) => d.id)), isNull(skillTests.archivedAt)))
      .groupBy(skillTests.skillDefinitionId);
    return defs.map((d) => {
      const c = counts.find((x) => x.id === d.id);
      return { ...d, tests: Number(c?.tests ?? 0), reviewed: Number(c?.reviewed ?? 0), heldOut: Number(c?.heldOut ?? 0) };
    });
  },

  /**
   * The founder's review of a drafted custom skill (BUILD §11.10 "founder reviews before it counts"): the visible
   * tests they keep and every held-out test (never shown, AC-11.10.2) are marked reviewed; the visible ones they drop
   * are archived. Returns how many count now.
   */
  async reviewTests(db: Executor, businessId: string, definitionId: string, keepIds: readonly string[]): Promise<{ reviewed: number; dropped: number }> {
    const keep = parseInput(z.array(Id), [...keepIds], "test ids");
    return db.transaction(async (tx) => {
      const def = await skillsRepo.getDefinition(tx, businessId, definitionId);
      if (!def.custom || def.businessId !== businessId) throw new ValidationError("Only a custom skill's tests are reviewed here", { definitionId });
      const drafted = await tx
        .select({ id: skillTests.id, heldOut: skillTests.heldOut })
        .from(skillTests)
        .where(and(eq(skillTests.businessId, businessId), eq(skillTests.skillDefinitionId, definitionId), isNull(skillTests.archivedAt), isNull(skillTests.reviewedAt)));
      const unknown = keep.filter((id) => !drafted.some((t) => t.id === id && !t.heldOut));
      if (unknown.length) throw new ValidationError("Keep only tests drafted for this skill and waiting for review", { unknown });
      const kept = drafted.filter((t) => t.heldOut || keep.includes(t.id)).map((t) => t.id);
      const dropped = drafted.filter((t) => !kept.includes(t.id)).map((t) => t.id);
      if (!drafted.some((t) => !t.heldOut && keep.includes(t.id))) throw new ValidationError("Keep at least one visible test, or discard the skill");
      const now = new Date();
      if (kept.length) await tx.update(skillTests).set({ reviewedAt: now }).where(and(eq(skillTests.businessId, businessId), inArray(skillTests.id, kept)));
      if (dropped.length) await tx.update(skillTests).set({ archivedAt: now }).where(and(eq(skillTests.businessId, businessId), inArray(skillTests.id, dropped)));
      return { reviewed: kept.length, dropped: dropped.length };
    });
  },

  /** Tests for a definition. Held-out tests come back redacted unless `includeHeldOut` (the training runner); `reviewedOnly` leaves out drafts. */
  async listTests(db: Executor, businessId: string, definitionId: string, options: { includeHeldOut?: boolean; reviewedOnly?: boolean } = {}): Promise<(SkillTest | RedactedSkillTest)[]> {
    await skillsRepo.getDefinition(db, businessId, definitionId);
    const rows = await db
      .select()
      .from(skillTests)
      .where(and(eq(skillTests.skillDefinitionId, definitionId), or(isNull(skillTests.businessId), eq(skillTests.businessId, businessId)), isNull(skillTests.archivedAt), options.reviewedOnly ? isNotNull(skillTests.reviewedAt) : undefined))
      .orderBy(asc(skillTests.createdAt));
    if (options.includeHeldOut) return rows;
    return rows.map((t) => (t.heldOut ? { id: t.id, skillDefinitionId: t.skillDefinitionId, heldOut: true } : t));
  },

  async createTest(db: Executor, businessId: string, input: CreateSkillTestInput): Promise<SkillTest> {
    const v = parseInput(CreateSkillTestInput, input, "skill test");
    const def = await skillsRepo.getDefinition(db, businessId, v.skillDefinitionId);
    return one(
      await db
        .insert(skillTests)
        .values({ businessId: def.businessId === null ? null : businessId, skillDefinitionId: v.skillDefinitionId, task: v.task, rubric: v.rubric, heldOut: v.heldOut, fixturesRef: v.fixturesRef ?? null, reviewedAt: v.reviewed ? new Date() : null })
        .returning(),
      "skill test",
    );
  },

  /**
   * Writes (or refreshes) an added skill's definition for the business and agent type. The same library skill, or the
   * same file (same key: name and content hash), is one definition however many agents of the type carry it.
   */
  async upsertAddedDefinition(db: Executor, businessId: string, input: CreateAddedSkillInput): Promise<SkillDefinition> {
    const v = parseInput(CreateAddedSkillInput, input, "added skill");
    if (v.source === "upload" && (!v.fileName || !v.contentHash)) throw new ValidationError("An uploaded skill keeps its file name and content hash");
    const set = { name: v.name, description: v.description, group: v.group, custom: false, source: v.source, instructionsMd: v.instructionsMd, fileName: v.fileName, contentHash: v.contentHash, archivedAt: null };
    return one(
      await db
        .insert(skillDefinitions)
        .values({ businessId, agentType: v.agentType, skillKey: v.skillKey, ...set })
        .onConflictDoUpdate({ target: [skillDefinitions.businessId, skillDefinitions.agentType, skillDefinitions.skillKey], set, targetWhere: sql`${skillDefinitions.businessId} is not null` })
        .returning(),
      "skill definition",
    );
  },

  /** The library and uploaded skills an agent carries, oldest first, with the instructions its prompt reads. */
  async listAddedForAgent(db: Executor, businessId: string, agentId: string, agentType: string): Promise<AddedAgentSkill[]> {
    const rows = await db
      .select({ skill: agentSkills, def: skillDefinitions })
      .from(agentSkills)
      .innerJoin(
        skillDefinitions,
        and(eq(skillDefinitions.businessId, agentSkills.businessId), eq(skillDefinitions.skillKey, agentSkills.skillKey), eq(skillDefinitions.agentType, agentType), isNotNull(skillDefinitions.source), isNull(skillDefinitions.archivedAt)),
      )
      .where(and(eq(agentSkills.businessId, businessId), eq(agentSkills.agentId, agentId)))
      .orderBy(asc(agentSkills.createdAt), asc(agentSkills.skillKey));
    return rows.map(({ skill, def }) => ({
      definitionId: def.id,
      skillKey: skill.skillKey,
      name: def.name,
      description: def.description,
      group: skill.group,
      source: def.source!,
      instructionsMd: def.instructionsMd ?? "",
      fileName: def.fileName,
      contentHash: def.contentHash,
      tested: skill.tested,
      displayed: skill.displayed,
      potential: skill.potential,
      addedAt: skill.createdAt,
    }));
  },

  /** Takes a skill off an agent (its rating row); the definition stays as the business's record. Null when it had none. */
  async removeFromAgent(db: Executor, businessId: string, agentId: string, skillKey: string): Promise<AgentSkill | null> {
    const rows = await db.delete(agentSkills).where(and(eq(agentSkills.businessId, businessId), eq(agentSkills.agentId, agentId), eq(agentSkills.skillKey, skillKey))).returning();
    return rows[0] ?? null;
  },

  // agent skills ------------------------------------------------------------------------------------------------------
  async listForAgent(db: Executor, businessId: string, agentId: string): Promise<AgentSkill[]> {
    return db.select().from(agentSkills).where(and(eq(agentSkills.businessId, businessId), eq(agentSkills.agentId, agentId))).orderBy(asc(agentSkills.group), asc(agentSkills.skillKey));
  },

  /** `listForAgent` for several agents in one statement (the Team table), by agent id; every id asked for has a list. */
  async listForAgents(db: Executor, businessId: string, agentIds: readonly string[]): Promise<Map<string, AgentSkill[]>> {
    const out = new Map(agentIds.map((id) => [id, [] as AgentSkill[]]));
    if (agentIds.length === 0) return out;
    const rows = await db
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.businessId, businessId), inArray(agentSkills.agentId, [...agentIds])))
      .orderBy(asc(agentSkills.group), asc(agentSkills.skillKey));
    for (const row of rows) out.get(row.agentId)?.push(row);
    return out;
  },

  /**
   * Writes the rating rows for an agent (one per skill key; a repeated key keeps its last entry) in one statement, so
   * hiring an agent costs one round trip for its skills, not one per skill. The calibration maths lives in
   * packages/agents. Rows come back in the order given.
   */
  async upsertForAgent(db: Executor, businessId: string, agentId: string, inputs: UpsertAgentSkillInput[]): Promise<AgentSkill[]> {
    return (await skillsRepo.upsertForAgents(db, businessId, [{ agentId, skills: inputs }]))[0]!;
  },

  /** `upsertForAgent` for several agents in the same single statement (a whole team at commit). */
  async upsertForAgents(db: Executor, businessId: string, entries: { agentId: string; skills: UpsertAgentSkillInput[] }[]): Promise<AgentSkill[][]> {
    const lists = entries.map((e) => ({ agentId: parseInput(Id, e.agentId, "agent id"), list: parseInput(z.array(UpsertAgentSkillInput).min(1), e.skills, "agent skills") }));
    const rows = lists.flatMap(({ agentId, list }) =>
      [...new Map(list.map((v) => [v.skillKey, v] as const)).values()].map((v) => ({
      businessId,
      agentId,
      skillKey: v.skillKey,
      group: v.group,
      tested: numericText(v.tested) ?? null,
      proven: numericText(v.proven) ?? null,
      nLive: v.nLive,
      displayed: v.displayed,
      potential: v.potential,
    })),
    );
    if (rows.length === 0) return lists.map(() => []);
    const written = await db
      .insert(agentSkills)
      .values(rows)
      .onConflictDoUpdate({
        target: [agentSkills.agentId, agentSkills.skillKey],
        set: { group: sql`excluded."group"`, tested: sql`excluded.tested`, proven: sql`excluded.proven`, nLive: sql`excluded.n_live`, displayed: sql`excluded.displayed`, potential: sql`excluded.potential` },
        setWhere: eq(agentSkills.businessId, businessId),
      })
      .returning();
    const byWrittenKey = new Map(written.map((r) => [`${r.agentId}/${r.skillKey}`, r] as const));
    return lists.map(({ agentId, list }) => list.map((v) => one([byWrittenKey.get(`${agentId}/${v.skillKey}`)].filter((r): r is AgentSkill => r !== undefined), "agent skill")));
  },
};
