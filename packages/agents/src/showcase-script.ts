/**
 * The house social agent's script for a showcase video (docs/THESIS_REVIEW.md §13 item 15; approved by the network
 * session, Nov 13, 2026): at most three shots ("Nov 12: page live"), one per card of the project's public story, and
 * the words of the post. Only the output of the public story (`storyBySlug` / `cardById`) reaches the model: the
 * project's name and the shown milestones' public words and dates. No names, no faces, no voices and no number of
 * people, because none of it is in the input.
 *
 * Pure, like the rest of this package:
 * - `showcaseScriptFacts` and `buildShowcaseScriptRequest`: what the agent is given.
 * - `checkShowcaseScript` and `finaliseShowcaseScript`: the code check every answer passes before it is stored. It
 *   refuses a digit outside a date, a fact not in the input, counts, rankings or recency, words of lack ("alone",
 *   "solo", "without a cofounder", "just one person"), anything about people, work framing and banned terms.
 * - `runShowcaseScriptStep`: one call, one retry with the reason when the answer is refused, then the script, or a
 *   drop with a reason code (never the words). An adversarial or broken answer is dropped, never stored.
 */
import { APP_NAME } from "@foundmill/config";
import type { CompleteResult, ModelClient, UsageAttribution } from "@foundmill/models";
import { ShowcaseScriptOutput } from "@foundmill/models/schemas";
import { SHOWCASE_MAX_SHOTS, SHOWCASE_POST_MAX, type ShowcaseMilestoneKey } from "@foundmill/shared";
import { buildSystemPrompt } from "./club-rules";
import { inertJson } from "./foundations";
import { POST_DRAFT_CHANNEL, POST_SUBTEXT_PATTERNS, POST_VOCAB_PATTERNS } from "./post-draft";
import { showcaseScriptPrompt } from "./prompts/showcase-script";
import { getChannelTemplate } from "./registry";
import type { RouteKey } from "./types";

/** The route the script runs on (packages/models `routing.ts`), shared with the post drafts and the project page. */
export const SHOWCASE_SCRIPT_ROUTE = "projectPage" as const satisfies RouteKey;
/** The usage ledger's `kind` for the script's calls, booked to the house business. */
export const SHOWCASE_SCRIPT_USAGE_KIND = "showcase_script";
export const SHOWCASE_SCRIPT_RESERVE_TOKENS = 700;
/** One retry with the reason, then the script is dropped. */
export const SHOWCASE_SCRIPT_MAX_CALLS = 2;
/** The longest caption on a shot. */
export const SHOWCASE_CAPTION_MAX = 48;

// ---------------------------------------------------------------------------------------------------------------------
// What the agent is given
// ---------------------------------------------------------------------------------------------------------------------

/** One card of the story, as the model sees it. */
export interface ShowcaseCardFact {
  /** "c1", "c2", "c3": the code the answer names the card by. */
  card: string;
  milestoneId: string;
  key: ShowcaseMilestoneKey;
  /** The milestone's public words ("Page live"). */
  label: string;
  /** "Nov 12, 2026". */
  on: string;
  /** "Nov 12". */
  onShort: string;
}

/** Everything the model sees. Nothing else may be added to a request. */
export interface ShowcaseScriptFacts {
  projectName: string;
  cards: ShowcaseCardFact[];
  maxChars: number;
}

/** The output of the public story the facts are built from (apps/api `storyFacts`: the same rows `storyBySlug` reads). */
export interface ShowcaseStoryInput {
  name: string;
  milestones: readonly { id: string; key: ShowcaseMilestoneKey; label: string; achievedAt: Date }[];
}

const usDate = (at: Date, withYear: boolean): string => at.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** The facts for a script: the project's name and its newest shown milestones (at most three), oldest first. The function takes nothing else. */
export function showcaseScriptFacts(story: ShowcaseStoryInput): ShowcaseScriptFacts {
  const chosen = [...story.milestones].sort((a, b) => a.achievedAt.getTime() - b.achievedAt.getTime()).slice(-SHOWCASE_MAX_SHOTS);
  return {
    projectName: story.name.replace(/\s+/g, " ").trim(),
    cards: chosen.map((m, i) => ({ card: `c${i + 1}`, milestoneId: m.id, key: m.key, label: m.label, on: usDate(m.achievedAt, true), onShort: usDate(m.achievedAt, false) })),
    maxChars: SHOWCASE_POST_MAX,
  };
}

