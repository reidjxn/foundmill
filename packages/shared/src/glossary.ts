/**
 * The business glossary (BUILD §11.13, Settings › Glossary): the founder's own words for the product's nouns
 * ("customer" → "client", "team" → "crew"). One deterministic substitution, used for panel captions and labels (the
 * widgets' `useGlossary`) and for every Inbox note before it is stored (`repos.inbox.createItem`), so a rename shows
 * everywhere and not only in model prose.
 *
 * Rules: terms match whole words in any case; a plain plural of a term ("customers") takes the plural of the
 * replacement ("clients") unless the glossary names that plural itself; the match's case carries over ("Customers" →
 * "Clients", "CUSTOMERS" → "CLIENTS"). Entity mentions (`[[ent:<uuid>|Name]]`), inline code and links are never
 * rewritten, and the text is read once, left to right, so a swap ("lead" ↔ "prospect") does not undo itself.
 */
export type Glossary = Readonly<Record<string, string>>;

/** Keys the business stores in the same map that are settings, not words to rename. */
const NOT_TERMS = new Set(["currency"]);

/** The glossary's renaming entries: lower-case word terms with a replacement, longest first. */
export function glossaryTerms(glossary: Glossary | null | undefined): [string, string][] {
  return Object.entries(glossary ?? {})
    .map(([term, replacement]) => [term.trim().toLowerCase(), typeof replacement === "string" ? replacement.trim() : ""] as [string, string])
    .filter(([term, replacement]) => term.length > 0 && replacement.length > 0 && !NOT_TERMS.has(term) && /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u.test(term) && term !== replacement.toLowerCase())
    .sort((a, b) => b[0].length - a[0].length);
}

/** "client" → "clients", "patient" → "patients", "agency" → "agencies", "business" → "businesses". */
export function pluralOf(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}${word.endsWith("Y") ? "IES" : "ies"}`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}${word === word.toUpperCase() && /[A-Z]/.test(word) ? "ES" : "es"}`;
  return `${word}${word === word.toUpperCase() && /[A-Z]/.test(word) ? "S" : "s"}`;
}

/** The replacement in the case of what it replaces. */
function inCaseOf(match: string, replacement: string): string {
  const letters = match.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  if (match[0] && match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Spans never rewritten: entity mentions, inline code and links (markdown targets and bare URLs). */
const PROTECTED = /\[\[ent:[^\]]*\]\]|`[^`]*`|\]\([^)]*\)|https?:\/\/\S+/g;

/** Apply the glossary to a piece of text; the text comes back unchanged with an empty glossary. */
export function applyGlossary(text: string, glossary: Glossary | null | undefined): string {
  const terms = glossaryTerms(glossary);
  if (!text || terms.length === 0) return text;
  const byWord = new Map<string, string>();
  for (const [term, replacement] of terms) {
    byWord.set(term, replacement);
    const plural = pluralOf(term);
    // Longest first, so a plural the glossary names itself ("customers") is already set and wins.
    if (!byWord.has(plural)) byWord.set(plural, pluralOf(replacement));
  }
  const words = [...byWord.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${words.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const rewrite = (part: string) => part.replace(pattern, (match: string) => inCaseOf(match, byWord.get(match.toLowerCase()) ?? match));
  let out = "";
  let last = 0;
  for (const m of text.matchAll(PROTECTED)) {
    out += rewrite(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + rewrite(text.slice(last));
}
