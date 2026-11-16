/**
 * Adding a library skill or a skill file to an agent, shared by the founder's profile and hire flow (apps/api
 * services/skills.ts) and the Chief of Staff's `assign_skill` tool (apps/gateway platform-host.ts), so both apply the
 * same screening and the same limits (Nov 6, 2026: "users should always be able to have these automatically assigned by
 * their chief of staff"). A file is parsed and screened by `parseSkillFile` (house rules, prompt injection, hidden text,
 * sizes) whoever adds it; nothing here grants a tool: a skill is instructions in the agent's "## Skills" section.
 * Callers audit each addition under their own actor.
 */
import { createHash } from "node:crypto";
import { DEFAULT_SKILLS_VERSION, LIBRARY_SKILL_PREFIX, MAX_SKILLS_PER_AGENT, defaultSkillKeysFor, type LibrarySkill, type StoredSkillRow, SKILL_INDEX_MAX_CHARS, SKILL_LIBRARY, attachedSkills, renderSkillIndex, SKILL_LIBRARY_CATEGORY_LABELS, getLibrarySkill, getSkillDefinition, getTemplateByAgentType, librarySkillKey, parseSkillFile, uploadSkillKey } from "@foundmill/agents";
import { ConflictError, ValidationError, type AddedSkillSource, type SkillAddedBy, type SkillGroup } from "@foundmill/shared";
import { repos, type AddedAgentSkill } from "./repos";
import type { Agent, SkillDefinition } from "./schema";
import type { Db } from "./client";
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
  addedBy: Exclude<SkillAddedBy, "template"> = "founder",
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
  await repos.skills.upsertForAgent(tx, businessId, agent.id, skills.map((s) => ({ skillKey: s.skillKey, group: s.group, tested: null, proven: null, nLive: 0, displayed: baseline, potential: baseline, addedBy })));
  const added = await repos.skills.listAddedForAgent(tx, businessId, agent.id, agent.agentType);
  return added.filter((a) => skills.some((s) => s.skillKey === a.skillKey));
}

/** An agent to give its role's default skills: `defaultSkillsVersion` is the release it already has (0: none). */
export interface DefaultSkillsTarget {
  id: string;
  agentType: string;
  templateKey: string;
  defaultSkillsVersion?: number;
  /** Library keys not to give this agent (the backfill: removed before, a name it carries, or past a limit). */
  exclude?: readonly string[];
}

/**
 * Gives agents the library skills their role comes with (WP-06 T6; founder, Nov 16, 2026: D3), in the caller's
 * (service) transaction: the definitions for each agent type in one statement, the rating rows (`added_by =
 * 'template'`, untested, at the template's baseline) in another, then each agent's `default_skills_version`. Only
 * defaults newer than an agent's version are offered, and a skill the agent already carries is left as it is, so a
 * default the founder removed never comes back. Every agent must be the business's own (400 otherwise). `library`
 * and `version` are for tests. Returns what was given, by agent id (library keys).
 */
export async function attachDefaultSkills(
  tx: Executor,
  businessId: string,
  agents: readonly DefaultSkillsTarget[],
  options: { library?: readonly LibrarySkill[]; version?: number } = {},
): Promise<Map<string, string[]>> {
  const library = options.library ?? SKILL_LIBRARY;
  const version = options.version ?? DEFAULT_SKILLS_VERSION;
  const given = new Map<string, string[]>();
  if (agents.length === 0) return given;
  // The rows carry `businessId`, and agent_skills' foreign key does not know tenants: never write onto another
  // business's agent (security review L1).
  if ((await repos.agents.byIds(tx, businessId, agents.map((a) => a.id))).length !== new Set(agents.map((a) => a.id)).size) throw new ValidationError("Default skills go only to the business's own agents");
  const byKey = new Map(library.map((s) => [s.key, s] as const));
  const wanted = agents.flatMap((a) =>
    defaultSkillKeysFor(a.templateKey, a.defaultSkillsVersion ?? 0, library)
      .filter((key) => !a.exclude?.includes(key))
      .map((key) => ({ agent: a, skill: byKey.get(key)! })),
  );
  await repos.skills.upsertAddedDefinitions(
    tx,
    businessId,
    wanted.map(({ agent, skill }) => ({ agentType: agent.agentType, skillKey: librarySkillKey(skill.key), name: skill.attribute.name, description: skill.description, group: skill.attribute.group, source: "library" as const, instructionsMd: skill.instructionsMd, fileName: null, contentHash: null })),
  );
  const written = await repos.skills.addTemplateDefaults(
    tx,
    businessId,
    wanted.map(({ agent, skill }) => ({ agentId: agent.id, skillKey: librarySkillKey(skill.key), group: skill.attribute.group, displayed: getTemplateByAgentType(agent.agentType)?.baselineRating ?? 8 })),
  );
  for (const w of written) given.set(w.agentId, [...(given.get(w.agentId) ?? []), w.skillKey.slice(LIBRARY_SKILL_PREFIX.length)]);
  await repos.agents.setDefaultSkillsVersion(tx, businessId, agents.map((a) => a.id), version);
  return given;
}

