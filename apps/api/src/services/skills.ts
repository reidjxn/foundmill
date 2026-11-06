/**
 * Skills a founder adds to an agent from the skills library or a skill file (founder request 2026-10-16), at hire
 * (team.agents.hire `skills`) or from the profile (agent.skills.add / remove). Adding never waits on a model call:
 * a library skill is copied from the catalog, a file is parsed and screened here (`parseSkillFile`: house rules,
 * prompt injection, hidden text, sizes) whatever the preview said, and both become a business skill definition for the
 * agent's type with the instructions its prompt carries, plus a rating row at the template's baseline, untested until
 * a training run scores it. Every addition and removal is audited.
 *
 * The rows are written on the service connection after the team-write check (agent_skills is service-written), as
 * hiring and custom skills are.
 */
import { SKILL_FILE_MAX_BYTES, SKILL_LIBRARY, SKILL_LIBRARY_CATEGORY_LABELS, librarySkillKey, parseSkillFile, type AgentSkillPrompt, type ParsedSkillFile } from "@foundmill/agents";
import { attachAddedSkills, repos, resolveLibrarySkill, resolveSkillFile, type AddedAgentSkill, type Agent, type Executor, type ResolvedSkill } from "@foundmill/db";
import { ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { audit, type BusinessContext } from "../trpc";

/** A skill file as the browser sends it: its name and its text (decoded strictly as UTF-8 there). */
export const SkillFileUpload = z.object({
  fileName: z.string().trim().min(1).max(255),
  // Characters, not bytes: the parser checks the byte limit and says so. Twice the limit leaves it room to.
  content: z.string().max(SKILL_FILE_MAX_BYTES * 2),
});

/** One skill to add: a library key, or an uploaded file. */
export const SkillChoice = z.discriminatedUnion("source", [z.object({ source: z.literal("library"), key: z.string().min(1).max(80) }), SkillFileUpload.extend({ source: z.literal("upload") })]);
export type SkillChoice = z.infer<typeof SkillChoice>;

/** A skill ready to attach: what the definition stores (packages/db skill-attach). */
export type { ResolvedSkill };

/** The library as the hire flow and the profile list it: grouped by category, with each skill's attribute and text. */
export function libraryView() {
  return SKILL_LIBRARY.map((s) => ({
    key: s.key,
    skillKey: librarySkillKey(s.key),
    name: s.name,
    description: s.description,
    category: s.category,
    categoryLabel: SKILL_LIBRARY_CATEGORY_LABELS[s.category],
    attribute: s.attribute,
    instructionsMd: s.instructionsMd,
  }));
}

/** Parses and screens a file; a refusal is a 400 whose message says what to change. */
export function parseUpload(upload: z.infer<typeof SkillFileUpload>): ParsedSkillFile {
  const parsed = parseSkillFile(upload);
  if (!parsed.ok) throw new ValidationError(parsed.error.message, { code: parsed.error.code, ...(parsed.error.line ? { line: parsed.error.line } : {}) });
  return parsed.skill;
}

/** What the founder sees before adding a file: name, description, the first lines and any front matter ignored. */
export function uploadPreview(upload: z.infer<typeof SkillFileUpload>) {
  const skill = parseUpload(upload);
  return {
    name: skill.name,
    description: skill.description,
    format: skill.format,
    fileName: upload.fileName.split(/[\\/]/).pop() ?? upload.fileName,
    sizeBytes: new TextEncoder().encode(upload.content).length,
    lines: skill.preview,
    totalLines: skill.instructionsMd.split("\n").filter((l) => l.trim()).length,
    notes: skill.notes,
    group: "craft" as const,
  };
}

export function resolveSkillChoice(choice: SkillChoice): ResolvedSkill {
  return choice.source === "library" ? resolveLibrarySkill(choice.key) : resolveSkillFile(choice);
}

/**
 * Attaches resolved skills to an agent in the caller's (service) transaction (packages/db `attachAddedSkills`: the
 * definitions, the rating rows at the template's baseline, the same limits for the founder and the Chief of Staff),
 * one audit entry each.
 */
export async function attachSkills(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "userId">, agent: Pick<Agent, "id" | "name" | "agentType">, skills: readonly ResolvedSkill[]): Promise<AddedAgentSkill[]> {
  return attachAddedSkills(tx, ctx.businessId, agent, skills, (definition, s) => audit(tx, ctx, { action: "agent.skills.add", target: { kind: "skill_definition", id: definition.id }, details: { agentId: agent.id, skillKey: s.skillKey, source: s.source, fileName: s.fileName, contentHash: s.contentHash } }).then(() => undefined));
}

/** Takes an added skill off an agent (its definition stays as the record) and audits it; 400 when it has none. */
export async function detachSkill(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "userId">, agent: Pick<Agent, "id" | "agentType">, skillKey: string): Promise<AddedAgentSkill> {
  const added = (await repos.skills.listAddedForAgent(tx, ctx.businessId, agent.id, agent.agentType)).find((a) => a.skillKey === skillKey);
  if (!added) throw new ValidationError("This agent has no skill from the library or a file with that key", { skillKey });
  await repos.skills.removeFromAgent(tx, ctx.businessId, agent.id, skillKey);
  await audit(tx, ctx, { action: "agent.skills.remove", target: { kind: "skill_definition", id: added.definitionId }, details: { agentId: agent.id, skillKey, source: added.source, fileName: added.fileName } });
  return added;
}

/** The skills an agent's prompt carries, in the order they were added (`buildSystemPrompt` `skills`). */
export function promptSkills(added: readonly Pick<AddedAgentSkill, "name" | "source" | "instructionsMd">[]): AgentSkillPrompt[] {
  return added.filter((a) => a.instructionsMd.trim()).map((a) => ({ name: a.name, source: a.source, instructionsMd: a.instructionsMd }));
}

/** An added skill as the profile lists it (no instructions body beyond its first lines). */
export function addedSkillView(a: AddedAgentSkill) {
  return {
    definitionId: a.definitionId,
    skillKey: a.skillKey,
    name: a.name,
    description: a.description,
    group: a.group,
    source: a.source,
    fileName: a.fileName,
    untested: a.tested === null,
    displayed: a.displayed,
    preview: a.instructionsMd.split("\n").filter((l) => l.trim()).slice(0, 4),
    addedAt: a.addedAt,
  };
}
