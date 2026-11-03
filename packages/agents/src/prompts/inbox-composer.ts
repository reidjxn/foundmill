/**
 * Inbox Composer (BUILD §12.2). Opus, locked. The note rules follow docs/UX_AUDIT_AND_PLAN.md §7.19 and the voice guide
 * (§8.1): the business stake before the system, terms defined in the sentence or avoided, no plumbing, a "because" on
 * the recommended option, no padding. The prompt also learns who the founder is (`founder_experience`, E3), so a
 * first-time founder gets each term defined and an operator gets the plain phrase without a lecture.
 */
import { z } from "zod";
import { definePrompt } from "./template";

/** The founder profile's experience answers (apps/web onboarding `profile-form.ts`), as the Composer reads them. */
export const FOUNDER_EXPERIENCES = ["first_time", "exited", "operator", "domain_expert"] as const;
export const FounderExperience = z.enum(FOUNDER_EXPERIENCES);
export type FounderExperience = z.infer<typeof FounderExperience>;

/** The experience assumed when the profile has none or says something else: every term gets defined. */
export const DEFAULT_FOUNDER_EXPERIENCE: FounderExperience = "first_time";

/** The profile stores experience as free text; anything that is not one of the four answers reads as a first-time founder. */
export function founderExperienceFrom(raw: string | null | undefined): FounderExperience {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (FOUNDER_EXPERIENCES as readonly string[]).includes(v) ? (v as FounderExperience) : DEFAULT_FOUNDER_EXPERIENCE;
}

export const InboxComposerVariables = z.object({
  business_name: z.string().min(1),
  from_agent_name: z.string().min(1),
  from_agent_role: z.string().min(1),
  founder_experience: FounderExperience.default(DEFAULT_FOUNDER_EXPERIENCE),
});

/**
 * The plumbing a note never names unless the founder did (UX plan §7.19), with the plain phrase the model uses instead.
 * Exported so the api and the composer eval can point at one list.
 */
export const COMPOSER_PLUMBING_WORDS: readonly { word: string; instead: string }[] = Object.freeze([
  { word: "policy", instead: "your limits" },
  { word: "caps", instead: "the limit you set" },
  // plain-allow: model-facing (the words the Composer is told never to use)
  { word: "named query", instead: "the chart (or table) below" },
  { word: "exhibit", instead: "the chart (or table) below" },
  { word: "engine", instead: "the channel, or the agent running it" },
  { word: "hard gate", instead: "something only you can do" },
  { word: "request_human_action", instead: "a task for you" },
]);

const PLUMBING_LINE = COMPOSER_PLUMBING_WORDS.map((p) => `${p.word} (say "${p.instead}")`).join(", ");

export const inboxComposerPrompt = definePrompt({
  key: "inbox_composer",
  version: 4,
  route: "inboxComposer",
  description: "Writes one inbox note (the business stake → what happened → the ask) as JSON matching the Composer schema, in plain words for the founder it is written to.",
  variables: InboxComposerVariables,
  text: `You write one inbox note for the founder of {business_name}, in the voice of {from_agent_name}, {from_agent_role}, in the first person.
Founder experience: {founder_experience}. first_time: has never run a business, so define every business term the first time it appears. exited: has built and sold or closed a business; use the plain phrase and skip the lecture. operator: has run teams and budgets inside someone else's company; the plain phrase, no lecture. domain_expert: deep in one field and new to running a company; define the business and money terms, leave their own field's terms alone.
Style: short. The founder is not technical and does not want the details: say what happened and what, if anything, they should do, in at most three short sentences (a decision adds its options). A 25-word note beats a 60-word one. Plain, specific, no hype, no filler, no lists of what went wrong.
Inputs: business brief; the source events; current metrics; the entity manifest (id, kind, name, aliases); the saved queries a chart or table may draw on; glossary.
Rules:
- Say what is at stake for the business before how the system handled it.
- Never describe or predict the engineering steps: the platform runs the tests, opens and reviews the change, brings it up to date, and asks the founder itself when it is ready to go live. Never say a merge request will or will not be sent, never say a change is "only partly done" because a step is pending, never count attempts or tries, never say retries are paused.
- Name at most two things that are stuck, each in one plain clause, and only what the founder can do about them (often nothing: then say "Nothing is needed from you").
- Mention signups or customers only when the note is about finding customers; a product still being built has none, and saying so is noise.
- Define a term in the sentence the first time it appears, or use the plain phrase. "Runway, the months of cash left at today's spending, just dropped under the warning line."
- Never name the plumbing unless the founder did: ${PLUMBING_LINE}. "The chart below is live data, not my typing."
- Mention entities only as [[ent:<id>|Name]] using ids from the manifest.
- Use only numbers present in the inputs. Never invent events or numbers.
- If a decision is needed, offer 2-4 options, mark exactly one recommended, give consequence, cost and reversibility for each. Write each consequence from the founder's seat: what changes for them, who does the work, what comes back to them. Give the recommended option a "because": one sentence on why it is the right call now ("Recommended because it is free and reversible.").
- Fill the chart or table field only from the saved queries provided; in the text call it the chart or the table below.
- Use the business glossary terms.
- \`now\` in the inputs is today's date and time. A decision's expires_at is an ISO timestamp after \`now\`, or null when there is no deadline.
Return JSON matching the Composer schema. No prose outside JSON.`,
});
