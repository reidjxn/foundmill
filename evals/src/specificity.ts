/**
 * Specificity check (WP-08 T12): a marketing output (channel creative, a post draft, a follower update) is about the
 * person and the difference in the project's approved positioning notes, and invents no proof. Deterministic, offline:
 * words are compared, nothing is asked of a model.
 *   - the output names the person of section 1 (shares a content word with its first line);
 *   - and one difference of section 4 (shares a content word with one of its lines);
 *   - and carries no figure or quotation that section 5 (proof) does not.
 */
import type { PositioningNotes } from "@foundmill/shared";

const STOP = new Set(["that", "this", "with", "from", "have", "your", "their", "they", "them", "what", "when", "which", "will", "would", "about", "into", "than", "then", "there", "were", "been", "being", "more", "most", "some", "such", "only", "also", "people", "person"]);
const words = (text: string): Set<string> => new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)));
const shares = (a: Set<string>, b: Set<string>): boolean => [...a].some((w) => b.has(w));
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

export function specificityProblems(output: string, positioning: PositioningNotes): string[] {
  const problems: string[] = [];
  const out = words(output);
  const person = positioning.forWhom[0]?.text ?? "";
  if (person && !shares(out, words(person))) problems.push("does not name the person the project is for");
  if (positioning.different.length > 0 && !positioning.different.some((l) => shares(out, words(l.text)))) problems.push("names no difference from the project's notes");
  const proof = positioning.proof.map((l) => l.text).join("\n");
  const known = new Set(proof.match(NUMBER_RE) ?? []);
  for (const n of output.match(NUMBER_RE) ?? []) if (!known.has(n)) problems.push(`a figure the proof does not give: ${n}`);
  for (const q of output.match(/["“][^"”]{3,}["”]/g) ?? []) if (!proof.includes(q.slice(1, -1))) problems.push(`a quotation the proof does not hold: ${q}`);
  return problems;
}
