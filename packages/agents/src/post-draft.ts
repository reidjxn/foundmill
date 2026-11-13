/**
 * Posts the social agent drafts for the founder to share by tap (docs/NETWORK.md F3 "Tap-to-post", F7 "Posting";
 * founder, Nov 12, 2026: "a post the social channel agent wrote"). Drafting is separate from running the channel: an
 * agent cannot publish to a network the founder posts by tap, so nothing here launches, schedules, publishes or
 * measures anything. It produces words, and the founder's own press does the rest.
 *
 * Pure, like the rest of this package:
 * - `postDraftDecision`: whether a draft may be written at all (the rules and the caps), from plain facts.
 * - `postDraftFacts` and `buildPostDraftRequest`: what the agent is given. Only what is already public or the
 *   founders' own words: the project's name, its published page and the one thing that happened. Never a person's
 *   name or address, never a count, never money.
 * - `checkPostDraft` and `finalisePostDraft`: the check of the answer before it is stored.
 * - `runPostDraftStep`: one call, one retry with the reason when the answer is refused, then the draft is written
 *   through the store it is given, or dropped with a reason code (never the words).
 *
 * apps/orchestrator's `draftSharePost` activity and apps/api's in-process fallback both run the step through their own
 * model client (the usual credits gate and usage ledger, kind `post_draft`) and packages/db's store.
 */
import { APP_NAME } from "@foundmill/config";
import type { CompleteResult, ModelClient, UsageAttribution } from "@foundmill/models";
import { PostDraftOutput } from "@foundmill/models/schemas";
import { TEAM_POST_CAPS, TEAM_POST_SUBJECT_LABELS, TEAM_POST_TEXT_MIN, teamPostFits, teamPostTextBudget, type PageStage, type TeamPostSubject, type TeamPostTrigger } from "@foundmill/shared";
import { buildSystemPrompt } from "./club-rules";
import { inertJson, plainModelText, untrustedBlock } from "./foundations";
import { postDraftPrompt } from "./prompts/post-draft";
import { getChannelTemplate } from "./registry";
import type { RouteKey } from "./types";

/** The route the draft runs on (packages/models `routing.ts`: Sonnet at low effort, shared with the project page). */
export const POST_DRAFT_ROUTE = "projectPage" as const satisfies RouteKey;
/** The usage ledger's `kind` for a post draft's calls: booked to the business like every other model call. */
export const POST_DRAFT_USAGE_KIND = "post_draft";
/** What the limiter books for the call: a post is a few dozen tokens of JSON after a short, low-effort think. */
export const POST_DRAFT_RESERVE_TOKENS = 600;
/** The channel whose agent writes the posts. */
export const POST_DRAFT_CHANNEL = "social" as const;
/** One retry with the reason, then the draft is dropped. */
export const POST_DRAFT_MAX_CALLS = 2;

// ---------------------------------------------------------------------------------------------------------------------
// Whether a draft is written
// ---------------------------------------------------------------------------------------------------------------------

/** Everything the decision reads, as plain facts. */
export interface PostDraftGates {
  /** A sample business shows nothing in public and gets no drafts. */
  isDemo: boolean;
  /** Stop all agents, a revoked key or used-up credits (the team-wide stop), or an archived business. */
  agentsStopped: boolean;
  /** The social channel is available and the founder posts it by tap (`ChannelAvailability.byTap`). */
  channelByTap: boolean;
  /** The founder put the social channel on the Channel Board: their "yes, write posts for me". */
  channelOnBoard: boolean;
  /** The channel's agent is paused (by hand or by its cap). */
  agentPaused: boolean;
  /** The project's page is published: the post is written from it and points to it. */
  pageLive: boolean;
  /** A draft was already written (or tried) for this trigger, whatever became of it. */
  alreadyForTrigger: boolean;
  /** A draft about the same thing is still waiting to be shared. */
  waitingForSubject: boolean;
  /** Drafts written or tried in the last 24 hours and the last 7 days. */
  inLastDay: number;
  inLastWeek: number;
}

export const POST_DRAFT_SKIPS = ["sample_business", "agents_stopped", "not_by_tap", "off_the_board", "agent_paused", "page_not_live", "already_drafted", "already_waiting", "daily_cap", "weekly_cap"] as const;
export type PostDraftSkip = (typeof POST_DRAFT_SKIPS)[number];

