/**
 * Small helpers for text people read that services build (Inbox notes, summaries, agent prose): US English counts and
 * dates (CLAUDE.md 2026-10-10: en-US numbers, "Oct 7, 2026"), so a service never prints "1 months", "1674 orders" or
 * an ISO date. UI code formats through the dugout helpers, which also follow the signed-in person's date preference;
 * these are for copy written once and stored or sent as it is.
 */
export const COPY_LOCALE = "en-US";

const COUNT = new Intl.NumberFormat(COPY_LOCALE, { maximumFractionDigits: 0 });

/** 1674 → "1,674". */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** "1 month", "24 months", "1,674 orders": a count with its noun (pass the plural when it is irregular). */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "Oct 18, 2026" (or "Oct 18" with `year: false`), read in UTC so every reader sees the same day. */
export function usDate(at: Date | string | number, opts: { year?: boolean } = {}): string {
  const d = at instanceof Date ? at : new Date(at);
  return d.toLocaleDateString(COPY_LOCALE, { month: "short", day: "numeric", ...(opts.year === false ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** "a" or "an" for the word that follows: "an Email automation task", "an ops task", "a SEO task" reads "an SEO task". */
export function indefiniteArticle(word: string): "a" | "an" {
  const w = word.trim();
  if (!w) return "a";
  // Initialisms are read letter by letter: "an SEO task", "an MRR goal", "a CRM note".
  if (/^[A-Z]{2,}\b/.test(w)) return /^[AEFHILMNORSX]/.test(w) ? "an" : "a";
  // Words that sound like "you" or "one" take "a"; a silent h takes "an".
  if (/^(?:uni|use|usu|uti|uri|eu|one|once)/i.test(w)) return "a";
  if (/^(?:hour|honest|honor|heir)/i.test(w)) return "an";
  return /^[aeiou]/i.test(w) ? "an" : "a";
}

/** "an Email automation task": the word with its article. */
export function withArticle(word: string): string {
  return `${indefiniteArticle(word)} ${word}`;
}

/** Ends a sentence once: "Where should it come from?" stays as it is, "Decided" becomes "Decided.". */
export function endSentence(text: string): string {
  const t = text.trimEnd();
  return /[.!?…]["')\]]*$/.test(t) ? t : `${t}.`;
}

/**
 * A note's leading heading, when more text follows it: a markdown heading line ("# Weekly report"), a bold run on its
 * own line ("**Vision**"), or a bold label that ends in a mark ("**Vision.** We sell …", "**Why:** …"). A bold run
 * that opens a sentence ("**Atlas** needs a yes.") is not a heading.
 */
function dropLeadingHeading(md: string): string {
  const text = md.trimStart();
  const heading = /^#{1,6}[ \t][^\n]*(?:\n|$)/.exec(text);
  if (heading) {
    const rest = text.slice(heading[0].length);
    return rest.trim() ? rest : text;
  }
  const bold = /^(\*\*|__)([^\n]+?)\1/.exec(text);
  if (!bold) return text;
  const rest = text.slice(bold[0].length);
  const ownLine = /^[ \t]*(?:\n|$)/.test(rest);
  const label = /[.:!?]$/.test(bold[2]!.trim());
  return (ownLine || label) && rest.trim() ? rest : text;
}

/**
 * The preview line of a note (Inbox rows, Home's Inbox widget): the first sentence of the body with entity markup and
 * markdown stripped, skipping a leading heading so a note that opens "**Vision.**" previews its first real sentence.
 * Cut to `max` characters with an ellipsis.
 */
export function notePreview(bodyMd: string, max = 120): string {
  const plain = dropLeadingHeading(bodyMd.replace(/\[\[ent:[^|\]]+\|([^\]]+)\]\]/g, "$1"))
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const end = plain.search(/[.!?](\s|$)/);
  const line = end > 0 ? plain.slice(0, end + 1) : plain;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
