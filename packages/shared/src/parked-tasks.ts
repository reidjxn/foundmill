/**
 * Tasks the team parked because none of its agents has a tool for them (WP-05 T18). The founder (Nov 15, 2026, D1):
 * the round's note says so in one sentence, and that sentence always explains in plain language what is missing and
 * why it matters, not just the task's title. It is never a to-do, a decision or a Needs you item: the gap is the
 * platform's, so the sentence ends "nothing is needed from you".
 *
 * The orchestrator writes this sentence into a plain round note and the mock Composer ends its note with it; the live
 * Composer writes its own from the same facts (packages/agents `inboxComposerPrompt`).
 */

/** At most this many parked tasks are named in one note. */
export const PARKED_TASKS_MAX = 3;
/** A parked task's title is cut to this many characters. */
export const PARKED_TITLE_MAX = 120;
/** What the agent said about the missing tool is cut to this many characters before the Composer reads it. */
export const PARKED_DETAIL_MAX = 300;

/** One task the round parked: its title in the founder's words, and what the agent said was missing. */
export interface ParkedTask {
  title: string;
  detail?: string;
}

const COUNT_WORDS = ["", "One thing", "Two things", "Three things"] as const;

/** A title as it reads inside the sentence: one line, its own double quotes made single, no closing stop. */
function quoted(title: string): string {
  const t = title.replace(/\s+/g, " ").replace(/["“”]/g, "'").trim().replace(/[.!?;:,]+$/, "").slice(0, PARKED_TITLE_MAX);
  return `“${t}”`;
}

/**
 * The one sentence that says what the team parked: "One thing the team cannot do yet is “X”: none of the agents has a
 * tool for it, so that piece waits, parked, while the rest of the work goes on, and nothing is needed from you."
 * Empty when nothing is parked.
 */
export function parkedTasksSentence(titles: readonly string[]): string {
  const named = titles.filter((t) => t.trim().length > 0).slice(0, PARKED_TASKS_MAX).map(quoted);
  if (named.length === 0) return "";
  if (named.length === 1) return `One thing the team cannot do yet is ${named[0]}: none of the agents has a tool for it, so that piece waits, parked, while the rest of the work goes on, and nothing is needed from you.`;
  const list = `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `${COUNT_WORDS[named.length]} the team cannot do yet are ${list}: none of the agents has a tool for them, so those pieces wait, parked, while the rest of the work goes on, and nothing is needed from you.`;
}
