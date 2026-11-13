/**
 * Personal data and the page quiz (migration 0101; security review, Nov 13, 2026). A quiz is public, and what the team
 * drafts it from is the project's own records: payment descriptions ("Gift box for Maya Lee"), replies ("call me on
 * 0161 555 0101"). Two rules keep a person out of it:
 *   1. before anything reaches the model, names, email addresses and phone numbers are taken out of every reply and
 *      every payment description (`redactPersonal`), against the names and addresses the project holds;
 *   2. before a draft is stored, every text a visitor would read (types, questions, answers and offer titles) is
 *      checked again (`personalDataIn`): a draft naming anyone, or carrying an address, a phone number or a redaction
 *      mark, is refused.
 * The names and addresses are read on the service connection by the api and are never sent to the model.
 */

/** The names and email addresses of the project's contacts, as the api reads them (`repos.pageQuizzes.personalTerms`). */
export interface PersonalTerms {
  names: readonly string[];
  emails: readonly string[];
}

export const NO_PERSONAL_TERMS: PersonalTerms = Object.freeze({ names: [], emails: [] });

/** What a redaction leaves in a text. Never on the public page: `personalDataIn` refuses it. */
export const REDACTED = { name: "[name]", email: "[email]", phone: "[phone]" } as const;

const EMAIL_RE = /[^\s@<>()[\]{}"',;:]+@[^\s@<>()[\]{}"',;:]+\.[a-z]{2,}/gi;
/** Seven or more digits with the usual separators: a phone number, never a price ("$12.50") or a year. */
const PHONE_RE = /(?:\+?\d[\d\s().-]{5,}\d)/g;
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Words that are a label rather than a name ("Follower (ma***@example.com)", "Lead from the page"). */
const LABEL_WORDS = new Set(["follower", "customer", "lead", "user", "team", "member", "contact", "the", "and", "from", "page", "unknown"]);

/**
 * The name patterns to look for: every whole name, and each word of a person's name of three letters or more, as
 * whole words, case-insensitive. A word the project's own words use (its name, its pitch) is not a person's.
 */
export function namePatterns(terms: PersonalTerms, own: string): RegExp[] {
  const ownWords = new Set((own.toLowerCase().match(/[\p{L}'-]+/gu) ?? []));
  const out = new Set<string>();
  for (const raw of terms.names) {
    const name = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (name.length < 3) continue;
    if (!ownWords.has(name.toLowerCase()) && !own.toLowerCase().includes(name.toLowerCase())) out.add(name);
    for (const word of name.split(" ")) {
      const w = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (w.length >= 3 && !LABEL_WORDS.has(w.toLowerCase()) && !ownWords.has(w.toLowerCase())) out.add(w);
    }
  }
  return [...out].sort((a, b) => b.length - a.length).map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, "giu"));
}

/** `text` with names, email addresses and phone numbers replaced by `REDACTED` marks. */
export function redactPersonal(text: string, patterns: readonly RegExp[], terms: PersonalTerms = NO_PERSONAL_TERMS): string {
  let s = text.replace(EMAIL_RE, REDACTED.email);
  for (const e of terms.emails) if (e) s = s.replace(new RegExp(escape(e), "gi"), REDACTED.email);
  s = s.replace(PHONE_RE, (m) => (digitCount(m) >= 7 ? REDACTED.phone : m));
  for (const p of patterns) s = s.replace(p, REDACTED.name);
  return s;
}

/** The first sign of a person in `text` (a name, an address, a phone number, a redaction mark), or null. */
export function personalDataIn(text: string, patterns: readonly RegExp[], terms: PersonalTerms = NO_PERSONAL_TERMS): string | null {
  if (/\[(?:name|email|phone)\]/i.test(text)) return "a redacted detail";
  if (new RegExp(EMAIL_RE.source, "i").test(text) || terms.emails.some((e) => e && text.toLowerCase().includes(e.toLowerCase()))) return "an email address";
  for (const m of text.match(PHONE_RE) ?? []) if (digitCount(m) >= 7) return "a phone number";
  for (const p of patterns) {
    p.lastIndex = 0;
    if (p.test(text)) return "a person's name";
  }
  return null;
}
