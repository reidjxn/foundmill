/**
 * Personal data and the page quiz (migration 0105; security reviews of Nov 13, 2026). A quiz is public, and what the
 * team drafts it from is the project's own records: payment descriptions ("Gift box for Maya Lee"), replies ("call me
 * on 0161 555 0101"). Two rules keep a person out of it:
 *   1. before anything reaches the model, names, email addresses and phone numbers are taken out of every reply and
 *      every payment description (`redactPersonal`), against the names and addresses the project holds, and only then
 *      is anything shortened (a cut address, "jo@example.c", must never slip past);
 *   2. before a draft is stored, every text a visitor would read (types, questions, answers and offer titles) is
 *      checked again (`personalHit`): a draft naming anyone, or carrying an address, a phone number or a redaction
 *      mark, is refused.
 * Matching ignores case and accents on both sides ("Zoe" is "Zoë"). A person's whole name and every word of it of two
 * letters or more count ("Jo", "Hope"), even when the project's own words use the same word: a draft that then uses
 * "hope" is refused with a reason the founder can read (`personalHitLine`), never let through quietly. An
 * organization counts by its whole name only (its words are often ordinary ones: "Office", "Fleet"). The project's own
 * name is never a person's. The names and addresses are read on the service connection by the api and are never sent
 * to the model, not even in a retry's reason.
 */

/** The names and email addresses of the project's contacts, as the api reads them (`repos.pageQuizzes.personalTerms`). */
export interface PersonalTerms {
  /** People's names (and their aliases). */
  names: readonly string[];
  emails: readonly string[];
  /** Organizations' names, matched whole. */
  organizations?: readonly string[];
}

export const NO_PERSONAL_TERMS: PersonalTerms = Object.freeze({ names: [], emails: [], organizations: [] });

/** What a redaction leaves in a text. Never on the public page: `personalHit` refuses it. */
export const REDACTED = { name: "[name]", email: "[email]", phone: "[phone]" } as const;

/** Anything with an @ between two runs of non-space: an address, whole or cut ("jo@example.c", "maya@example"). */
const EMAIL_RE = /\S+@\S+/g;
/** Seven or more digits with the usual separators: a phone number, never a price ("$12.50") or a year. */
const PHONE_RE = /\+?\d[\d\s()./-]{5,}\d/g;
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Words that are a label rather than a name ("Follower (ma***@example.com)", "Lead from the page"). */
const LABEL_WORDS = new Set(["follower", "customer", "lead", "user", "team", "member", "contact", "unknown"]);

/** Accent folding: "Zoë" → "Zoe", "Ångström" → "Angstrom". Both the names and the texts go through it. */
export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
}

/** One pattern per name or name word, with the word it stands for (the founder's reason names it; the model never sees it). */
export interface NamePattern {
  word: string;
  re: RegExp;
}

const wordRe = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, "giu");

/**
 * The name patterns to look for, accent-folded: every person's whole name, the name written without its spaces
 * ("MayaLee"), each word of it of two letters or more; every organization's whole name. `businessName` is never one.
 */
export function namePatterns(terms: PersonalTerms, businessName = ""): NamePattern[] {
  const own = foldAccents(businessName).toLowerCase().trim();
  const out = new Map<string, string>();
  const add = (w: string) => {
    const f = foldAccents(w).trim();
    if (f.length >= 2 && f.toLowerCase() !== own) out.set(f.toLowerCase(), f);
  };
  for (const raw of terms.names) {
    const name = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    const words = name.split(" ").map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter(Boolean);
    if (words.length > 1) {
      add(words.join(" "));
      add(words.join(""));
    }
    for (const w of words) if (!LABEL_WORDS.has(foldAccents(w).toLowerCase())) add(w);
  }
  for (const org of terms.organizations ?? []) {
    const name = org.replace(/\s+/g, " ").trim();
    if (name.length >= 3) add(name);
  }
  return [...out.values()].sort((a, b) => b.length - a.length).map((word) => ({ word, re: wordRe(word) }));
}

/** `text` (accent-folded) with email addresses, phone numbers and names replaced by `REDACTED` marks. */
export function redactPersonal(text: string, patterns: readonly NamePattern[], terms: PersonalTerms = NO_PERSONAL_TERMS): string {
  let s = foldAccents(text).replace(EMAIL_RE, REDACTED.email);
  for (const e of terms.emails) if (e) s = s.replace(new RegExp(escape(foldAccents(e)), "gi"), REDACTED.email);
  s = s.replace(PHONE_RE, (m) => (digitCount(m) >= 7 ? REDACTED.phone : m));
  for (const p of patterns) s = s.replace(p.re, REDACTED.name);
  return s;
}

/** What identifies a person in a text: the kind, and the word for a name (for the founder's reason only). */
export type PersonalHit = { kind: "redacted" | "email" | "phone" } | { kind: "name"; word: string };

/** The first sign of a person in `text` (an address, a phone number, a redaction mark, a name), or null. */
export function personalHit(text: string, patterns: readonly NamePattern[], terms: PersonalTerms = NO_PERSONAL_TERMS, businessName = ""): PersonalHit | null {
  // The project's own name is public already: it is taken out before names are looked for.
  let s = foldAccents(text);
  if (/\[(?:name|email|phone)\]/i.test(s)) return { kind: "redacted" };
  if (new RegExp(EMAIL_RE.source).test(s) || terms.emails.some((e) => e && s.toLowerCase().includes(foldAccents(e).toLowerCase()))) return { kind: "email" };
  for (const m of s.match(PHONE_RE) ?? []) if (digitCount(m) >= 7) return { kind: "phone" };
  if (businessName.trim()) s = s.replace(new RegExp(escape(foldAccents(businessName.trim())), "gi"), " ");
  for (const p of patterns) {
    p.re.lastIndex = 0;
    if (p.re.test(s)) return { kind: "name", word: p.word };
  }
  return null;
}

/** The kind in plain words, for a retry's reason sent to the model: never the name itself. */
export function personalHitKind(hit: PersonalHit): string {
  return hit.kind === "name" ? "a word that is a person's name" : hit.kind === "email" ? "an email address" : hit.kind === "phone" ? "a phone number" : "a redacted detail";
}

/** Back-compatible yes or no, in plain words. */
export function personalDataIn(text: string, patterns: readonly NamePattern[], terms: PersonalTerms = NO_PERSONAL_TERMS, businessName = ""): string | null {
  const hit = personalHit(text, patterns, terms, businessName);
  return hit ? personalHitKind(hit) : null;
}

/**
 * The founder's sentence when a draft was refused for a person's details. For a name it says which word, because an
 * ordinary word that is also a contact's name ("Hope", "Will") is the likely cause and only the founder can judge it.
 */
export function personalHitLine(hit: PersonalHit | null): string {
  if (hit?.kind === "name") return `The team's draft used “${hit.word}”, which is also the name of one of your contacts, so nothing was saved: a customer's name never goes on your page. If it is an ordinary word there, ask again and the team will word it differently.`;
  return "The team's draft had an email address, a phone number or a detail taken from a customer's own words, so nothing was saved: none of that goes on your page. Ask again in a little while.";
}
