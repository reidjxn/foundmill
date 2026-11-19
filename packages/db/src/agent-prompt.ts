/**
 * One resolver for what a call made in an agent's name renders (WP-06 T1, a3b TS-01): the business's own agent of the
 * role, with its live version and its skills, so a founder's edit or an added skill reaches the first page, post, plan
 * and every other call, not only the agent's sessions. Without such an agent the template stands, as before.
 *
 * The version rule is the session's (`followsTemplate` in apps/orchestrator activities/session.ts): version 1 written
 * by the system still follows the template, so a template change reaches every agent nobody has edited. The skills are
 * the session's too: the template's role skills first, then the library and file skills the agent carries.
 */
import { AgentInstructions, NO_TOOL_LOOP_PRELOAD_BODIES, attachedSkills, findAttachedSkill, getChannelTemplate, getTemplate, getTemplateByAgentType, listTemplates, renderSkillBlock, selectSkills, storedSkillRefusal, type AgentPromptParts, type AgentTemplate } from "@foundmill/agents";
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
export function agentTemplateOf(agent: Pick<Agent, "agentType">): AgentTemplate {
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
    template = agentTemplateOf(agent);
  } else {
    template = "templateKey" in target ? getTemplate(target.templateKey) : getChannelTemplate(target.channelKey);
    agent = (await agentsRepo.list(db, businessId, { agentType: template.agentType, limit: 1 })).items[0] ?? null;
  }
  // These are one-call builders (no tool loop, no read_skill): the index plus the first bodies in order (WP-06 T4).
  const select = (added: Parameters<typeof attachedSkills>[1]) => selectSkills({ skills: attachedSkills(template.skills, added), maxBodies: NO_TOOL_LOOP_PRELOAD_BODIES });
  if (!agent) return { agentId: null, templateKey: template.key, instructions: template.instructions, description: template.description, skills: select([]) };
  const [version, added] = await Promise.all([agent.currentVersionId ? agentsRepo.getVersion(db, businessId, agent.currentVersionId) : null, skillsRepo.listAddedForAgent(db, businessId, agent.id, agent.agentType)]);
  const parsed = version && !followsTemplate(version) ? AgentInstructions.safeParse(version.instructions) : null;
  const skills = select(added);
  return { agentId: agent.id, templateKey: template.key, instructions: parsed?.success ? parsed.data : template.instructions, description: template.description, skills };
}

/** What `read_skill` answers: the skill as its block, or why it is not given. */
export type ReadAgentSkillResult = { ok: true; skillKey: string; name: string; source: "library" | "upload" | "role"; text: string } | { ok: false; code: "not_found" | "refused"; message: string };

/**
 * One of an agent's own skills in full, for the gateway's `read_skill` (WP-06 T4): only a skill the agent carries (its
 * role's, or one added to it in this business), never another agent's or another business's. A library skill reads as
 * the catalog has it. A stored skill is screened by the same rule as every prompt (`attachedSkills` leaves out one
 * that fails `storedSkillRefusal`); asked for by key, it is refused with the reason. It comes inside its `<skill>` block,
 * so its text cannot open or close another.
 */
export async function readAgentSkill(db: Executor, businessId: string, agentId: string, skillKey: string): Promise<ReadAgentSkillResult> {
  const agent = await agentsRepo.get(db, businessId, agentId);
  const added = await skillsRepo.listAddedForAgent(db, businessId, agent.id, agent.agentType);
  const skill = findAttachedSkill(attachedSkills(agentTemplateOf(agent).skills, added), skillKey);
  if (!skill) {
    const held = added.find((a) => a.skillKey === skillKey.trim());
    const refusal = held ? storedSkillRefusal(held) : null;
    if (held && refusal) return { ok: false, code: "refused", message: `The skill ${held.name} did not pass the platform's check, so it was not loaded: ${refusal.message}` };
    return { ok: false, code: "not_found", message: `You have no skill ${skillKey.slice(0, 200)}: use a key from your skills list` };
  }
  return { ok: true, skillKey: skill.key, name: skill.name, source: skill.source, text: renderSkillBlock(skill) };
}
