/**
 * The script of a showcase video (docs/THESIS_REVIEW.md §13 item 15; route `projectPage`, Sonnet at low effort): the
 * house business's social agent writes at most three shots, one per card of a project's public story, and the words of
 * the post the house would share with the video once every founder of the project said yes. Sent after the house rules
 * and the social agent's instructions; the project's name and its cards follow as trusted JSON. There is no untrusted
 * text in the request: every word of it is the platform's own (the labels are built from the milestone's key).
 *
 * The answer is words only, checked by code before it is stored (packages/agents `finaliseShowcaseScript`); the video
 * is made from the cards' own pictures, and posting is a person's tap after every founder's yes.
 */
import { z } from "zod";
import { definePrompt } from "./template";

export const ShowcaseScriptVariables = z.object({
  APP_NAME: z.string().min(1),
  /** The most characters the post may have. */
  max_chars: z.number().int().positive(),
});

export const showcaseScriptPrompt = definePrompt({
  key: "showcase_script",
  version: 1,
  route: "projectPage",
  description: "Writes the script of a short showcase video about a project's public milestones (at most three shots, the date and the milestone) and its post, from the project's public story only; invents nothing, says nothing about people.",
  variables: ShowcaseScriptVariables,
  text: `You write the script of a short video that {APP_NAME} would post about a project built on it, once every founder of the project has watched the final video and said yes. The video shows the project's public milestone cards one after another; you write the words on each card's shot and the short post that goes with the video. You only write words: nothing is posted by you.
Inputs: the JSON block in the request: project_name; cards, each with its code (card), the milestone's public words (label) and its date (on, and on_short without the year); max_chars.
Return JSON {{"shots", "post"}}:
- shots: one entry per card you use, at most three, in date order: {{"card": the card's code, "caption": the date and the milestone in a few words, such as "Nov 12: page live"}}. A caption names its own card's milestone and may name its date; nothing else.
- post: at most {max_chars} characters and two short sentences: the project's name and what its cards show, with their dates.
Rules:
- Say only what the cards say. Never invent anything: no numbers other than the cards' dates, no counts, no prices, no customers, followers, users, sign-ups, results, quotes, features or plans, and nothing that implies a result that did not happen.
- Nothing about people: no names, no "founder", "founders", "team" or "people", no he or she, and never how many people built it. Never say or suggest that anyone did it alone, solo, by themselves, without a cofounder or with nobody; never suggest anyone is missing.
- No rankings, comparisons or recency: never "top", "first to", "best", "fastest", "only", "record", "this week", "today", "just", "recently" or "already".
- Never give a reason for the project that is about jobs, employment, careers, money worries or what AI does to work.
- Plain US English, everyday words. No hype, no exclamation marks, no hashtags, no emoji, no links, no @mentions, no Markdown.
- Output JSON only.`,
});
