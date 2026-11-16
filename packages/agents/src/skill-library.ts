/**
 * The skills library (founder request 2026-10-16): a curated, read-only catalog of skills a founder can add to any
 * agent, at hire or later from its profile. Each skill is a short set of instructions in Markdown that the runtime puts
 * in the agent's "## Skills" section, after the house rules (`buildSystemPrompt`), and the one attribute rating it shows
 * as on the profile (untested until a training run scores it).
 *
 * A skill teaches how to do a kind of work. It never changes the house rules, an agent's tools, autonomy, spend caps or
 * what needs approval: those come from elsewhere and policy gates every action. A test screens every entry here with
 * the same checks an uploaded skill file goes through (`screenSkill`).
 *
 * The source is one Markdown file per skill, packages/agents/skills/<category>/<key>.md (founder, Nov 16, 2026: D6).
 * scripts/build-skill-library.mjs (`pnpm --filter @foundmill/agents skills:build`) compiles them into the checked-in
 * `skill-library/catalog.generated.ts`, which carries each skill's full body, so the app can show a person its text.
 */
import type { ProductStage } from "@foundmill/shared";
import { SKILL_LIBRARY } from "./skill-library/catalog.generated";
import type { LibrarySkill, SkillLibraryCategory } from "./skill-library/types";

export { SKILL_LIBRARY } from "./skill-library/catalog.generated";
export { SKILL_LIBRARY_CATEGORIES, type LibrarySkill, type SkillLibraryCategory } from "./skill-library/types";

/** Areas of work, not department names (departments are the founder's labels over modules). */
export const SKILL_LIBRARY_CATEGORY_LABELS: Record<SkillLibraryCategory, string> = {
  product: "Product",
  engineering: "Engineering",
  design: "Design",
  marketing: "Marketing",
  sales: "Sales",
  customers: "Customers",
  finance: "Finance",
  legal: "Legal",
  operations: "Operations",
};

export const LIBRARY_SKILL_PREFIX = "library_";
export const UPLOAD_SKILL_PREFIX = "upload_";

const LIBRARY_BY_KEY: ReadonlyMap<string, LibrarySkill> = new Map(SKILL_LIBRARY.map((s) => [s.key, s]));

export function getLibrarySkill(key: string): LibrarySkill | undefined {
  return LIBRARY_BY_KEY.get(key);
}

/**
 * The library skills the picker suggests for an agent of `templateKey` (WP-06 T7): those whose `roles` hold the
 * template, the ones that fit the project's stage first, catalog order within each part. Chosen locally, with no model
 * call (as the agent builder ranks templates, 2026-10-07).
 */
export function suggestFor(templateKey: string, stage: ProductStage): string[] {
  const forRole = SKILL_LIBRARY.filter((s) => s.roles.includes(templateKey));
  return [...forRole.filter((s) => s.stages.includes(stage)), ...forRole.filter((s) => !s.stages.includes(stage))].map((s) => s.key);
}

/**
 * The release of the role defaults (WP-06 T6): the highest `defaultSince` in the catalog. An agent records the release
 * it was given (`agents.default_skills_version`); a later release that adds a default gives it the next integer, so the
 * backfill offers only that one and never a default the founder removed.
 */
export const DEFAULT_SKILLS_VERSION: number = Math.max(0, ...SKILL_LIBRARY.filter((s) => s.defaultFor.length > 0).map((s) => s.defaultSince));

/**
 * The library skills an agent of `templateKey` comes with (founder, Nov 16, 2026: every role gets its defaults at hire,
 * marked "Came with the role" and removable), in catalog order; with `sinceVersion`, only those added after that
 * release. `library` is for tests.
 */
export function defaultSkillKeysFor(templateKey: string, sinceVersion = 0, library: readonly LibrarySkill[] = SKILL_LIBRARY): string[] {
  return library.filter((s) => s.defaultFor.includes(templateKey) && s.defaultSince > sinceVersion).map((s) => s.key);
}

/** The agent's skill key for a library skill (`press_releases` → `library_press_releases`). */
export function librarySkillKey(key: string): string {
  return `${LIBRARY_SKILL_PREFIX}${key}`;
}

/**
 * The agent's skill key for an uploaded skill file: its name in snake case and the first eight hex digits of the file's
 * content hash, so the same file is one skill and a different file with the same name is another.
 */
export function uploadSkillKey(name: string, contentHash: string): string {
  const snake = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${UPLOAD_SKILL_PREFIX}${snake || "skill"}_${contentHash.slice(0, 8).toLowerCase()}`;
}

/** A skill the founder added from the library or a file (its instructions reach the prompt's "## Skills" section). */
export function isAddedSkillKey(key: string): boolean {
  return key.startsWith(LIBRARY_SKILL_PREFIX) || key.startsWith(UPLOAD_SKILL_PREFIX);
}
