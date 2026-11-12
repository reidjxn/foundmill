/**
 * Typed reads (founder, 2026-11-12: "build the typed read").
 *
 * An agent that can contact people, spend or do something that cannot be undone never reads third-party text raw: the
 * gateway hands it the quarantined reader's digest instead (BUILD §9.8 step 2). A digest is a short summary, so the
 * values such an agent needs to work with are lost in it: a lead's id, a role, the work email the founder just paid a
 * credit for, the addresses an assistant cited, a deployment's id and state.
 *
 * A tool may therefore declare `facts`: a projection of its own validated output into checked values, which the
 * gateway delivers next to the digest. Facts are not text to read. Every value is one of a few narrow kinds built with
 * `fact.*` below (an id, a short label with no sentence in it, an email address, a host, a URL, a number, a flag, one
 * of a fixed set, a date), and `assertFacts` holds the whole structure to hard limits whatever the tool's projection
 * did, so a connector's mistake cannot turn facts into a way around the reader. A value that does not fit its kind is
 * null: it is never trimmed to fit, because a trimmed sentence is still a sentence.
 *
 * Facts stay inside the untrusted envelope with its notice: they are data, never instructions, and an address or a
 * URL in them is still "first seen in untrusted content" for the recipient rules.
 */

/** Control characters, line and paragraph separators, zero-width and direction marks, and the byte-order mark. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
/** Letters, digits, spaces and the punctuation a name, a role or a company carries. No @, no slashes in pairs, no quotes, no brackets. */
const LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&'’+/()#-]*$/u;
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const HEX_RE = /^[0-9a-f]+$/;

export const FACT_LABEL_MAX = 80;
/** A name, a role or a company is a few words. More than this reads as a sentence, and a sentence is what facts keep out. */
export const FACT_LABEL_MAX_WORDS = 10;
export const FACT_URL_MAX = 500;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export const fact = {
  /** An opaque identifier: letters, digits and `_ . : -`, at most `max` characters. */
  id(v: unknown, max = 64): string | null {
    const s = str(v);
    return s !== null && s.length <= max && ID_RE.test(s) ? s : null;
  },
  /** A short name, role or company: one line, a few words, no address, link, quote or bracket in it. Null when it does not fit. */
  label(v: unknown, max = FACT_LABEL_MAX): string | null {
    const raw = str(v);
    if (raw === null) return null;
    const s = raw.normalize("NFKC").trim();
    if (!s || s.length > max || CONTROL_RE.test(s) || /\s{2,}/.test(s) || !LABEL_RE.test(s)) return null;
    if (s.includes("//") || /\bwww\./i.test(s) || s.split(" ").length > FACT_LABEL_MAX_WORDS) return null;
    return s;
  },
  email(v: unknown): string | null {
    const s = str(v)?.trim().toLowerCase() ?? null;
    return s !== null && s.length <= 254 && EMAIL_RE.test(s) ? s : null;
  },
  /** A public DNS name, lowercase. */
  host(v: unknown): string | null {
    const s = str(v)?.trim().toLowerCase().replace(/\.$/, "") ?? null;
    return s !== null && s.length <= 253 && HOST_RE.test(s) ? s : null;
  },
  /** An http(s) address with no credentials in it, as the URL parser writes it. */
  url(v: unknown, opts: { httpsOnly?: boolean } = {}): string | null {
    const s = str(v)?.trim() ?? null;
    if (s === null || s.length > FACT_URL_MAX || CONTROL_RE.test(s) || /\s/.test(s)) return null;
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" && (opts.httpsOnly || u.protocol !== "http:")) return null;
    if (u.username || u.password || !HOST_RE.test(u.hostname.toLowerCase())) return null;
    const out = u.toString();
    return out.length <= FACT_URL_MAX ? out : null;
  },
  /** The host of an http(s) address, or null. */
  hostOf(v: unknown): string | null {
    const u = fact.url(v);
    return u ? new URL(u).hostname.toLowerCase() : null;
  },
  int(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
  },
  number(v: unknown, min = -1e15, max = 1e15): number | null {
    return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
  },
  bool(v: unknown): boolean | null {
    return typeof v === "boolean" ? v : null;
  },
  oneOf<const T extends readonly string[]>(v: unknown, values: T): T[number] | null {
    return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T[number]) : null;
  },
  /** An ISO date or date-time. */
  date(v: unknown): string | null {
    const s = str(v);
    return s !== null && s.length <= 40 && ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
  },
  /** Lowercase hex (a commit, a hash), at most `max` characters. */
  hex(v: unknown, max = 64): string | null {
    const s = str(v)?.toLowerCase() ?? null;
    return s !== null && s.length > 0 && s.length <= max && HEX_RE.test(s) ? s : null;
  },
};

