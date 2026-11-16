/**
 * Which of an agent's skills a call carries in full (WP-06 T4, a3b §6c, AR-10 design A). Every attached skill gets a
 * line in the prompt's index; a few bodies are loaded up front and the rest are read on demand with `read_skill`.
 *
 * `selectSkills` is deterministic (no model call): the same skills and task give the same prompt. The index keeps the
 * attached order whatever is chosen, so the "## Skills" section, which holds the index, is the same for every task and
 * stays in the cached prefix; the bodies chosen for a task render after the brief (`renderLoadedSkills`).
 *
 * Library skills follow the catalog (`attachedSkills`): the body and `whenToUse` come from the generated catalog when
 * it has the key, so a library skill stored before an edit reads as the library has it now (TS-11).
 */
import type { ProductStage, TaskKind } from "@foundmill/shared";
import { SKILL_PRELOAD_MAX_CHARS, type AgentSkillPrompt } from "./club-rules";
import { roleSkillsFor } from "./design-check";
import { LIBRARY_SKILL_PREFIX, getLibrarySkill } from "./skill-library";
import { screenSkill, type SkillFileError } from "./skill-files";

/** One skill an agent carries, with its whole body: what `selectSkills` chooses from. */
export interface AttachedSkill {
  key: string;
  name: string;
  source: "library" | "upload" | "role";
  whenToUse: string;
  instructionsMd: string;
  stages?: readonly ProductStage[];
  improves?: readonly string[];
}

/** Bodies loaded up front in a session that holds `read_skill` (an Estimate, tuned with the eval). */
export const SESSION_PRELOAD_BODIES = 1;
/** Bodies loaded up front in a call with no tool loop: the conversation, training and the one-call builders (an Estimate). */
export const NO_TOOL_LOOP_PRELOAD_BODIES = 2;
/** The longest `whenToUse` an index line carries (an upload's description is cut to it). */
export const SKILL_WHEN_TO_USE_MAX_CHARS = 160;

/** A stored skill row (packages/db `AddedAgentSkill`): what `attachedSkills` needs of it. */
export interface StoredSkillRow {
  skillKey: string;
  name: string;
  source: "library" | "upload";
  description: string;
  instructionsMd: string;
}

