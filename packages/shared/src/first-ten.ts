/**
 * The first ten conversations (WP-08 T5; founder-led outreach, audit GTM-11, GTM-15; docs/holistic-plan/WP-08). Ten slots
 * for people the founder knows or can reach, moved by hand from "To ask" to "Wants it". No model call and no outside
 * send: the founder copies a message and sends it themselves. A person here is a CRM record (source `first_ten`, role
 * `lead`); what they said is a note. A note the founder wrote is never an outcome of the project.
 * Pure, no Zod: browser code imports this from "@foundmill/shared/first-ten".
 */
export const FIRST_TEN_SOURCE = "first_ten";
export const FIRST_TEN_BASIS = "The founder knows this person";
export const FIRST_TEN_SLOTS = 10;
/** The notes this board writes begin with this, so `read_positioning` can hand agents what real people said. */
export const FIRST_TEN_SAID = "Said: ";
export const FIRST_TEN_NAME_MAX = 80;
export const FIRST_TEN_WORDS_MAX = 600;

export const FIRST_TEN_STAGES = ["to_ask", "asked", "talked", "wants_it", "not_for_them"] as const;
export type FirstTenStage = (typeof FIRST_TEN_STAGES)[number];
export const FIRST_TEN_STAGE_LABELS: Readonly<Record<FirstTenStage, string>> = { to_ask: "To ask", asked: "Asked", talked: "Talked", wants_it: "Wants it", not_for_them: "Not for them" };
export const isFirstTenStage = (v: unknown): v is FirstTenStage => typeof v === "string" && (FIRST_TEN_STAGES as readonly string[]).includes(v);

/** Three fixed, non-leading questions: what happened last time, what they tried, what would make it worth their time. */
export const FIRST_TEN_QUESTIONS = ["When did you last run into this, and what did you do?", "What have you tried so far to deal with it?", "What would make it worth your time to fix?"] as const;

export const FIRST_TEN_WORDS = {
  title: "First ten",
  empty: "Ten people to talk to, one at a time. Add someone you know, copy a message, and write down what they say.",
  add: "Add a person",
  namePlaceholder: "Their name",
  copy: "Copy a message",
  said: "What did they say?",
  save: "Save",
} as const;

/** The message to copy. Written here from the project's one line and the person's name; nothing is sent. */
export function firstTenMessage(input: { name: string; oneLine: string }, question: string = FIRST_TEN_QUESTIONS[0]): string {
  const name = input.name.replace(/\s+/g, " ").trim() || "there";
  const line = input.oneLine.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  return `Hi ${name}, I'm working on ${line || "a project"}. Can I ask you one question about it? ${question}`;
}

/** The stage a saved answer moves a person to: asking or waiting becomes talked; the rest stay where they are. */
export const stageAfterHeard = (stage: string | null): FirstTenStage | string | null => (stage === "to_ask" || stage === "asked" ? "talked" : stage);
