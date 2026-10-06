/**
 * Trigram similarity, implemented locally with pg_trgm's semantics so that the sweep's fuzzy tier agrees with the
 * `pg_trgm` index that backs CRM search (BUILD §11.12): lowercase, split into words on non-alphanumerics, pad each word
 * with two spaces in front and one behind, take every 3-gram, and score |A ∩ B| / |A ∪ B| over the two sets.
 *
 * Example: "Northwind Skincare" vs "Northwind Skincare AB" → 0.857; "Lindqvist" vs "Lindquist" → 0.538.
 */

/** The fuzzy tier links a proper noun when its best trigram similarity to a manifest name or alias is at least this. */
export const FUZZY_THRESHOLD = 0.85;

/** Lowercase, fold diacritics (NFKD, strip combining marks), unify apostrophes and dashes, collapse whitespace. */
export function foldText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** pg_trgm word split: runs of letters and digits. */
export function trigramWords(input: string): string[] {
  const folded = foldText(input);
  return folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
}

/** The set of trigrams of `input` with pg_trgm padding (`"  w"` … `"w "`). */
export function trigrams(input: string): Set<string> {
  const out = new Set<string>();
  for (const word of trigramWords(input)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Jaccard similarity of the two trigram sets, in [0, 1]. Two empty strings are not similar (0). */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Best similarity of `needle` against any of `haystack`, with the winning string. */
export function bestSimilarity(needle: string, haystack: readonly string[]): { score: number; match: string | null } {
  let best = 0;
  let match: string | null = null;
  for (const candidate of haystack) {
    const s = similarity(needle, candidate);
    if (s > best) {
      best = s;
      match = candidate;
    }
  }
  return { score: best, match };
}