function cut(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/** A stored library or file skill as the prompt uses it: a library skill takes its body and `whenToUse` from the catalog. */
export function attachedSkillFrom(row: StoredSkillRow): AttachedSkill {
  const lib = row.source === "library" && row.skillKey.startsWith(LIBRARY_SKILL_PREFIX) ? getLibrarySkill(row.skillKey.slice(LIBRARY_SKILL_PREFIX.length)) : undefined;
  if (lib) return { key: row.skillKey, name: row.name, source: "library", whenToUse: lib.whenToUse, instructionsMd: lib.instructionsMd, stages: lib.stages, improves: lib.improves };
  return { key: row.skillKey, name: row.name, source: row.source, whenToUse: cut(row.description || row.name, SKILL_WHEN_TO_USE_MAX_CHARS), instructionsMd: row.instructionsMd };
}

/**
 * Why a stored skill may not reach a prompt, or null when it may: text that is not the catalog's (an upload, or a
 * library key the catalog no longer has) is screened again as it is used, so a file stored before a screen tightened is
 * held to today's rules on every path, the index, the loaded bodies and `read_skill` alike. Catalog text is screened by
 * the library's own test.
 */
export function storedSkillRefusal(row: StoredSkillRow): SkillFileError | null {
  const fromCatalog = row.source === "library" && row.skillKey.startsWith(LIBRARY_SKILL_PREFIX) && getLibrarySkill(row.skillKey.slice(LIBRARY_SKILL_PREFIX.length)) !== undefined;
  if (fromCatalog) return null;
  return screenSkill({ name: row.name, description: row.description, instructionsMd: row.instructionsMd });
}

/**
 * Every skill an agent carries: the role's skills (by its template's skill keys) first, then its added skills in
 * order. A stored skill that fails the screen (`storedSkillRefusal`) is left out: it is neither indexed nor loaded.
 */
export function attachedSkills(roleSkillKeys: readonly string[], added: readonly StoredSkillRow[]): AttachedSkill[] {
  const usable = added.filter((row) => storedSkillRefusal(row) === null);
  return [...roleSkillsFor(roleSkillKeys), ...usable.map(attachedSkillFrom).filter((s) => s.instructionsMd.trim().length > 0)];
}

/** The attached skill a `read_skill` key names: the exact key, or a bare library key (`cold_email` for `library_cold_email`). */
export function findAttachedSkill(skills: readonly AttachedSkill[], key: string): AttachedSkill | undefined {
  const k = key.trim();
  return skills.find((s) => s.key === k) ?? skills.find((s) => s.source === "library" && s.key === `${LIBRARY_SKILL_PREFIX}${k}`);
}

const STOP_WORDS = new Set(
  "the and for with from that this when your you are use asked into about what which their them they then than have has will would can its our out not any all one two new each more most some such only also how who why where".split(" "),
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

function overlap(query: ReadonlySet<string>, skill: AttachedSkill): number {
  let n = 0;
  for (const w of words(`${skill.name} ${skill.whenToUse}`)) if (query.has(w)) n++;
  return n;
}

export interface SelectSkillsInput {
  skills: readonly AttachedSkill[];
  task?: { kind: TaskKind; title: string; goal: string };
  /** A conversation's message, when there is no task. */
  message?: string;
  stage?: ProductStage;
  /** Training: the skill under test; it and the skills that `improve` it are loaded. */
  ratedSkillKey?: string;
  maxBodies: number;
}

/**
 * Every skill for the index, in the attached order, with `instructionsMd` set on the ones loaded: role skills always;
 * of the rest at most `maxBodies`, never past `SKILL_PRELOAD_MAX_CHARS` (role bodies count). Ranked by the rated skill
 * and its improvers (training), then a stage match, then word overlap with the task's title and goal (or the message).
 * With a task, message or rated skill, a skill that matches none of them is not loaded; with nothing to match against
 * (a one-call builder), the first in order are.
 */
export function selectSkills(input: SelectSkillsInput): AgentSkillPrompt[] {
  const query = words(input.task ? `${input.task.title} ${input.task.goal}` : (input.message ?? ""));
  const hasSignal = query.size > 0 || input.ratedSkillKey !== undefined;
  const rated = input.ratedSkillKey;
  const ranked = input.skills
    .map((s, i) => {
      const ratedRank = rated === undefined ? 0 : s.key === rated ? 2 : s.improves?.includes(rated) ? 1 : 0;
      const stage = input.stage !== undefined && s.stages?.includes(input.stage) ? 1 : 0;
      return { s, i, ratedRank, stage, overlap: overlap(query, s) };
    })
    .filter((r) => r.s.source !== "role")
    .filter((r) => !hasSignal || r.ratedRank > 0 || r.overlap > 0)
    .sort((a, b) => b.ratedRank - a.ratedRank || b.stage - a.stage || b.overlap - a.overlap || a.i - b.i);
  let chars = input.skills.filter((s) => s.source === "role").reduce((n, s) => n + s.instructionsMd.length, 0);
  const loaded = new Set<string>();
  for (const r of ranked) {
    if (loaded.size >= input.maxBodies) break;
    if (chars + r.s.instructionsMd.length > SKILL_PRELOAD_MAX_CHARS) continue;
    chars += r.s.instructionsMd.length;
    loaded.add(r.s.key);
  }
  return input.skills.map((s) => {
    const prompt: AgentSkillPrompt = { key: s.key, name: s.name, source: s.source, whenToUse: s.whenToUse };
    return s.source === "role" || loaded.has(s.key) ? { ...prompt, instructionsMd: s.instructionsMd } : prompt;
  });
}
