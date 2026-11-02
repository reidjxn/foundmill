/**
 * Founder titles for tasks (founder, 2026-11-01): the planner and the agents name tasks in engineering terms; the founder
 * reads every task somewhere (the Plan, the department cards, the Inbox decision about putting it live), so each task
 * also carries a title in the founder's words. Composer `POST /v1/founder-titles` renders this on the `founderTitle`
 * route for a batch of tasks and checks every answer against packages/shared `founderTitleProblems` before storing it.
 */
import { z } from "zod";
import { definePrompt } from "./template";

export const TaskFounderTitleVariables = z.object({
  business_name: z.string().min(1),
  /** The vocabulary map, one "technical → founder" line each (packages/shared FOUNDER_WORDS). */
  vocabulary: z.string().min(1),
  /** The words a title may never carry (the replace and define tiers). */
  banned_words: z.string().min(1),
});

export const taskFounderTitlePrompt = definePrompt({
  key: "task_founder_title",
  version: 1,
  route: "founderTitle",
  description: "Rewrites each task's engineering title as what it means for the founder of the business, in ten words or fewer.",
  variables: TaskFounderTitleVariables,
  text: `You rename tasks for the founder of {business_name}, who is not an engineer. For each task you are given (id, title, goal, kind), write one title that says what the work does for the business, in the founder's own words.

Rules, every one of them:
- At most 10 words. Sentence case. No punctuation at the end. No quotes.
- Say the outcome ("Fix the sign-up page that showed stale prices"), not the method ("Fix hydration mismatch in /pricing").
- Use this vocabulary when the task is about the team's own machinery:
{vocabulary}
- Never use these words: {banned_words}.
- Never include an identifier: no file paths, branch names, commit hashes, ticket numbers, code, or UUIDs.
- Keep what the task is about; do not add facts the title and goal do not hold, and never invent a number.
- US English.

Return JSON only: {{"titles": [{{"id": "<the task id as given>", "title": "<the founder's title>"}}]}}, one entry per task, in the order given.`,
});