/** Why an answer was not used: a code for the log and the retry; the words are never kept. */
export const SHOWCASE_SCRIPT_REFUSALS = ["limits", "unknown_card", "too_long", "markup", "digit", "unknown_fact", "ranking", "lack", "people", "work", "banned"] as const;
export type ShowcaseScriptRefusal = (typeof SHOWCASE_SCRIPT_REFUSALS)[number];

export const SHOWCASE_SCRIPT_RETRY_NOTES: Readonly<Record<ShowcaseScriptRefusal, string>> = {
  limits: "Your last script was not used: it was empty, or a shot or the post had no words. Write one shot per card and a post of one or two sentences.",
  unknown_card: "Your last script was not used: a shot named a card that is not in the request, or the same card twice. Use only the card codes given, each once.",
  too_long: "Your last script was not used: a caption or the post was too long. Write it again in fewer words.",
  markup: "Your last script was not used: it contained a link, an address, a hashtag, an emoji, an exclamation mark or markup. Write plain text only.",
  digit: "Your last script was not used: it contained a number that is not one of the cards' dates. Write no other number.",
  unknown_fact: "Your last script was not used: it said something the cards do not say. Say only the project's name, the milestones and their dates.",
  ranking: "Your last script was not used: it counted, ranked or compared something, or said when in relation to now. Say only what happened and on which date.",
  lack: "Your last script was not used: it suggested someone did this alone or was missing. Say nothing about who built it.",
  people: "Your last script was not used: it mentioned people. Say nothing about who built it, how many or what they are called.",
  work: "Your last script was not used: it mentioned jobs, work or careers. Say what happened and nothing about why.",
  banned: "Your last script was not used: it used a word this product never uses. Say what happened in plain words.",
};

export interface ShowcaseScriptRequest {
  route: typeof SHOWCASE_SCRIPT_ROUTE;
  system: string[];
  messages: { role: "user"; content: string }[];
  schema: typeof ShowcaseScriptOutput;
  reserveTokens: number;
}

