/**
 * The quick profile (WP-14 T2; founder's answer A5, 2026-11-17): what the first profile's skill tags say about the
 * five skill ratings, and how Founder fit follows the ratings without a model call.
 *
 * The first profile asks "What are you good at, or enjoy?" with five suggested tags, one for each skill the long
 * profile rates from 1 to 20. A picked tag sets a strong starting rating and an unpicked one a modest rating; a person
 * who picks none starts on the neutral rating for all five. These are the person's own stated answers at lower
 * precision (two values, not twenty): never measured, never inferred from anything else. The long profile ("sharpen")
 * replaces them with the ratings the person sets themselves.
 *
 * Pure, no dependencies: the web, the api and the design system all read it.
 */

/**
 * The two ratings of the quick profile, and the neutral one. **Proposed by the session that built WP-14 T2 and flagged
 * for the founder** (the brief suggests 14 and 7 of 20): 14 is the top of "Good" on the rating ramp, 7 sits below the
 * neutral 10 so an unpicked skill reads as "the team covers this" without reading as a weakness the person stated.
 */
export const QUICK_PROFILE_RATINGS = { picked: 14, unpicked: 7, neutral: 10 } as const;

export const QUICK_PROFILE_SKILLS = ["engineering", "sales", "design", "finance", "domain"] as const;
export type QuickProfileSkill = (typeof QUICK_PROFILE_SKILLS)[number];

/** The five suggested tags, one for each skill, in the order the form offers them. */
export const QUICK_PROFILE_TAGS: readonly { tag: string; skill: QuickProfileSkill }[] = [
  { tag: "Building software", skill: "engineering" },
  { tag: "Finding and winning customers", skill: "sales" },
  { tag: "Product and brand", skill: "design" },
  { tag: "Money and pricing", skill: "finance" },
  { tag: "I know my market", skill: "domain" },
];

/**
 * The five ratings a set of tags stands for: `picked` for a skill whose tag is among them (case aside), `unpicked` for
 * the rest; all `neutral` when none of the five tags was picked (the question was skipped, or only the person's own
 * tags were typed, which say nothing about the five).
 */
export function quickSkillRatings(tags: readonly string[]): Record<QuickProfileSkill, number> {
  const chosen = new Set(tags.map((t) => t.trim().toLowerCase()));
  const picked = QUICK_PROFILE_TAGS.filter((t) => chosen.has(t.tag.toLowerCase())).map((t) => t.skill);
  const { neutral, unpicked } = QUICK_PROFILE_RATINGS;
  return Object.fromEntries(QUICK_PROFILE_SKILLS.map((s) => [s, picked.length === 0 ? neutral : picked.includes(s) ? QUICK_PROFILE_RATINGS.picked : unpicked])) as Record<QuickProfileSkill, number>;
}

/** The two skills each kind of business leans on most (the archetype keys of @foundmill/shared `ARCHETYPES`). */
const ARCHETYPE_SKILLS: Record<string, readonly [QuickProfileSkill, QuickProfileSkill]> = {
  b2b_saas: ["engineering", "sales"],
  consumer_app: ["design", "engineering"],
  marketplace: ["sales", "domain"],
  dtc_physical: ["design", "domain"],
  hardware: ["engineering", "domain"],
  services: ["domain", "sales"],
  content_media: ["domain", "design"],
};

const rating = (skills: Readonly<Record<string, unknown>> | null | undefined, key: string): number => {
  const v = skills?.[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.min(20, Math.max(1, v)) : QUICK_PROFILE_RATINGS.neutral;
};

/**
 * How well a set of skill ratings suits a kind of business, 1 to 20: the mean of the two skills it leans on most. A
 * skill with no rating counts as neutral, and so does every skill for a kind of business not listed.
 */
export function skillsFit(skills: Readonly<Record<string, unknown>> | null | undefined, archetype: string | null | undefined): number {
  const pair = archetype ? ARCHETYPE_SKILLS[archetype] : undefined;
  if (!pair) return QUICK_PROFILE_RATINGS.neutral;
  return Math.round((rating(skills, pair[0]) + rating(skills, pair[1])) / 2);
}

/**
 * Founder fit after the person's skill ratings changed, without a model call: the rating the card has, moved by how
 * much the two skills its kind of business leans on moved. A card rated with no profile was rated against neutral
 * skills, so `before` is null (or empty) for it. Clamped to 1 to 20; a card with no fit rating starts from neutral.
 */
export function reratedFounderFit(current: number | null | undefined, before: Readonly<Record<string, unknown>> | null | undefined, after: Readonly<Record<string, unknown>> | null | undefined, archetype: string | null | undefined): number {
  const start = typeof current === "number" && Number.isFinite(current) ? current : QUICK_PROFILE_RATINGS.neutral;
  return Math.min(20, Math.max(1, Math.round(start + skillsFit(after, archetype) - skillsFit(before, archetype))));
}

/** What a Founder fit number rests on: the quick profile's answers, or the long profile once it is saved. */
export type FitBasis = "quick" | "full";

/**
 * The long profile requires the experience answer and the first profile never asks it, so a profile with an experience
 * went through the long form: its ratings are the person's own, one by one.
 */
export function fitBasisOf(profile: { experience?: string | null } | null | undefined): FitBasis {
  return profile?.experience ? "full" : "quick";
}

/** "Fit: 15 (quick profile)" until the long profile is saved; "Fit: 15" after. */
export const QUICK_FIT_BASIS_WORDS = "quick profile";
export function fitLine(value: number, basis: FitBasis): string {
  return basis === "quick" ? `Fit: ${value} (${QUICK_FIT_BASIS_WORDS})` : `Fit: ${value}`;
}

/**
 * What a person's profile must say before they take charge of a project (founder's answer A5, 2026-11-17): how much
 * time they can give and where they live. The first profile asks both and lets a person go on without; Commit asks
 * whoever has not answered, and `idea.commit` refuses without both.
 */
export const TAKE_CHARGE_NEEDS = ["timeCommitment", "residence"] as const;
export type TakeChargeNeed = (typeof TAKE_CHARGE_NEEDS)[number];
export const TAKE_CHARGE_NEEDS_REASON = "profile_incomplete";
export const TAKE_CHARGE_NEEDS_MESSAGE = "Tell your team how much time you can give and where you live, then start your project.";

/** Which of the two the profile (or the answers so far) still lacks, in the order they are asked. */
export function takeChargeMissing(about: { timeCommitment?: string | null; residence?: string | null } | null | undefined): TakeChargeNeed[] {
  return TAKE_CHARGE_NEEDS.filter((k) => !about?.[k]?.trim());
}
