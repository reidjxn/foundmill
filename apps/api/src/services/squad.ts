/**
 * Hiring agents from templates (packages/agents): one `agents` row, its first live `agent_versions` row from the
 * template, and `agent_skills` at the template's baseline rating (AC-11.1.6 "initial skills from template baselines").
 * Runs on the service db because `agent_skills` is service-written (docs/DECISIONS.md packages/db).
 */
import { getSkillDefinition, getTemplate, type AgentTemplate } from "@foundmill/agents";
import { repos, type Agent, type AgentVersion, type Executor } from "@foundmill/db";

export interface HireOptions {
  departmentIds?: string[];
  lineManagerId?: string | null;
  /** Display name override (the founder renames freely). */
  name?: string;
  createdBy?: string | null;
  /** The wage cap's currency; absent: the business's own (filled by the database from `businesses.currency`, 0025). */
  currency?: string;
}

export interface HiredAgent {
  agent: Agent & { currentVersion: AgentVersion | null };
  template: AgentTemplate;
  skillKeys: string[];
}

export async function hireFromTemplate(tx: Executor, businessId: string, templateKey: string, opts: HireOptions = {}): Promise<HiredAgent> {
  const template = getTemplate(templateKey);
  const agent = await repos.agents.create(tx, businessId, {
    name: opts.name ?? template.name,
    role: template.role,
    agentType: template.agentType,
    layer: template.layer,
    descriptionMd: template.description,
    departmentIds: opts.departmentIds ?? [],
    lineManagerId: opts.lineManagerId ?? null,
    modelKey: template.modelKey,
    status: "idle",
    autonomy: template.autonomy,
    negotiation: template.negotiation ?? {},
    schedule: template.schedule ?? {},
    wageCapMinor: template.wageCapMinor,
    currency: opts.currency,
    avatarSeed: `${businessId}:${template.key}`,
    initialVersion: { instructions: template.instructions, tools: template.tools, modelKey: template.modelKey, createdByKind: "system", createdBy: opts.createdBy ?? null },
  });
  await repos.skills.upsertForAgent(
    tx,
    businessId,
    agent.id,
    template.skills.map((skillKey) => ({
      skillKey,
      group: getSkillDefinition(skillKey)?.group ?? "craft",
      tested: template.baselineRating,
      proven: null,
      nLive: 0,
      displayed: template.baselineRating,
      potential: template.baselineRating,
    })),
  );
  return { agent, template, skillKeys: [...template.skills] };
}

/** One agent to hire in a batch: its id is chosen up front so others in the same batch can name it as line manager. */
export interface PlannedHire {
  id: string;
  templateKey: string;
  departmentIds: string[];
  lineManagerId: string | null;
}

/**
 * A whole team at once (commit): the same rows as `hireFromTemplate` for each, written in a handful of statements
 * (agents, versions, the link between them, every skill) instead of several round trips per agent.
 */
export async function hireMany(tx: Executor, businessId: string, plans: PlannedHire[], opts: { createdBy?: string | null; currency?: string } = {}): Promise<HiredAgent[]> {
  const templates = plans.map((p) => getTemplate(p.templateKey));
  const agents = await repos.agents.createMany(
    tx,
    businessId,
    plans.map((p, i) => {
      const template = templates[i]!;
      return {
        id: p.id,
        name: template.name,
        role: template.role,
        agentType: template.agentType,
        layer: template.layer,
        descriptionMd: template.description,
        departmentIds: p.departmentIds,
        lineManagerId: p.lineManagerId,
        modelKey: template.modelKey,
        status: "idle" as const,
        autonomy: template.autonomy,
        negotiation: template.negotiation ?? {},
        schedule: template.schedule ?? {},
        wageCapMinor: template.wageCapMinor,
        currency: opts.currency,
        avatarSeed: `${businessId}:${template.key}`,
        initialVersion: { instructions: template.instructions, tools: template.tools, modelKey: template.modelKey, createdByKind: "system" as const, createdBy: opts.createdBy ?? null },
      };
    }),
  );
  const withSkills = templates.map((template, i) => ({ template, agentId: agents[i]!.id })).filter(({ template }) => template.skills.length > 0);
  await repos.skills.upsertForAgents(
    tx,
    businessId,
    withSkills.map(({ template, agentId }) => ({
      agentId,
      skills: template.skills.map((skillKey) => ({ skillKey, group: getSkillDefinition(skillKey)?.group ?? "craft", tested: template.baselineRating, proven: null, nLive: 0, displayed: template.baselineRating, potential: template.baselineRating })),
    })),
  );
  return agents.map((agent, i) => ({ agent, template: templates[i]!, skillKeys: [...templates[i]!.skills] }));
}
