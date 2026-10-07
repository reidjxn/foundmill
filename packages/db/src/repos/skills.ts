/** skill_definitions, skill_tests, agent_skills — attribute ratings (BUILD §11.10; routers agent.profile.*). */
import { SKILL_GROUPS } from "@founder-manager/shared";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
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

  /** Tests for a definition. Held-out tests come back redacted unless `includeHeldOut` (the training runner). */
  async listTests(db: Executor, businessId: string, definitionId: string, options: { includeHeldOut?: boolean } = {}): Promise<(SkillTest | RedactedSkillTest)[]> {
    await skillsRepo.getDefinition(db, businessId, definitionId);
    const rows = await db
      .select()
      .from(skillTests)
      .where(and(eq(skillTests.skillDefinitionId, definitionId), or(isNull(skillTests.businessId), eq(skillTests.businessId, businessId)), isNull(skillTests.archivedAt)))
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
        .values({ businessId: def.businessId === null ? null : businessId, skillDefinitionId: v.skillDefinitionId, task: v.task, rubric: v.rubric, heldOut: v.heldOut, fixturesRef: v.fixturesRef ?? null })
        .returning(),
      "skill test",
    );
  },

  // agent skills ------------------------------------------------------------------------------------------------------
  async listForAgent(db: Executor, businessId: string, agentId: string): Promise<AgentSkill[]> {
    return db.select().from(agentSkills).where(and(eq(agentSkills.businessId, businessId), eq(agentSkills.agentId, agentId))).orderBy(asc(agentSkills.group), asc(agentSkills.skillKey));
  },

  /** Writes the rating rows for an agent (one per skill key); the calibration maths lives in packages/agents. */
  async upsertForAgent(db: Executor, businessId: string, agentId: string, inputs: UpsertAgentSkillInput[]): Promise<AgentSkill[]> {
    const list = parseInput(z.array(UpsertAgentSkillInput).min(1), inputs, "agent skills");
    return db.transaction(async (tx) => {
      const out: AgentSkill[] = [];
      for (const v of list) {
        const values = {
          businessId,
          agentId,
          skillKey: v.skillKey,
          group: v.group,
          tested: numericText(v.tested) ?? null,
          proven: numericText(v.proven) ?? null,
          nLive: v.nLive,
          displayed: v.displayed,
          potential: v.potential,
        };
        out.push(
          one(
            await tx
              .insert(agentSkills)
              .values(values)
              .onConflictDoUpdate({ target: [agentSkills.agentId, agentSkills.skillKey], set: values, setWhere: eq(agentSkills.businessId, businessId) })
              .returning(),
            "agent skill",
          ),
        );
      }
      return out;
    });
  },
};
