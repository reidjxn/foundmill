/**
 * Hiring agents from templates (packages/agents), the one implementation (WP-06 T5): one `agents` row, its first live
 * `agent_versions` row from the template, and `agent_skills` at the template's baseline rating (AC-11.1.6 "initial
 * skills from template baselines"). Recruitment (`team.agents.hire`), commit (`hireMany`) and the plan's `hire_agent`
 * all write through here. Each hire also gets its role's default library skills ("Came with the role", WP-06 T6). Run it on the service connection: `agent_skills` is service-written (docs/DECISIONS.md
 * packages/db).
 */
import { getSkillDefinition, getTemplate, type AgentTemplate } from "@foundmill/agents";
import { repos } from "./repos";
import { attachDefaultSkills } from "./skill-attach";
import type { Executor } from "./repos/_shared";
import type { Agent, AgentVersion } from "./schema";

export interface HireOptions {
  departmentIds?: string[];
  lineManagerId?: string | null;
  /** Display name override (the founder renames freely). */
  name?: string;
  createdBy?: string | null;
  /** The wage cap's currency; absent: US dollars, the model price list's (a wage cap caps metered model cost; 0024, 0025). */
  currency?: string;
}

export interface HiredAgent {
  agent: Agent & { currentVersion: AgentVersion | null };
  template: AgentTemplate;
  skillKeys: string[];
}

/** One agent to hire in a batch: its id is chosen up front so others in the same batch can name it as line manager. */
export interface PlannedHire {
  id: string;
  templateKey: string;
  departmentIds: string[];
  lineManagerId: string | null;
}

/** The fields of an `agents` row (and its first version) that come from the template. */
function agentFromTemplate(businessId: string, template: AgentTemplate, opts: { createdBy?: string | null; currency?: string }) {
  return {
    name: template.name,
    role: template.role,
    agentType: template.agentType,
    layer: template.layer,
    descriptionMd: template.description,
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
}

/** The template's skills at its baseline rating; the group is the skill definition's. */
function baselineSkills(template: AgentTemplate) {
  return template.skills.map((skillKey) => ({
    skillKey,
    group: getSkillDefinition(skillKey)?.group ?? "craft",
    tested: template.baselineRating,
    proven: null,
    nLive: 0,
    displayed: template.baselineRating,
    potential: template.baselineRating,
  }));
}

export async function hireFromTemplate(tx: Executor, businessId: string, templateKey: string, opts: HireOptions = {}): Promise<HiredAgent> {
  const template = getTemplate(templateKey);
  const agent = await repos.agents.create(tx, businessId, {
    ...agentFromTemplate(businessId, template, opts),
    name: opts.name ?? template.name,
    departmentIds: opts.departmentIds ?? [],
    lineManagerId: opts.lineManagerId ?? null,
  });
  await repos.skills.upsertForAgent(tx, businessId, agent.id, baselineSkills(template));
  await attachDefaultSkills(tx, businessId, [{ id: agent.id, agentType: agent.agentType, templateKey: template.key }]);
  return { agent, template, skillKeys: [...template.skills] };
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
    plans.map((p, i) => ({ ...agentFromTemplate(businessId, templates[i]!, opts), id: p.id, departmentIds: p.departmentIds, lineManagerId: p.lineManagerId })),
  );
  const withSkills = templates.map((template, i) => ({ template, agentId: agents[i]!.id })).filter(({ template }) => template.skills.length > 0);
  await repos.skills.upsertForAgents(
    tx,
    businessId,
    withSkills.map(({ template, agentId }) => ({ agentId, skills: baselineSkills(template) })),
  );
  await attachDefaultSkills(tx, businessId, agents.map((agent, i) => ({ id: agent.id, agentType: agent.agentType, templateKey: templates[i]!.key })));
  return agents.map((agent, i) => ({ agent, template: templates[i]!, skillKeys: [...templates[i]!.skills] }));
}