export const MENTION_TERMS_MAX = 5;
export const MENTION_TERM_MAX = 60;

/**
 * Whether, and how often, each of the caller's own terms appears in a third-party text (case-insensitive, whole
 * words). The terms come from the agent's arguments, so they are its own words; only a flag and a count come out of
 * the text. This is how an agent that may not read an answer still learns whether the answer names the business.
 */
export function countMentions(text: string, terms: readonly string[] | undefined): { term: string; mentioned: boolean; count: number }[] {
  const haystack = text.normalize("NFKC").toLowerCase();
  return (terms ?? []).slice(0, MENTION_TERMS_MAX).map((term) => {
    const needle = term.normalize("NFKC").trim().toLowerCase();
    if (!needle) return { term, mentioned: false, count: 0 };
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = (haystack.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu")) ?? []).length;
    return { term, mentioned: count > 0, count: Math.min(count, 999) };
  });
}

export const FACTS_LIMITS = { depth: 4, arrayItems: 50, objectKeys: 30, stringChars: FACT_URL_MAX, totalBytes: 16_384 } as const;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;

/** Why `value` is not acceptable as facts, or null when it is. The generic guard, whatever a tool's projection produced. */
export function factsProblem(value: unknown): string | null {
  const walk = (v: unknown, depth: number, path: string): string | null => {
    if (v === null || typeof v === "boolean") return null;
    if (typeof v === "number") return Number.isFinite(v) ? null : `${path}: not a finite number`;
    if (typeof v === "string") {
      if (v.length > FACTS_LIMITS.stringChars) return `${path}: longer than ${FACTS_LIMITS.stringChars} characters`;
      return CONTROL_RE.test(v) ? `${path}: has a line break or a hidden character` : null;
    }
    if (typeof v !== "object") return `${path}: ${typeof v} is not a fact`;
    if (depth >= FACTS_LIMITS.depth) return `${path}: nested deeper than ${FACTS_LIMITS.depth}`;
    if (Array.isArray(v)) {
      if (v.length > FACTS_LIMITS.arrayItems) return `${path}: more than ${FACTS_LIMITS.arrayItems} items`;
      for (let i = 0; i < v.length; i++) {
        const p = walk(v[i], depth + 1, `${path}[${i}]`);
        if (p) return p;
      }
      return null;
    }
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return `${path}: not a plain object`;
    const keys = Object.keys(v);
    if (keys.length > FACTS_LIMITS.objectKeys) return `${path}: more than ${FACTS_LIMITS.objectKeys} fields`;
    for (const k of keys) {
      if (!KEY_RE.test(k)) return `${path}: field name "${k.slice(0, 20)}" is not a plain identifier`;
      const p = walk((v as Record<string, unknown>)[k], depth + 1, `${path}.${k}`);
      if (p) return p;
    }
    return null;
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "facts must be an object";
  const problem = walk(value, 0, "facts");
  if (problem) return problem;
  return Buffer.byteLength(JSON.stringify(value), "utf8") > FACTS_LIMITS.totalBytes ? `facts: larger than ${FACTS_LIMITS.totalBytes} bytes` : null;
}

/** `value` when it passes `factsProblem`, else null. Facts fail closed: a projection that breaks a limit delivers nothing. */
export function checkedFacts(value: unknown): Record<string, unknown> | null {
  return factsProblem(value) === null ? (value as Record<string, unknown>) : null;
}
