/** Chapter title (BUILD §11.2 "Chapters: one per quarter, titled by Opus"; ARCHITECTURE §11 composer /v1/chapter-title). */
import { z } from "zod";
import { definePrompt } from "./template";

export const ChapterTitleVariables = z.object({
  business_name: z.string().min(1),
  /** e.g. "Q3 2026" */
  quarter_label: z.string().min(1),
  /** Quarter facts: customers won, revenue, releases, decisions, milestones; all real numbers from journey_daily. */
  quarter_facts: z.string().min(1),
});

export const chapterTitlePrompt = definePrompt({
  key: "chapter_title",
  version: 1,
  route: "inboxComposer",
  description: "Names a quarter of the Journey Ribbon like a chapter of a story, grounded only in the quarter's facts.",
  variables: ChapterTitleVariables,
  text: `Title the {quarter_label} chapter of {business_name}'s story. Facts: {quarter_facts}
Return JSON {{"title" (3-6 words, no quotes, no punctuation at the end), "subtitle" (<= 20 words, cites one fact from the input), "mood": "rising|steady|turbulent|breakthrough"}}.
Never mention numbers that are not in the facts. No hype words (revolutionary, game-changing, unprecedented). Output JSON only.`,
});
