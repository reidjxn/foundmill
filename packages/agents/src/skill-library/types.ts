/**
 * The library skill's shape. The skills themselves are Markdown files under packages/agents/skills, compiled into
 * `catalog.generated.ts` by scripts/build-skill-library.mjs, which reads SKILL_LIBRARY_CATEGORIES from this file.
 */
import type { SkillGroup } from "@foundmill/shared";

export const SKILL_LIBRARY_CATEGORIES = ["product", "engineering", "marketing", "sales", "finance", "legal", "operations"] as const;
export type SkillLibraryCategory = (typeof SKILL_LIBRARY_CATEGORIES)[number];

export interface LibrarySkill {
  /** Stable catalog key (snake case); the agent's skill key is `library_<key>`. */
  key: string;
  /** What the founder picks in the library. */
  name: string;
  description: string;
  category: SkillLibraryCategory;
  /** The attribute rating it shows as on the agent's profile. */
  attribute: { name: string; group: SkillGroup };
  /** The text's version: 1, raised each time the body changes. */
  version: number;
  /** The instructions the agent receives, in Markdown: the whole body of the skill's file, also what a person reads. */
  instructionsMd: string;
}
