/** The only place the product name lives (BUILD §0, §19). Every user-facing mention imports this. */
export const APP_NAME = "Foundmill" as const;
export const APP_TAGLINE = "Build a real business with a team of AI agents." as const;
/** Canonical public origin of the product (apex domain purchased 2026-10-06). */
export const APP_DOMAIN = "foundmill.com" as const;
export const APP_ORIGIN = `https://${APP_DOMAIN}` as const;
/**
 * The registered postal address of the company that runs the product, one line (founder, 2026-11-13). The one source:
 * the Terms and the Privacy Policy state it (apps/web content/legal/facts.ts), and every email the product sends of its
 * own carries it in the footer (US CAN-SPAM: a valid physical postal address in every commercial message). The address
 * only: the company's name stays on the two legal pages (founder, 2026-11-13; apps/web legal-content.test.ts).
 */
export const APP_POSTAL_ADDRESS = "Valhallavägen 38, 11422 Stockholm, Sweden" as const;

// --- names only the platform may use (audit GLS2F-06, LS2-04) ---------------------------------------------------------

/** Roles only the platform's own staff hold; as a word of someone's name or the lead word of a subject they pose as it. */
const STAFF_WORDS: ReadonlySet<string> = new Set(["support", "staff", "admin", "administrator", "moderator", "official", "helpdesk"]);

/** Look-alike characters that evade a plain match ("F0undmi11", Cyrillic "о"), mapped to the Latin letter they imitate. */
const LOOKALIKES: Record<string, string> = {
  "0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i", "|": "l",
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ѕ": "s", "ј": "j", "ӏ": "l",
};

/** Lowercase, accents and zero-width characters removed, look-alikes folded; `one` is what "1" stands for ("i" or "l"). */
function foldName(text: string, one: "i" | "l"): string {
  // Combining marks (U+0300-036F), zero-width and directional marks (U+200B-200F), word joiner and BOM.
  const base = text.normalize("NFKD").replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, "").toLowerCase();
  let out = "";
  for (const ch of base) out += ch === "1" ? one : (LOOKALIKES[ch] ?? ch);
  return out;
}

/**
 * Whether a display name or a message subject poses as the platform or its staff: the product name anywhere in it (also
 * spaced out, in look-alike letters or with accents), or, for a display name, a staff word as one of its words
 * ("Support", "Ana from Support"). A subject is refused for a staff word only as its opening word ("Support: verify your
 * account" poses as the platform; "Anyone want to support my launch?" does not).
 */
export function isReservedName(text: string, kind: "display-name" | "subject" = "display-name"): boolean {
  for (const one of ["i", "l"] as const) {
    const folded = foldName(text, one);
    if (folded.replace(/[^a-z]/g, "").includes(APP_NAME.toLowerCase())) return true;
    const words = folded.split(/[^a-z]+/).filter(Boolean);
    if (kind === "display-name" ? words.some((w) => STAFF_WORDS.has(w)) : words.length > 0 && STAFF_WORDS.has(words[0]!)) return true;
  }
  return false;
}

/** What a refused name says. */
export const RESERVED_NAME_MESSAGE = `That name is reserved for ${APP_NAME} and its staff. Choose another.`;

/**
 * The bidi embedding, override and isolate controls (U+202A–U+202E, U+2066–U+2069). In a name they turn the text that
 * follows around ("Ana" + U+202E + "moc.elpmaxe" reads as an address), so a name never holds one.
 */
export const BIDI_CONTROL_RE = /[\u202a-\u202e\u2066-\u2069]/;

/** Whether a name holds a bidi embedding, override or isolate control. */
export function hasBidiControl(text: string): boolean {
  return BIDI_CONTROL_RE.test(text);
}

/** What a name with a bidi control says. */
export const BIDI_NAME_MESSAGE = "That name has a hidden character that changes the direction of the text. Type it again without it.";

/** A name derived from something else (an email's local part) when it is free to use, else `fallback`. */
export function freeDisplayName(candidate: string | null | undefined, fallback = "Founder"): string {
  const name = candidate?.trim();
  return name && !isReservedName(name) ? name : fallback;
}
