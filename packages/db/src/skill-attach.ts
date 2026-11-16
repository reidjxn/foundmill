/**
 * Adding a library skill or a skill file to an agent, shared by the founder's profile and hire flow (apps/api
 * services/skills.ts) and the Chief of Staff's `assign_skill` tool (apps/gateway platform-host.ts), so both apply the
 * same screening and the same limits (Nov 6, 2026: "users should always be able to have these automatically assigned by
 * their chief of staff"). A file is parsed and screened by `parseSkillFile` (house rules, prompt injection, hidden text,
 * sizes) whoever adds it; nothing here grants a tool: a skill is instructions in the agent's "## Skills" section.
 * Callers audit each addition under their own actor.
 */
import { createHash } from "node:crypto";
import { LIBRARY_SKILL_PREFIX, MAX_SKILLS_PER_AGENT, SKILL_INDEX_MAX_CHARS, SKILL_LIBRARY, attachedSkills, renderSkillIndex, SKILL_LIBRARY_CATEGORY_LABELS, getLibrarySkill, getSkillDefinition, getTemplateByAgentType, librarySkillKey, parseSkillFile, uploadSkillKey } from "@foundmill/agents";
import { ConflictError, ValidationError, type AddedSkillSource, type SkillGroup } from "@foundmill/shared";
import { repos, type AddedAgentSkill } from "./repos";
import type { Agent, SkillDefinition } from "./schema";
import type { Executor } from "./repos/_shared";

/** A skill ready to attach: what the definition stores. */
export interface ResolvedSkill {
  skillKey: string;
  name: string;
  description: string;
  group: SkillGroup;
  source: AddedSkillSource;
  instructionsMd: string;
  fileName: string | null;
  contentHash: string | null;
}

/** The skills library as the Chief of Staff's `list_skills` shows it: key, name, what it is for, its category. */
export function skillLibraryEntries(): { key: string; name: string; description: string; category: string }[] {
  return SKILL_LIBRARY.map((s) => ({ key: s.key, name: s.name, description: s.description, category: SKILL_LIBRARY_CATEGORY_LABELS[s.category] }));
}

/** A skill from the skills library by its key; 400 when the library has none. */
export function resolveLibrarySkill(key: string): ResolvedSkill {
  const s = getLibrarySkill(key);
  if (!s) throw new ValidationError("That skill is not in the skills library", { key });
  return { skillKey: librarySkillKey(s.key), name: s.attribute.name, description: s.description, group: s.attribute.group, source: "library", instructionsMd: s.instructionsMd, fileName: null, contentHash: null };
}

/** A skill file, parsed and screened; a refusal is a 400 whose message says what to change. */
export function resolveSkillFile(file: { fileName: string; content: string }): ResolvedSkill {
  const parsed = parseSkillFile(file);
  if (!parsed.ok) throw new ValidationError(parsed.error.message, { code: parsed.error.code, ...(parsed.error.line ? { line: parsed.error.line } : {}) });
  const skill = parsed.skill;
  const contentHash = createHash("sha256").update(skill.normalized, "utf8").digest("hex");
  const fileName = (file.fileName.split(/[\\/]/).pop() ?? file.fileName).slice(0, 255);
  return { skillKey: uploadSkillKey(skill.name, contentHash), name: skill.name, description: skill.description, group: "craft", source: "upload", instructionsMd: skill.instructionsMd, fileName, contentHash };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Attaches resolved skills to an agent in the caller's (service) transaction: the definitions for the agent's type and
 * the rating rows at the template's baseline (untested). `onAdded` runs once per definition (the caller's audit row).
 * Refuses (409) a skill the agent already has, by key or by name (a rating it carries counts, TS-12), and (400) more than `MAX_SKILLS_PER_AGENT`
 * added skills or a skills index past `SKILL_INDEX_MAX_CHARS` (WP-06 T4). Each skill's 20,000 characters and each file's 64 KB stay.
 */
export async function attachAddedSkills(
  tx: Executor,
  businessId: string,
  agent: Pick<Agent, "id" | "name" | "agentType">,
  skills: readonly ResolvedSkill[],
  onAdded: (definition: SkillDefinition, skill: ResolvedSkill) => Promise<void>,
): Promise<AddedAgentSkill[]> {
  if (skills.length === 0) return [];
  // Lock the agent first, so two adds at once cannot both pass the count and index limits (they run one after the other).
  await repos.agents.lockForUpdate(tx, businessId, agent.id);
  const [existing, ratings] = await Promise.all([repos.skills.listAddedForAgent(tx, businessId, agent.id, agent.agentType), repos.skills.listForAgent(tx, businessId, agent.id)]);
  const seen: { key: string; name: string }[] = existing.map((e) => ({ key: e.skillKey, name: e.name }));
  // The ratings the agent carries, by their catalog name ("Debugging"): an added skill may not read as one of them,
  // unless it is a library skill that names that rating in `improves` (it sharpens it; TS-12).
  const rated = ratings.flatMap((r) => {
    const d = getSkillDefinition(r.skillKey);
    return d ? [{ key: r.skillKey, name: d.name }] : [];
  });
  for (const s of skills) {
    const improves = s.source === "library" ? (getLibrarySkill(s.skillKey.slice(LIBRARY_SKILL_PREFIX.length))?.improves ?? []) : [];
    const readsAsRating = rated.some((r) => sameName(r.name, s.name) && !improves.includes(r.key));
    if (readsAsRating || ratings.some((r) => r.skillKey === s.skillKey) || seen.some((x) => x.key === s.skillKey || sameName(x.name, s.name))) throw new ConflictError(`${agent.name} already has a skill called "${s.name}"`, { skillKey: s.skillKey });
    seen.push({ key: s.skillKey, name: s.name });
  }
  if (seen.length > MAX_SKILLS_PER_AGENT) throw new ValidationError(`An agent carries at most ${MAX_SKILLS_PER_AGENT} skills from the library or files; remove one first`);
  // Bodies load on demand (read_skill); what every prompt carries is the index, so that is what is bounded (WP-06 T4).
  const template = getTemplateByAgentType(agent.agentType);
  const rows = [...existing, ...skills.map((s) => ({ skillKey: s.skillKey, name: s.name, source: s.source, description: s.description, instructionsMd: s.instructionsMd }))];
  if (renderSkillIndex(attachedSkills(template?.skills ?? [], rows)).length > SKILL_INDEX_MAX_CHARS) throw new ValidationError(`${agent.name}'s list of skills would pass ${SKILL_INDEX_MAX_CHARS.toLocaleString("en-US")} characters; remove one or give an uploaded skill a shorter description`);
  const baseline = getTemplateByAgentType(agent.agentType)?.baselineRating ?? 8;
  for (const s of skills) {
    const definition = await repos.skills.upsertAddedDefinition(tx, businessId, { agentType: agent.agentType, skillKey: s.skillKey, name: s.name, description: s.description, group: s.group, source: s.source, instructionsMd: s.instructionsMd, fileName: s.fileName, contentHash: s.contentHash });
    await onAdded(definition, s);
  }
  // Untested: no tested rating until a training run scores the skill; displayed at the template's baseline meanwhile.
  await repos.skills.upsertForAgent(tx, businessId, agent.id, skills.map((s) => ({ skillKey: s.skillKey, group: s.group, tested: null, proven: null, nLive: 0, displayed: baseline, potential: baseline })));
  const added = await repos.skills.listAddedForAgent(tx, businessId, agent.id, agent.agentType);
  return added.filter((a) => skills.some((s) => s.skillKey === a.skillKey));
}