/** The house rules and the social agent's instructions, then the script prompt; the facts as trusted JSON. */
export function buildShowcaseScriptRequest(facts: ShowcaseScriptFacts, options: { retry?: ShowcaseScriptRefusal | null } = {}): ShowcaseScriptRequest {
  const trusted = { showcase_request: { project_name: facts.projectName, cards: facts.cards.map((c) => ({ card: c.card, key: c.key, label: c.label, on: c.on, on_short: c.onShort })), max_chars: facts.maxChars } };
  const parts = ["```json\n" + inertJson(trusted) + "\n```"];
  if (options.retry) parts.push(SHOWCASE_SCRIPT_RETRY_NOTES[options.retry]);
  parts.push("Write the script now.");
  return {
    route: SHOWCASE_SCRIPT_ROUTE,
    system: [buildSystemPrompt({ businessName: APP_NAME, appName: APP_NAME, template: getChannelTemplate(POST_DRAFT_CHANNEL) }), showcaseScriptPrompt.render({ APP_NAME, max_chars: facts.maxChars })],
    messages: [{ role: "user", content: parts.join("\n\n") }],
    schema: ShowcaseScriptOutput,
    reserveTokens: SHOWCASE_SCRIPT_RESERVE_TOKENS,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The code check
// ---------------------------------------------------------------------------------------------------------------------

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December";

/** Counts, rankings, comparisons and recency. "First" is fine inside the label "First follower" only (labels are removed first). */
const RANKING_RE = new RegExp(
  String.raw`\b(?:top|first|best|fastest|quickest|biggest|largest|leading|most|only|record|ranked|ranking|rank|number one|beat|beats|ahead|winner|winning|ever|this (?:week|month|year|morning)|today|tonight|yesterday|recent|recently|just|latest|newest|already|so far|overnight|within|in (?:a|one|two|three) (?:day|week|month)s?|one|two|three|four|five|six|seven|eight|nine|ten|dozens?|hundreds?|thousands?|millions?|several|many|countless|single)\b|#\s?1\b`,
  "i",
);
/** Words of lack: a project framed as missing someone or something. */
const LACK_RE = /\b(?:alone|solo|lone|lonely|single[-\s]?handed\w*|by (?:him|her|them|my|your|it)sel(?:f|ves)|on (?:his|her|their|my|its) own|without (?:a |any |the )?(?:co-?founders?|partners?|team|help|money|funding|experience|anyone)|just one person|one[-\s](?:person|man|woman)|only one person|no (?:co-?founders?|team|partners?|help)|nobody|no one|missing)\b/i;
/** People: names, roles and pronouns, and any number of them. */
const PEOPLE_RE = /\b(?:co-?founders?|founders?|team(?:s|mates?)?|people|persons?|person|he|she|him|her|his|hers|himself|herself|themselves|guy|girl|man|woman|duo|pair|trio|couple|crew|staff|employees?|creator|maker|owner)\b/i;
/** Work framing, beyond the product's own banned phrases. */
const WORK_RE = /\b(?:jobs?|careers?|employ\w*|unemploy\w*|boss|salary|paycheck|side[-\s]hustle|quit|quitting|laid[-\s]off|layoffs?|9[-\s]?(?:to|-)[-\s]?5|nine[-\s]to[-\s]five)\b/i;
/** Claims a showcase may never make: results, figures and plans the cards do not hold. */
const CLAIM_RE = /\b(?:customers?|clients?|users?|subscribers?|sign-?ups?|orders?|sales?|sold|revenue|paying|paid|payments?|downloads?|reviews?|testimonials?|awards?|waitlist|growth|growing|traction|launch(?:ed|es|ing)?|coming soon|soon|next|will|plans?|planning|funding|funded|investors?|raised|profit\w*)\b/i;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|ai|app|co|dev|xyz)\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}|(?:^|\s)@[A-Za-z0-9_]{2,}|#[\p{L}\p{N}_]+/iu;
const MARKUP_RE = /\*\*|__|`|<\/?[a-z][^>]*>|\[\[|\]\(|!|\p{Extended_Pictographic}/u;

/** Removes what the facts allow: the project's name, every card's label and both forms of every date. */
function withoutFacts(text: string, facts: ShowcaseScriptFacts): string {
  let out = text;
  const allowed = [facts.projectName, ...facts.cards.flatMap((c) => [c.on, c.onShort, c.label])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const a of allowed) out = out.replace(new RegExp(escape(a), "gi"), " ");
  return out;
}

/** Words a caption may carry beside its card's label and date. */
const CAPTION_WORDS = new Set(["the", "its", "a", "an", "on", "and", "of", "is", "was", "went", "got", "has", "now", "page", "live", "public", "follower", "card", "milestone", "reached", "story"]);
/** Words a post may carry beside the facts: the plain words of a sentence about what the cards show. */
const POST_WORDS = new Set(
  "the a an its it on and of in at is was went got has had have now page live public follower card cards milestone milestones reached story how built build building see watch here with from to this that each step steps recorded verified by as".split(" "),
);

const words = (s: string): string[] => (s.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) ?? []).map((w) => w.replace(/['’]s$/, ""));

/** Why a script cannot be used, or null when it can. Pure. */
export function checkShowcaseScript(script: { shots: readonly { card: string; caption: string }[]; post: string }, facts: ShowcaseScriptFacts): ShowcaseScriptRefusal | null {
  const post = script.post.replace(/\s+/g, " ").trim();
  if (!script.shots.length || script.shots.length > SHOWCASE_MAX_SHOTS || post.length < 12 || !/\p{L}{2,}/u.test(post)) return "limits";
  const seen = new Set<string>();
  for (const s of script.shots) {
    const card = facts.cards.find((c) => c.card === s.card.trim());
    if (!card || seen.has(card.card)) return "unknown_card";
    seen.add(card.card);
    if (!s.caption.trim() || !/\p{L}{2,}/u.test(s.caption)) return "limits";
    if (s.caption.trim().length > SHOWCASE_CAPTION_MAX) return "too_long";
    // A caption names its own card's milestone; it may name its own card's date and nothing else.
    if (!s.caption.toLowerCase().includes(card.label.toLowerCase())) return "unknown_fact";
    const others = facts.cards.filter((c) => c.card !== card.card);
    if (others.some((o) => o.onShort !== card.onShort && s.caption.includes(o.onShort))) return "unknown_fact";
  }
  if (post.length > facts.maxChars) return "too_long";
  const all = [...script.shots.map((s) => s.caption), post];
  for (const text of all) {
    if (URL_RE.test(text) || MARKUP_RE.test(text) || /[[\]<>{}]/.test(text)) return "markup";
    const rest = withoutFacts(text, facts);
    // A digit outside a date (and outside the project's own name).
    if (/\d/.test(rest)) return "digit";
    if (new RegExp(`\\b(?:${MONTHS})\\b`).test(rest)) return "unknown_fact";
    if (POST_SUBTEXT_PATTERNS.some((re) => (text.match(new RegExp(re.source, re.flags)) ?? []).length > 0) || WORK_RE.test(rest)) return "work";
    if (LACK_RE.test(rest)) return "lack";
    if (PEOPLE_RE.test(rest)) return "people";
    if (RANKING_RE.test(rest)) return "ranking";
    if (POST_VOCAB_PATTERNS.some((re) => (rest.match(new RegExp(re.source, re.flags)) ?? []).length > 0)) return "banned";
    if (CLAIM_RE.test(rest)) return "unknown_fact";
  }
  // Facts only: past the name, the labels and the dates, a caption and a post carry only the plain words of a sentence.
  for (const s of script.shots) if (words(withoutFacts(s.caption, facts)).some((w) => !CAPTION_WORDS.has(w))) return "unknown_fact";
  if (words(withoutFacts(post, facts)).some((w) => !POST_WORDS.has(w) && w !== APP_NAME.toLowerCase())) return "unknown_fact";
  return null;
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The checked script: each shot with its milestone, and the post. */
export interface ShowcaseScript {
  shots: { milestoneId: string; caption: string }[];
  postText: string;
}

/** The model's answer as the script to store, or why it cannot be used. */
export function finaliseShowcaseScript(json: unknown, facts: ShowcaseScriptFacts): ShowcaseScript | { refused: ShowcaseScriptRefusal } {
  const parsed = ShowcaseScriptOutput.safeParse(json);
  if (!parsed.success) return { refused: "limits" };
  const shots = parsed.data.shots.map((s) => ({ card: s.card.trim(), caption: oneLine(s.caption) }));
  const post = oneLine(parsed.data.post);
  const problem = checkShowcaseScript({ shots, post }, facts);
  if (problem) return { refused: problem };
  // Date order, as the story shows them.
  const order = new Map(facts.cards.map((c, i) => [c.card, i]));
  const sorted = [...shots].sort((a, b) => (order.get(a.card) ?? 0) - (order.get(b.card) ?? 0));
  return { shots: sorted.map((s) => ({ milestoneId: facts.cards.find((c) => c.card === s.card)!.milestoneId, caption: s.caption })), postText: post };
}

// ---------------------------------------------------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------------------------------------------------

export interface ShowcaseScriptUsage {
  calls: number;
  costMinor: number;
  model: string | null;
  mode: "live" | "mock" | null;
}

export interface ShowcaseScriptStepContext {
  models: Pick<ModelClient, "complete">;
  facts: ShowcaseScriptFacts;
  signal?: AbortSignal;
  scope?: string;
  attribution?: UsageAttribution;
  log?: { warn(obj: Record<string, unknown>, msg?: string): void };
}

export type ShowcaseScriptStepResult =
  | { outcome: "written"; script: ShowcaseScript; refusals: ShowcaseScriptRefusal[]; usage: ShowcaseScriptUsage }
  | { outcome: "dropped"; reason: ShowcaseScriptRefusal; refusals: ShowcaseScriptRefusal[]; usage: ShowcaseScriptUsage };

const NO_USAGE: ShowcaseScriptUsage = { calls: 0, costMinor: 0, model: null, mode: null };
const addUsage = (u: ShowcaseScriptUsage, res: CompleteResult<unknown>): ShowcaseScriptUsage => ({ calls: u.calls + 1, costMinor: u.costMinor + Math.max(0, res.cost.costMinorInt), model: res.model, mode: res.mode });

/**
 * `showcaseScript`: one call, the check, one retry that names the rule the answer broke, then the script or a drop. A
 * call that fails (no key, used-up credits, an outage) throws: nothing was written.
 */
export async function runShowcaseScriptStep(ctx: ShowcaseScriptStepContext): Promise<ShowcaseScriptStepResult> {
  let usage = NO_USAGE;
  const refusals: ShowcaseScriptRefusal[] = [];
  let retry: ShowcaseScriptRefusal | null = null;
  for (let call = 0; call < SHOWCASE_SCRIPT_MAX_CALLS; call++) {
    const req = buildShowcaseScriptRequest(ctx.facts, { retry });
    const res = await ctx.models.complete({ ...req, signal: ctx.signal, scope: ctx.scope, attribution: { ...ctx.attribution, kind: SHOWCASE_SCRIPT_USAGE_KIND } });
    usage = addUsage(usage, res);
    const fin = finaliseShowcaseScript(res.json, ctx.facts);
    if (!("refused" in fin)) return { outcome: "written", script: fin, refusals, usage };
    refusals.push(fin.refused);
    retry = fin.refused;
    ctx.log?.warn({ refused: fin.refused, call: call + 1 }, "showcase script: the answer was not usable");
  }
  return { outcome: "dropped", reason: refusals[refusals.length - 1]!, refusals, usage };
}
