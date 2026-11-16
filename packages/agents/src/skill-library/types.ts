/**
 * The library skill's shape. The skills themselves are Markdown files under packages/agents/skills, compiled into
 * `catalog.generated.ts` by scripts/build-skill-library.mjs, which reads SKILL_LIBRARY_CATEGORIES from this file.
 * The files use the authoring spec's words (`stage`, `needs`, `adapted_from`, `license_note`); the generator maps them
 * to the fields below (packages/agents/skills/README.md, "How the fields reach the product").
 */
import type { ProductStage, SkillGroup } from "@foundmill/shared";
import type { ConnectorKey } from "../connectors";

export const SKILL_LIBRARY_CATEGORIES = ["product", "engineering", "design", "marketing", "sales", "customers", "finance", "legal", "operations"] as const;
export type SkillLibraryCategory = (typeof SKILL_LIBRARY_CATEGORIES)[number];

/** A connector that unlocks the skill's "do it" path. Every library skill still works without it. */
export interface SkillRequirement {
  connectorKey: ConnectorKey;
  mode: "better_with";
}

/** Where the text comes from: written for Foundmill, or adapted from an open-source skill under its license. */
export interface SkillProvenance {
  origin: "foundmill" | "adapted";
  /** `collection:skill` for each adapted source (the collection is listed in skills/THIRD_PARTY_NOTICES.md). */
  sources: readonly string[];
  /** The adapted text's license (MIT or Apache-2.0); null for Foundmill's own. */
  license: string | null;
  /** The copyright line of an adapted skill, or what an original one was written after; null when there is none. */
  note: string | null;
}

export interface LibrarySkill {
  /** Stable catalog key (snake case); the agent's skill key is `library_<key>`. */
  key: string;
  /** What the founder picks in the library. */
  name: string;
  description: string;
  category: SkillLibraryCategory;
  /** The attribute rating it shows as on the agent's profile. */
  attribute: { name: string; group: SkillGroup };
  /** The line an agent reads in its skill index: at most 160 characters, starts with "Use when". */
  whenToUse: string;
  /** Hireable template keys the skill is suggested for. */
  roles: readonly string[];
  /** Templates that receive it at hire (a subset of `roles`); attached from T6 on. */
  defaultFor: readonly string[];
  /** The defaults version that first attached it (WP-06 T6); 1 for every skill moved in by T3. */
  defaultSince: number;
  /** The project stages it fits. */
  stages: readonly ProductStage[];
  /** Connectors that make it better; it works without them. */
  requires: readonly SkillRequirement[];
  /** Tools it would use that Foundmill has not built yet, as plain names (shown in the picker only). */
  notYetOnFoundmill: readonly string[];
  /** Rated skill keys (SKILL_DEFINITIONS) this one sharpens. */
  improves: readonly string[];
  /** The text's version: 1, raised each time the body changes. */
  version: number;
  /** The instructions the agent receives, in Markdown: the whole body of the skill's file, also what a person reads. */
  instructionsMd: string;
  provenance: SkillProvenance;
}