/**
 * Whether the social agent drafts a post now, and if not, why (a code for the log; nothing is said to the founder: a
 * post that was not drafted is not a problem to report). The order is from what never changes to what might.
 */
export function postDraftDecision(g: PostDraftGates, caps: { perDay: number; perWeek: number } = TEAM_POST_CAPS): { draft: true } | { draft: false; reason: PostDraftSkip } {
  const no = (reason: PostDraftSkip) => ({ draft: false as const, reason });
  if (g.isDemo) return no("sample_business");
  if (g.agentsStopped) return no("agents_stopped");
  if (!g.channelByTap) return no("not_by_tap");
  if (!g.channelOnBoard) return no("off_the_board");
  if (g.agentPaused) return no("agent_paused");
  if (!g.pageLive) return no("page_not_live");
  if (g.alreadyForTrigger) return no("already_drafted");
  if (g.waitingForSubject) return no("already_waiting");
  if (g.inLastDay >= caps.perDay) return no("daily_cap");
  if (g.inLastWeek >= caps.perWeek) return no("weekly_cap");
  return { draft: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the agent is given
// ---------------------------------------------------------------------------------------------------------------------

/** Everything the model sees about the project. Nothing else may be added to a request. */
export interface PostDraftFacts {
  projectName: string;
  /** The page as its founders published it. */
  page: { pitch: string; about: string; forWhom: string; stage: PageStage };
  fact: {
    trigger: TeamPostTrigger;
    subject: TeamPostSubject;
    /** The subject's public words ("Page live"). */
    label: string;
    /** What happened, in one sentence written here, with its date. */
    sentence: string;
    /** The date it happened, as a founder reads it ("Nov 12, 2026"). */
    on: string;
  };
  /** The most characters the post may have beside its link. */
  maxChars: number;
  /**
   * What the project's earlier posts led to in the last 7 days, counted from real outcomes (packages/db
   * `postAttributions.weekSummary`: at most three lines; none in a quiet week). Data for the agent, never words for the
   * post: the check reads none of it, so a figure from here is refused as one the facts do not give.
   */
  learned: string[];
}

export interface PostDraftFactsInput {
  businessName: string;
  /** The published page. Only its pitch, about, who it is for and stage are read. */
  page: { pitch: string; about: string; forWhom: string; stage: PageStage };
  trigger: TeamPostTrigger;
  subject: TeamPostSubject;
  /** When it happened. */
  at: Date;
  /** The business's time zone (the date is the business's own day); UTC without one. */
  timeZone?: string | null;
  /** The link the code will attach, for the length the post may have. */
  link: string | undefined;
  /** What earlier posts led to (`PostDraftFacts.learned`). */
  learned?: readonly string[];
}

const usDate = (at: Date, timeZone?: string | null): string => {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  try {
    return at.toLocaleDateString("en-US", { ...options, timeZone: timeZone || "UTC" });
  } catch {
    // A stored zone the runtime does not know: the day in UTC.
    return at.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
  }
};

/** What happened, as a sentence. Written here from the subject and the date, never from a stored label or a person. */
export function postFactSentence(trigger: TeamPostTrigger, subject: TeamPostSubject, on: string): string {
  const what = subject === "page_live" ? `The project's public page went live on ${on}.` : `The first person confirmed that they follow the project, on ${on}.`;
  return trigger === "milestone_shown" ? `${what} The founders chose to show this milestone ("${TEAM_POST_SUBJECT_LABELS[subject]}") on the page.` : what;
}

/**
 * The facts for a draft: the project's name, the four public fields of its published page, and the one thing that
 * happened. The function takes nothing else, so nothing else can reach the model.
 */
export function postDraftFacts(input: PostDraftFactsInput): PostDraftFacts {
  const on = usDate(input.at, input.timeZone);
  return {
    projectName: input.businessName.replace(/\s+/g, " ").trim(),
    page: { pitch: input.page.pitch, about: input.page.about, forWhom: input.page.forWhom, stage: input.page.stage },
    fact: { trigger: input.trigger, subject: input.subject, label: TEAM_POST_SUBJECT_LABELS[input.subject], sentence: postFactSentence(input.trigger, input.subject, on), on },
    maxChars: teamPostTextBudget(input.link),
    learned: (input.learned ?? []).slice(0, 3).map((l) => l.replace(/\s+/g, " ").trim().slice(0, 300)),
  };
}

/** Why an answer was not used. A code for the log and for the retry; the words of the draft are never kept. */
export const POST_DRAFT_REFUSALS = ["limits", "too_long", "url", "email", "mention", "phone", "markup", "invented_figure", "hashtag", "emoji", "hype", "claim", "banned_phrase", "platform_mention"] as const;
export type PostDraftRefusal = (typeof POST_DRAFT_REFUSALS)[number];

/** What the retry says about the answer that was refused: the rule it broke, never the answer itself. */
export const POST_DRAFT_RETRY_NOTES: Readonly<Record<PostDraftRefusal, string>> = {
  limits: "Your last draft was not used: it was empty or not a post. Write one or two plain sentences.",
  too_long: "Your last draft was not used: it was longer than max_chars. Write it again in fewer words, and leave short empty.",
  url: "Your last draft was not used: it contained a link or a web address. The link is added after your words; write none.",
  email: "Your last draft was not used: it contained an email address. Write none.",
  mention: "Your last draft was not used: it contained an @mention. Write none.",
  phone: "Your last draft was not used: it contained a phone number. Write none.",
  markup: "Your last draft was not used: it contained markup. Write plain text only, with no Markdown, HTML or mention markup.",
  invented_figure: "Your last draft was not used: it contained a number or a quantity that is not in the inputs. Write it again with no figure the inputs do not give.",
  hashtag: "Your last draft was not used: it contained a hashtag the page does not use. Write none.",
  emoji: "Your last draft was not used: it contained an emoji. Write none.",
  hype: "Your last draft was not used: it contained praise, hype or an exclamation mark. Say what happened plainly.",
  claim: "Your last draft was not used: it claimed customers, reviews or results that are not in the inputs. Say only what the fact and the page say.",
  banned_phrase: "Your last draft was not used: it used a phrase this product never uses. Say what the project is and what happened, in plain words, and nothing about why its founders started it.",
  platform_mention: `Your last draft was not used: it mentioned AI or ${APP_NAME}, which the page is not about. Leave both out.`,
};

export interface PostDraftRequest {
  route: typeof POST_DRAFT_ROUTE;
  system: string[];
  messages: { role: "user"; content: string }[];
  schema: typeof PostDraftOutput;
  reserveTokens: number;
}

/**
 * The house rules and the social agent's instructions, then the post prompt (system); the project's name, the fact and
 * the length as trusted JSON, and the published page inside <untrusted_content> (the user turn): the page is its
 * founders' own text, which may say anything, so it is data and never an instruction, as the idea card is for the
 * page draft. A retry adds one line naming the rule the last answer broke.
 */
export function buildPostDraftRequest(facts: PostDraftFacts, options: { retry?: PostDraftRefusal | null } = {}): PostDraftRequest {
  const trusted = {
    post_request: {
      project_name: facts.projectName,
      fact: { trigger: facts.fact.trigger, subject: facts.fact.subject, label: facts.fact.label, sentence: facts.fact.sentence, on: facts.fact.on },
      max_chars: facts.maxChars,
      // Counted outcomes of earlier posts, for the agent to learn from (which kind of post and place worked). Never to
      // be repeated: a post states no count, and the check refuses one.
      ...(facts.learned.length ? { earlier_posts_led_to: facts.learned } : {}),
    },
  };
  const parts = ["```json\n" + inertJson(trusted) + "\n```", untrustedBlock("project_page", { project_page: { pitch: facts.page.pitch, about: facts.page.about, for_whom: facts.page.forWhom, stage: facts.page.stage } })];
  if (options.retry) parts.push(POST_DRAFT_RETRY_NOTES[options.retry]);
  parts.push("Draft the post now.");
  return {
    route: POST_DRAFT_ROUTE,
    system: [buildSystemPrompt({ businessName: facts.projectName, appName: APP_NAME, template: getChannelTemplate(POST_DRAFT_CHANNEL) }), postDraftPrompt.render({ business_name: facts.projectName, APP_NAME, max_chars: facts.maxChars })],
    messages: [{ role: "user", content: parts.join("\n\n") }],
    schema: PostDraftOutput,
    reserveTokens: POST_DRAFT_RESERVE_TOKENS,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The check of the answer
// ---------------------------------------------------------------------------------------------------------------------

/** Everything the facts say, as one text: what a draft may repeat. */
function factsText(facts: PostDraftFacts): string {
  return [facts.projectName, facts.page.pitch, facts.page.about, facts.page.forWhom, facts.fact.sentence, facts.fact.on, facts.fact.label].join("\n");
}
/** The page's own words and the project's name: where a hashtag, a word of praise or a named thing may come from. */
function ownWords(facts: PostDraftFacts): string {
  return [facts.projectName, facts.page.pitch, facts.page.about, facts.page.forWhom].join("\n");
}

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const numbersIn = (text: string): string[] => (text.match(NUMBER_RE) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, ""));
/** A quantity said in words ("hundreds of", "ten thousand", "dozens"). */
const QUANTITY_RE = /\b(?:dozens?|hundreds?|thousands?|millions?|billions?)\b/gi;
const SCHEME_URL_RE = /\b(?:(?:https?|ftp):\/\/|www\.)\S+|(?:^|[\s(<:])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
/** A bare web address ("example.com", "shiftly.io/join"). */
const BARE_DOMAIN_RE = /(?<![@\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+/;
const MENTION_RE = /(?:^|[^\w@])@[A-Za-z0-9_]{2,}/;
/** A phone number as a person writes one, with or without a country code. */
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\+\d[\d\s().-]{8,}\d|(?<!\d)\d(?:[\s.-]?\d){8,}(?!\d)/;
/** Markdown and HTML a plain post never carries (links, mentions and tags are caught by `plainModelText`). */
const MARKDOWN_RE = /\*\*|__|`|^\s{0,3}#{1,6}\s|^\s{0,3}(?:[-*+]|\d+[.)])\s|^\s{0,3}>|<\/?[a-z][^>]*>|\[\[|\]\(/im;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}/u;
/** Praise and hype a plain post does not carry. */
const HYPE_RE = /!|\b(?:excited|thrilled|proud|proudly|delighted|stoked|amazing|awesome|incredible|huge|massive|best|leading|revolutionary|world-class|game-?chang\w*|cutting-edge|groundbreaking|disrupt\w*|unmatched|#1|number one)\b/gi;
/** Customers, reviews and results a post may only state when the inputs do. */
const CLAIM_RE = /\b(?:customers?|clients?|users?|subscribers?|sign-?ups?|orders?|sales|revenue|downloads?|reviews?|testimonials?|awards?|sold out|best-?selling|loved by|trusted by|used by|waitlist|followers)\b/gi;

/**
 * Phrases this product never writes (CLAUDE.md "Subtext, never text"; `scripts/banned-terms.mjs` holds the same three
 * for the source). Refused wherever they appear, whatever the page says: a post drafted here never frames a project as
 * an answer to work or employment.
 */
export const POST_SUBTEXT_PATTERNS: readonly RegExp[] = [
  /\bday\s+jobs?\b|\b(?:9|nine)\s*(?:-|–|to)\s*(?:5|five)\b|\bjob[-\s]proof\w*|\bjob\s+market\b|\binstead\s+of\s+(?:getting\s+|finding\s+|having\s+)?a\s+job\b|\b(?:quit|quitting|leave|leaving|lose|losing|lost)\s+(?:your|my|their|a|the)\s+jobs?\b|\bbe(?:come|ing)?\s+your\s+own\s+boss\b/gi,
  /\bunemploy(?:ed|ment)\b|\blaid[-\s]off\b|\blay-?offs?\b|\bjobless\w*|\bredundanc(?:y|ies)\b/gi,
  /\bAI\s+(?:is\s+|will\s+be\s+|will\s+)?(?:tak(?:e|es|ing)|replac(?:e|es|ing)|eat(?:s|ing)?)\s+(?:your\s+|our\s+|the\s+|all\s+the\s+|people's\s+)?(?:jobs?|work|careers?)\b|\breplaced\s+by\s+(?:an?\s+)?AI\b|\bbefore\s+AI\s+(?:takes|does)\b/gi,
];

/**
 * Sport words the product's own prose never uses (CLAUDE.md, the 2026-10-08 rule). A post is about the founders'
 * project, which may be about anything, so one of these passes only where the page's own words use it.
 */
export const POST_VOCAB_PATTERNS: readonly RegExp[] = [
  /\bsquads?\b/gi,
  /\bdugouts?\b/gi,
  /\bclubs?\b/gi,
  /\bcrests?\b/gi,
  /\bcaptains?\b/gi,
  /\btroph(?:y|ies)\b/gi,
  /\bkick[\s-]?offs?\b|\bkick(?:s|ed|ing)?\s+off\b/gi,
  /\bmatch[\s-]?days?\b|\bteam[\s-]?sheets?\b|\bhalf[\s-]?time\b|\bfinal\s+whistle\b|\bplayer of the match\b/gi,
  /\bleague\s+(?:tables?|positions?)\b|\b(?:starting\s+)?line[\s-]?ups?\b|\bscouting\s+reports?\b|\bform\s+guides?\b|\btraining\s+ground\b/gi,
];

/** The platform's own name, and AI: a post is about the project, not about what it was built with. */
const PLATFORM_PATTERNS: readonly RegExp[] = [new RegExp(`\\b${APP_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), /\bA\.?I\b/g, /\bartificial intelligence\b/gi];

const lower = (s: string) => s.toLowerCase();
/**
 * Every match of `re` in `text` that `allowed` does not also contain (case-insensitive). A plural passes where the
 * allowed text has the singular ("customers" where the page says "customer").
 */
function notIn(text: string, re: RegExp, allowed: string): string[] {
  const have = lower(allowed);
  return (text.match(re) ?? []).filter((m) => {
    const word = lower(m.trim());
    return !have.includes(word) && !(word.length > 3 && word.endsWith("s") && have.includes(word.slice(0, -1)));
  });
}

/**
 * Why a draft cannot be used, or null when it can. Pure. In order: it must be a few plain words; carry no link (the
 * code attaches the only one), address, @mention, markup or phone number; no figure and no quantity the facts do not
 * give; no hashtag the page does not use; no emoji; no praise, no claim of customers or results the page does not
 * make; none of the phrases the product never writes; and no mention of AI or the platform unless the page has one.
 */
export function checkPostDraft(text: string, facts: PostDraftFacts): PostDraftRefusal | null {
  const all = factsText(facts);
  const own = ownWords(facts);
  if (text.trim().length < TEAM_POST_TEXT_MIN || !/\p{L}{2,}/u.test(text)) return "limits";
  if (SCHEME_URL_RE.test(text)) return "url";
  if (EMAIL_RE.test(text)) return "email";
  if (notIn(text, BARE_DOMAIN_RE, own).length > 0) return "url";
  if (MENTION_RE.test(text)) return "mention";
  if (MARKDOWN_RE.test(text) || plainModelText(text) !== text) return "markup";
  // A figure the facts carry (a year in the pitch, the date) may read like part of a number; only one they do not give is a phone number.
  if (PHONE_RE.test(text) && !lower(all).includes(lower(PHONE_RE.exec(text)![0]))) return "phone";
  const known = new Set(numbersIn(all));
  if (numbersIn(text).some((n) => !known.has(n))) return "invented_figure";
  if (notIn(text, QUANTITY_RE, all).length > 0) return "invented_figure";
  if (notIn(text, HASHTAG_RE, own).length > 0) return "hashtag";
  if (EMOJI_RE.test(text)) return "emoji";
  if (notIn(text, HYPE_RE, own).length > 0) return "hype";
  if (notIn(text, CLAIM_RE, all).length > 0) return "claim";
  if (POST_SUBTEXT_PATTERNS.some((re) => (text.match(re) ?? []).length > 0)) return "banned_phrase";
  if (POST_VOCAB_PATTERNS.some((re) => notIn(text, re, own).length > 0)) return "banned_phrase";
  if (PLATFORM_PATTERNS.some((re) => notIn(text, re, own).length > 0)) return "platform_mention";
  return null;
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * The model's answer as the words to store, or why it cannot be used. `text` is taken when it passes the check and
 * goes out whole on every network that opens ready to post (`teamPostFits`, beside the link the code attaches);
 * otherwise `short`, held to the same; otherwise the answer is refused with the first rule `text` broke. The stored
 * words are one text: the share panel has one field, and what the founder changes there must reach every network.
 */
export function finalisePostDraft(json: unknown, facts: PostDraftFacts, link: string | undefined): { text: string } | { refused: PostDraftRefusal } {
  const parsed = PostDraftOutput.safeParse(json);
  if (!parsed.success) return { refused: "limits" };
  const candidates = [parsed.data.text, parsed.data.short].map(oneLine).filter((c) => c.length > 0);
  let first: PostDraftRefusal | null = null;
  for (const candidate of candidates) {
    const problem = checkPostDraft(candidate, facts) ?? (teamPostFits(candidate, link) ? null : "too_long");
    if (!problem) return { text: candidate };
    first ??= problem;
  }
  return { refused: first ?? "limits" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------------------------------------------------

export interface PostDraftUsage {
  calls: number;
  costMinor: number;
  model: string | null;
  mode: "live" | "mock" | null;
}

/** Where the step writes. packages/db's store writes the asset and the caller's event in one transaction. */
export interface PostDraftStore {
  /**
   * Stores the draft, unless one was written for the trigger meanwhile or the caps were reached (checked again inside
   * the write, under the business's lock). Returns the asset's id when it wrote.
   */
  write(input: { text: string; usage: PostDraftUsage }): Promise<{ written: boolean; assetId: string | null }>;
  /** Records that the attempt was dropped, so the trigger is not tried (and paid for) again. Never the words. */
  drop(input: { reason: PostDraftRefusal; usage: PostDraftUsage }): Promise<void>;
}

export interface PostDraftStepContext {
  models: Pick<ModelClient, "complete">;
  facts: PostDraftFacts;
  /** The link the code attaches (for the fit); undefined when the page has none. */
  link: string | undefined;
  signal?: AbortSignal;
  scope?: string;
  attribution?: UsageAttribution;
  log?: { info(obj: Record<string, unknown>, msg?: string): void; warn(obj: Record<string, unknown>, msg?: string): void };
}

export type PostDraftStepResult =
  | { outcome: "written"; assetId: string; refusals: PostDraftRefusal[]; usage: PostDraftUsage }
  | { outcome: "exists"; refusals: PostDraftRefusal[]; usage: PostDraftUsage }
  | { outcome: "dropped"; reason: PostDraftRefusal; refusals: PostDraftRefusal[]; usage: PostDraftUsage };

const NO_USAGE: PostDraftUsage = { calls: 0, costMinor: 0, model: null, mode: null };
const addUsage = (u: PostDraftUsage, res: CompleteResult<unknown>): PostDraftUsage => ({ calls: u.calls + 1, costMinor: u.costMinor + Math.max(0, res.cost.costMinorInt), model: res.model, mode: res.mode });

/**
 * One draft: the call, the check, one retry that names the rule the answer broke, then the write or the drop. A call
 * that fails (no key, used-up credits, an outage) throws: nothing was written and nothing is recorded, so the caller
 * decides whether to try again. A refused answer is logged by its reason code only.
 */
export async function runPostDraftStep(ctx: PostDraftStepContext, store: PostDraftStore): Promise<PostDraftStepResult> {
  let usage = NO_USAGE;
  const refusals: PostDraftRefusal[] = [];
  let retry: PostDraftRefusal | null = null;
  for (let call = 0; call < POST_DRAFT_MAX_CALLS; call++) {
    const req = buildPostDraftRequest(ctx.facts, { retry });
    const res = await ctx.models.complete({ ...req, signal: ctx.signal, scope: ctx.scope, attribution: { ...ctx.attribution, kind: POST_DRAFT_USAGE_KIND } });
    usage = addUsage(usage, res);
    const fin = finalisePostDraft(res.json, ctx.facts, ctx.link);
    if ("text" in fin) {
      const out = await store.write({ text: fin.text, usage });
      return out.written && out.assetId ? { outcome: "written", assetId: out.assetId, refusals, usage } : { outcome: "exists", refusals, usage };
    }
    refusals.push(fin.refused);
    retry = fin.refused;
    ctx.log?.warn({ refused: fin.refused, call: call + 1, trigger: ctx.facts.fact.trigger }, "post draft: the answer was not usable");
  }
  const reason = refusals[refusals.length - 1]!;
  await store.drop({ reason, usage });
  return { outcome: "dropped", reason, refusals, usage };
}