export interface DefaultSkillsBackfillResult {
  businesses: number;
  agents: number;
  attached: number;
  failed: { businessId: string; error: string }[];
}

/**
 * The defaults an agent hired before a release must not get from the backfill: one the founder or the Chief of Staff
 * took off it before (an `agent.skills.remove` audit row, which also covers removals before 0143), one whose name it
 * already carries, and any that would take it past `MAX_SKILLS_PER_AGENT` or the index past `SKILL_INDEX_MAX_CHARS`
 * (the founder could otherwise add nothing until they removed one; security review M1, L4).
 */
async function backfillExclusions(tx: Executor, businessId: string, agent: DefaultSkillsTarget, library: readonly LibrarySkill[], removed: ReadonlySet<string>): Promise<string[]> {
  const offered = defaultSkillKeysFor(agent.templateKey, agent.defaultSkillsVersion ?? 0, library);
  if (offered.length === 0) return [];
  const existing = await repos.skills.listAddedForAgent(tx, businessId, agent.id, agent.agentType);
  const template = getTemplateByAgentType(agent.agentType);
  const rows: StoredSkillRow[] = existing.map((e) => ({ skillKey: e.skillKey, name: e.name, source: e.source, description: e.description, instructionsMd: e.instructionsMd }));
  const exclude: string[] = [];
  for (const key of offered) {
    const skill = library.find((s) => s.key === key)!;
    const row: StoredSkillRow = { skillKey: librarySkillKey(key), name: skill.attribute.name, source: "library", description: skill.description, instructionsMd: skill.instructionsMd };
    const clash = rows.some((r) => r.skillKey === row.skillKey || sameName(r.name, row.name));
    if (removed.has(`${agent.id}/${row.skillKey}`) || clash || rows.length + 1 > MAX_SKILLS_PER_AGENT || renderSkillIndex(attachedSkills(template?.skills ?? [], [...rows, row])).length > SKILL_INDEX_MAX_CHARS) {
      exclude.push(key);
      continue;
    }
    rows.push(row);
  }
  return exclude;
}

/**
 * Gives the agents hired before a release of defaults the ones they lack (founder, Nov 16, 2026: D3), one business per
 * transaction, at api boot after the migrations (apps/api `default-skills-backfill.ts`). Idempotent by
 * `default_skills_version`: an agent already on the release is skipped, so every boot of every replica may run it, and
 * the agents are locked so two replicas never work on the same business at once (a lock held elsewhere for more than a
 * few seconds fails that business for this boot). Archived agents are left alone; one audit row per agent given any.
 */
export async function backfillDefaultSkills(db: Db, options: { library?: readonly LibrarySkill[]; version?: number } = {}): Promise<DefaultSkillsBackfillResult> {
  const version = options.version ?? DEFAULT_SKILLS_VERSION;
  const library = options.library ?? SKILL_LIBRARY;
  const pending = await repos.agents.businessesBehindOnDefaults(db, version);
  const result: DefaultSkillsBackfillResult = { businesses: 0, agents: 0, attached: 0, failed: [] };
  for (const businessId of pending) {
    try {
      const done = await db.transaction(async (tx) => {
        const rows = await repos.agents.lockBehindOnDefaults(tx, businessId, version);
        const removed = await repos.audit.removedSkills(tx, businessId, rows.map((r) => r.id));
        const targets: DefaultSkillsTarget[] = [];
        for (const r of rows) {
          const target = { ...r, templateKey: getTemplateByAgentType(r.agentType)?.key ?? "" };
          targets.push({ ...target, exclude: await backfillExclusions(tx, businessId, target, library, removed) });
        }
        const given = await attachDefaultSkills(tx, businessId, targets, { library, version });
        for (const [agentId, keys] of given) await repos.audit.append(tx, businessId, { actorKind: "system", action: "agent.skills.add_defaults", target: { kind: "agent", id: agentId }, details: { skillKeys: keys.map(librarySkillKey), version } });
        return { agents: rows.length, attached: [...given.values()].reduce((n, k) => n + k.length, 0) };
      });
      result.businesses += 1;
      result.agents += done.agents;
      result.attached += done.attached;
    } catch (err) {
      result.failed.push({ businessId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
