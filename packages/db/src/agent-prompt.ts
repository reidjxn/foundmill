/**
 * One resolver for what a call made in an agent's name renders (WP-06 T1, a3b TS-01): the business's own agent of the
 * role, with its live version and its skills, so a founder's edit or an added skill reaches the first page, post, plan
 * and every other call, not only the agent's sessions. Without such an agent the template stands, as before.
 *
 * The version rule is the session's (`followsTemplate` in apps/orchestrator activities/session.ts): version 1 written
 * by the system still follows the template, so a template change reaches every agent nobody has edited. The skills are
 * the session's too: the template's role skills first, then the library and file skills the agent carries.
 */
import { AgentInstructions, getChannelTemplate, getTemplate, getTemplateByAgentType, listTemplates, roleSkillsFor, type AgentPromptParts, type AgentSkillPrompt, type AgentTemplate } from "@foundmill/agents";
import type { ChannelKey } from "@foundmill/shared";
import { agentsRepo } from "./repos/agents";
import { skillsRepo } from "./repos/skills";
import type { Executor } from "./repos/_shared";
import type { Agent, AgentVersion } from "./schema";

export type AgentPromptTarget = { agentId: string } | { templateKey: string } | { channelKey: ChannelKey };

export interface ResolvedAgentPrompt extends AgentPromptParts {
  /** The agent whose parts these are; null when the business has no agent of the role (the template's parts). */
  agentId: string | null;
  templateKey: string;
}

/** The template an agent runs on: its type's, else the first worker template, else the Chief of Staff (session.ts). */
function templateOf(agent: Pick<Agent, "agentType">): AgentTemplate {
  return getTemplateByAgentType(agent.agentType) ?? listTemplates({ family: "worker" })[0] ?? getTemplate("chief_of_staff");
}

/** True when the live version is the platform's hiring copy nobody edited: the template is then its source. */
function followsTemplate(version: Pick<AgentVersion, "version" | "createdByKind"> | null): boolean {
  return version === null || (version.version === 1 && version.createdByKind === "system");
}

/**
 * The business's live agent of that role (oldest, not archived): its live version's instructions unless it still
 * follows the template, its role skills and its added skills. No such agent: the template and its role skills. An
 * `agentId` outside the business is not found (404), never another business's agent.
 */
export async function resolveAgentPrompt(db: Executor, businessId: string, target: AgentPromptTarget): Promise<ResolvedAgentPrompt> {
  let agent: Agent | null;
  let template: AgentTemplate;
  if ("agentId" in target) {
    agent = await agentsRepo.get(db, businessId, target.agentId);
    template = templateOf(agent);
  } else {
    template = "templateKey" in target ? getTemplate(target.templateKey) : getChannelTemplate(target.channelKey);
    agent = (await agentsRepo.list(db, businessId, { agentType: template.agentType, limit: 1 })).items[0] ?? null;
  }
  const roleSkills = roleSkillsFor(template.skills);
  if (!agent) return { agentId: null, templateKey: template.key, instructions: template.instructions, description: template.description, skills: roleSkills };
  const [version, added] = await Promise.all([agent.currentVersionId ? agentsRepo.getVersion(db, businessId, agent.currentVersionId) : null, skillsRepo.listAddedForAgent(db, businessId, agent.id, agent.agentType)]);
  const parsed = version && !followsTemplate(version) ? AgentInstructions.safeParse(version.instructions) : null;
  const skills: AgentSkillPrompt[] = [...roleSkills, ...added.filter((a) => a.instructionsMd.trim()).map((a) => ({ name: a.name, source: a.source, instructionsMd: a.instructionsMd }))];
  return { agentId: agent.id, templateKey: template.key, instructions: parsed?.success ? parsed.data : template.instructions, description: template.description, skills };
}
