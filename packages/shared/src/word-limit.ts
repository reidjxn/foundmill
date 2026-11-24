/**
 * Word limits a task states for the whole reply (live evals, Nov 24, 2026): read by the eval harness and by the
 * platform's save_report, which sends an over-limit report back once to be rewritten. Never a cut.
 */

/**
 * The word limit a task states for the whole reply: "Under 300 words." or "in under 150 words:", a limit that ends its
 * sentence or introduces the parts. A limit on one part ("a pitch under 150 words that ...", "a quote under 25 words)")
 * is not the reply's. The smallest when a task states several; null when it states none. Models cannot count their own
 * words, so a reply that runs over is sent back once to be rewritten (`lengthRetryMessage`), the pattern the showcase
 * script already uses.
 */
export function statedWordLimit(task: string): number | null {
  const limits = [...task.matchAll(/\b(?:under|at most|no more than|fewer than)\s+(\d{2,4})\s+words(?=\s*(?:[.:]|$))/gi)].map((m) => Number(m[1]));
  return limits.length ? Math.min(...limits) : null;
}

/** The one follow-up turn for a reply over the task's word limit. */
export function lengthRetryMessage(words: number, limit: number): string {
  return `Your reply has ${words} words; the task allows at most ${limit}. Rewrite it to fit with room to spare: keep every part the task asks for and its record ids, and cut everything else (headings, notes, sources lists, restated context). Reply with the rewritten deliverable only.`;
}

export function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

