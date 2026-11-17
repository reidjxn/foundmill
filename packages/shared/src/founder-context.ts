/**
 * Who the founder is, as the Chief of Staff and the Composer read it (WP-04 T10): their first name, what they told us
 * about their experience, what they are good at and want to learn, what they are here for, whether they said they can
 * spend, and the first names of the other founders of the project. Built from the founder's own profile
 * (`repos.founders.contextFor`); a field they never filled is "not_said" (or null, or empty), never a guess.
 *
 * Solo is complete (founder, 2026-11-11): nothing here describes a one-person project as short of anyone. The other
 * founders appear only when there are some; a project with one founder carries no field about people at all.
 *
 * Pure, no Zod: the prompts receive `founderContextJson` as trusted JSON and the cycle brief `founderBriefSection`.
 */
import { PERSON_LOOKING_FOR, PERSON_TAGS_MAX, PERSON_TAG_MAX, type PersonLookingFor } from "./person-profile";

/** The founder profile's experience answers (apps/web onboarding `profile-form.ts`). */
export const FOUNDER_EXPERIENCES = ["first_time", "exited", "operator", "domain_expert"] as const;
export type FounderExperience = (typeof FOUNDER_EXPERIENCES)[number];

/** The experience assumed when the profile has none or says something else: every term gets defined. */
export const DEFAULT_FOUNDER_EXPERIENCE: FounderExperience = "first_time";

/** The profile stores experience as free text; anything that is not one of the four answers reads as a first-time founder. */
export function founderExperienceFrom(raw: string | null | undefined): FounderExperience {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (FOUNDER_EXPERIENCES as readonly string[]).includes(v) ? (v as FounderExperience) : DEFAULT_FOUNDER_EXPERIENCE;
}

/** Whether the founder said they can spend: none (budget 0), some (above 0), or not said (no budget on the profile). */
export type FounderBudget = "none" | "some" | "not_said";

export interface FounderContext {
  firstName: string | null;
  experience: FounderExperience;
  strengths: string[];
  wantsToLearn: string[];
  lookingFor: PersonLookingFor;
  budget: FounderBudget;
  /** The project's other founders (owners and cofounders), by first name. Empty for a project with one founder. */
  others: { firstName: string }[];
}

/** The profile fields the context is built from (a `founder_profiles` row, or none). */
export interface FounderContextSource {
  displayName: string | null;
  experience: string | null;
  strengths: readonly string[];
  wantsToLearn: readonly string[];
  lookingFor: string | null;
  budgetMinor: number | null;
}

export const FIRST_NAME_MAX = 40;

/** The context when nothing is known: no name, first-time, nothing said. */
export const UNKNOWN_FOUNDER_CONTEXT: FounderContext = Object.freeze({ firstName: null, experience: DEFAULT_FOUNDER_EXPERIENCE, strengths: [], wantsToLearn: [], lookingFor: "on_my_own", budget: "not_said", others: [] }) as FounderContext;

/** The first word of a display name ("Maya Lopez" → "Maya"), or null when there is none. */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, FIRST_NAME_MAX) : null;
}

export function founderBudgetOf(budgetMinor: number | null | undefined): FounderBudget {
  if (typeof budgetMinor !== "number" || !Number.isFinite(budgetMinor)) return "not_said";
  return budgetMinor > 0 ? "some" : "none";
}

function tags(list: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of list ?? []) {
    const v = typeof t === "string" ? t.replace(/\s+/g, " ").trim().slice(0, PERSON_TAG_MAX) : "";
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= PERSON_TAGS_MAX) break;
  }
  return out;
}

/** The context for one founder of a project: their own profile (or none) and the other founders' display names. */
export function founderContextFrom(me: FounderContextSource | null, others: readonly { displayName: string | null }[] = []): FounderContext {
  const lookingFor = me && (PERSON_LOOKING_FOR as readonly string[]).includes(me.lookingFor ?? "") ? (me.lookingFor as PersonLookingFor) : "on_my_own";
  return {
    firstName: firstNameOf(me?.displayName),
    experience: founderExperienceFrom(me?.experience),
    strengths: tags(me?.strengths),
    wantsToLearn: tags(me?.wantsToLearn),
    lookingFor,
    budget: founderBudgetOf(me?.budgetMinor),
    others: others.flatMap((o) => {
      const firstName = firstNameOf(o.displayName);
      return firstName ? [{ firstName }] : [];
    }),
  };
}

const NOT_SAID = "not_said";

/**
 * The context as the prompts carry it (trusted JSON, snake case). Nothing unknown is filled in ("not_said"); the other
 * founders are listed only when there are some, so a one-person project's context says nothing about people.
 */
export function founderContextJson(ctx: FounderContext): Record<string, unknown> {
  return {
    first_name: ctx.firstName ?? NOT_SAID,
    experience: ctx.experience,
    good_at: ctx.strengths.length > 0 ? ctx.strengths : NOT_SAID,
    wants_to_learn: ctx.wantsToLearn.length > 0 ? ctx.wantsToLearn : NOT_SAID,
    here_for: ctx.lookingFor,
    budget: ctx.budget,
    ...(ctx.others.length > 0 ? { other_founders: ctx.others.map((o) => o.firstName) } : {}),
  };
}

const EXPERIENCE_WORDS: Record<FounderExperience, string> = {
  first_time: "running a business for the first time",
  exited: "has built a business before",
  operator: "has run teams and budgets before",
  domain_expert: "an expert in their field, new to running a company",
};

const BUDGET_WORDS: Record<FounderBudget, string> = { none: "nothing to spend for now", some: "some money to spend", not_said: "not said" };

const quoted = (list: readonly string[]) => list.map((t) => `"${t.replace(/"/g, "'")}"`).join(", ");

/** The cycle brief's "## Founder" section: who the team works with, in the same facts the prompts get. */
export function founderBriefSection(ctx: FounderContext): string {
  const lines = [`Name: ${ctx.firstName ?? "not said"}; ${EXPERIENCE_WORDS[ctx.experience]}.`];
  if (ctx.strengths.length > 0) lines.push(`Good at (their words): ${quoted(ctx.strengths)}.`);
  if (ctx.wantsToLearn.length > 0) lines.push(`Wants to learn (their words): ${quoted(ctx.wantsToLearn)}.`);
  lines.push(`Money: ${BUDGET_WORDS[ctx.budget]}; free options come first unless they said they can spend.`);
  if (ctx.others.length > 0) lines.push(`The founders: ${[ctx.firstName ?? "the founder", ...ctx.others.map((o) => o.firstName)].join(", ")}; write to them all.`);
  return `## Founder\n${lines.join("\n")}`;
}
