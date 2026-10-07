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
    currency: opts.currency ?? "EUR",
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
