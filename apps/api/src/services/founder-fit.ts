/**
 * Founder fit follows the person's skill ratings without a model call (WP-14 T2).
 *
 * A card kept from the landing page's idea box was rated before anything was known about the person; the first
 * profile then states five quick ratings (`quickSkillRatings`), and the long profile later replaces them with the
 * person's own ("sharpen"). Each time the ratings change, every idea the person still holds has its Founder fit moved
 * by how much the two skills its kind of business leans on moved (`reratedFounderFit`), in place. The evidence says
 * what the number rests on, in the person's terms: their stated answers, never something measured or inferred.
 *
 * Never fails the profile save: the caller catches and logs.
 */
import { fitBasisOf, reratedFounderFit } from "@foundmill/config";
import { repos, type Db } from "@foundmill/db";

type Skills = Readonly<Record<string, number>> | null | undefined;

/** What a re-rated card says under Founder fit. */
export const FIT_EVIDENCE = {
  quick: "Based on your quick answers about what you are good at. Sharpen your profile to make it more exact.",
  full: "Based on the skills you rated in your profile.",
} as const;

const SKILLS = ["engineering", "sales", "design", "finance", "domain"] as const;
const same = (a: Skills, b: Skills) => SKILLS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

/**
 * Re-rates the person's ideas when their skill ratings changed from `before` (null: there was no profile) to those of
 * `after`. Answers how many cards changed; 0 without touching anything when the ratings are the same.
 */
export async function rerateFitForProfileChange(db: Db, userId: string, before: Skills, after: { skills: Skills; experience?: string | null }): Promise<number> {
  if (same(before, after.skills)) return 0;
  const evidence = FIT_EVIDENCE[fitBasisOf(after)];
  return repos.ideas.rerateFounderFit(db, userId, (current, archetype) => ({ value: reratedFounderFit(current, before, after.skills, archetype), evidence }));
}
