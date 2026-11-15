/**
 * The community screen (BUILD §11.14 "moderation by Haiku + humans + admins"; audit #28): before members see a community
 * post, or a new community's name and description, deterministic checks run, then the `moderation` utility reads the
 * text as untrusted data. A deterministic hit holds on its own; otherwise the model's verdict decides. A held post waits
 * for the community's owner and moderators. The api runs it (apps/api/src/services/live.ts, which also holds a post when
 * the screen fails); evals/src/moderation.ts pins it on fixed posts.
 *
 * Pure: the request is built here and sent by the caller's model client.
 */
import type { ModerationOutput } from "@foundmill/models";
import { buildSystemPrompt } from "./club-rules";
import { untrustedBlock } from "./foundations";
import { getTemplate } from "./registry";

export type CommunityScreenKind = "community_post" | "community_profile";

export interface CommunityScreenInput {
  text: string;
  /** What is screened: a post, or a community's name and description. */
  kind: CommunityScreenKind;
  /** The community's name as plain text ("" for a community being created). */
  communityName: string;
  appName: string;
}

// The pieces of a written-out email address ("name [at] example dot com", "name(at)example.com"): an "at" or a "dot" in
// brackets, or as a word on its own.
const AT_BRACKETED = String.raw`\s*[\[({<]\s*(?:at|@)\s*[\])}>]\s*`;
const DOT_BRACKETED = String.raw`\s*[\[({<]\s*(?:dot|\.)\s*[\])}>]\s*`;
const AT_WORD = String.raw`\s+at\s+`;
const DOT_WORD = String.raw`\s+dot\s+`;
const LOCAL = String.raw`[A-Z0-9._%+-]+`;
const LABEL = String.raw`[A-Z0-9-]+`;
const TLD = String.raw`[A-Z]{2,}\b`;
/** Between two digits of a phone number: nothing, or one space, dot or dash with a space either side ("555 - 1234"). */
const DIGIT_SEP = String.raw`[ \t]?[.\-]?[ \t]?`;

/** Checks that run before the model, in every mode: each one holds a post outright. Matched against `screenText(text)`. */
export const COMMUNITY_SCREEN_RULES: readonly { flag: string; re: RegExp }[] = [
  // Markup and script URLs never render (post text is shown with HTML, images and links to entities off), but a post
  // that carries them is an attempt, and a person should look at it.
  { flag: "markup", re: /<\s*\/?\s*(?:script|iframe|object|embed|style|form|svg|img|link|meta)\b|\b(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i },
  // Personal data in a post every member reads: an email address or a phone number.
  { flag: "personal_data", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  // An address written out: a bracketed or spelled "at" with a bracketed or spelled "dot" ("ana [at] example dot com",
  // "ana at example dot com"), a bracketed "at" with plain dots ("ana(at)example.com"), or "@" with a bracketed or
  // spelled "dot" ("ana@example dot com"). A spelled "at" with a plain dot ("look at this. Then") is ordinary prose.
  {
    flag: "personal_data",
    re: new RegExp(
      [
        `${LOCAL}(?:${AT_BRACKETED}|${AT_WORD})${LABEL}(?:(?:${DOT_BRACKETED}|${DOT_WORD})${LABEL})*(?:${DOT_BRACKETED}|${DOT_WORD})${TLD}`,
        `${LOCAL}${AT_BRACKETED}${LABEL}(?:\\.${LABEL})*\\.${TLD}`,
        `${LOCAL}\\s*@\\s*${LABEL}(?:(?:${DOT_BRACKETED}|${DOT_WORD}|\\.)${LABEL})*(?:${DOT_BRACKETED}|${DOT_WORD})${TLD}`,
      ].join("|"),
      "i",
    ),
  },
  { flag: "personal_data", re: /(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\+\d[\d\s().-]{8,}\d/ },
  // A run of nine or more digits, with at most a space, a dot or a dash between two of them ("5552013344",
  // "07700 900123", "555.201.3344"). Years, prices and counts are shorter ("2026", "$2,300", "300 people").
  { flag: "personal_data", re: new RegExp(String.raw`(?<!\d)\d(?:${DIGIT_SEP}\d){8,}(?!\d)`) },
  // A seven-digit local number with a dash ("555-1234").
  { flag: "personal_data", re: /(?<![\d-])\d{3}-\d{4}(?![\d-])/ },
];

/** Model flags that hold a post for a person even when the model allowed it (it allows harassment as advisory in marketing copy). */
export const COMMUNITY_HOLD_CATEGORIES: ReadonlySet<string> = new Set(["harassment", "pii_exposure", "claims_to_be_human", "fake_testimonial", "prohibited_automation"]);

export const COMMUNITY_SCREEN_MAX_TOKENS = 600;

/**
 * The text as the rules read it: NFKC-normalized (the fullwidth at sign and digits become "@" and ASCII digits, ligatures and
 * compatibility forms fold) and with every format character removed (`\p{Cf}`: zero-width spaces and joiners, soft
 * hyphens, the bidi embeddings, overrides and isolates), so an address with a zero-width space in it, or a number in fullwidth digits, cannot slip past.
 */
export function screenText(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "");
}

/** The deterministic flags a text raises (de-duplicated, in rule order). */
export function communityScreenLocalFlags(text: string): string[] {
  const clean = screenText(text);
  return [...new Set(COMMUNITY_SCREEN_RULES.filter((r) => r.re.test(clean)).map((r) => r.flag))];
}

/** The `moderation` call for one text: the utility's own system prompt, and the text as untrusted data in the user message. */
export function buildCommunityScreenRequest(input: CommunityScreenInput): { route: "moderation"; system: string; messages: { role: "user"; content: string }[]; maxTokens: number } {
  const what = input.kind === "community_post" ? "community post" : "community name and description";
  const where = input.communityName ? `the community "${input.communityName}"` : "a new community";
  return {
    route: "moderation",
    system: buildSystemPrompt({ businessName: `${input.appName} communities`, appName: input.appName, template: getTemplate("moderation") }),
    messages: [
      {
        role: "user",
        content: `Screen this ${what} from ${where} before members see it. Allow it, or flag it for a human moderator with the categories it breaks.\n\n${untrustedBlock(input.kind, { kind: input.kind, text: input.text })}`,
      },
    ],
    maxTokens: COMMUNITY_SCREEN_MAX_TOKENS,
  };
}

/**
 * Marketing-email rules of the shared moderation route (an unsubscribe line, a sender identity). A founder's community
 * post is not a marketing email, so these never hold one: a post that mentions a "subject:" is still a post.
 */
export const COMMUNITY_IGNORED_CATEGORIES: ReadonlySet<string> = new Set(["missing_unsubscribe", "missing_sender_identity"]);

/**
 * Holds when a deterministic check hit, the model did not allow the text, or it raised a critical or hold category.
 * Flags in COMMUNITY_IGNORED_CATEGORIES are dropped first, and a refusal that rests only on them does not hold.
 */
export function communityScreenVerdict(local: readonly string[], out: Pick<ModerationOutput, "allowed" | "flags">): { decision: "allow" | "hold"; flags: string[] } {
  const flags = out.flags.filter((f) => !COMMUNITY_IGNORED_CATEGORIES.has(f.category));
  const refused = !out.allowed && (flags.length > 0 || out.flags.length === 0);
  const hold = local.length > 0 || refused || flags.some((f) => f.severity === "critical" || COMMUNITY_HOLD_CATEGORIES.has(f.category));
  return { decision: hold ? "hold" : "allow", flags: [...new Set([...local, ...flags.map((f) => f.category)])].slice(0, 20) };
}
