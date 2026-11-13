/**
 * What a shared team post led to (item 8, approved by the network session Nov 13, 2026; packages/db `post_links`,
 * `post_attributions`). A post the team drafted carries its own code in every link (`s.<code>`, ./via); a real outcome
 * that came back through one is credited to that post, last touch, at most one post per outcome:
 * - `follow`: a person confirmed from their own inbox that they follow the project (double opt-in), having arrived
 *   through the post;
 * - `reply`: an attributed follower replied to the project's email, for real, within 30 days of following;
 * - `payment`: a payment a vendor delivered that carries the post's code, or one from an attributed follower within 30
 *   days of following.
 * Visits are never counted or shown, in public or in private (network decision): a visit only proves a link was
 * opened, and a follow needs one first.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/post-outcomes".
 */
import { countOf } from "./copy";
import type { Section } from "./permissions";
import type { PostNetwork } from "./post-draft";
import { shareLabelOf } from "./share-targets";

export const POST_OUTCOME_KINDS = ["follow", "reply", "payment"] as const;
export type PostOutcomeKind = (typeof POST_OUTCOME_KINDS)[number];

/**
 * The section a reader must read to see an outcome of this kind: who follows and who replied are the CRM's, a payment
 * is Finance's (the same walls as "What worked", ./morning-brief `OUTCOME_SECTION`).
 */
export const POST_OUTCOME_SECTION: Readonly<Record<PostOutcomeKind, Section>> = {
  follow: "crm",
  reply: "crm",
  payment: "finance",
};

/** How long after a follow a reply or a payment from that follower is still credited to the post. */
export const POST_OUTCOME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Counted outcomes of one post (or one post on one network). */
export type PostOutcomeCounts = Readonly<Record<PostOutcomeKind, number>>;

export const NO_POST_OUTCOMES: PostOutcomeCounts = Object.freeze({
  follow: 0,
  reply: 0,
  payment: 0,
});

const WORDS: Readonly<Record<PostOutcomeKind, readonly [string, string]>> = {
  follow: ["follow", "follows"],
  reply: ["reply", "replies"],
  payment: ["payment", "payments"],
};

/** "2 follows, 1 reply": the kinds that happened, in order; empty when none did. */
function countWords(counts: PostOutcomeCounts): string[] {
  return POST_OUTCOME_KINDS.filter((k) => counts[k] > 0).map((k) =>
    countOf(counts[k], WORDS[k][0], WORDS[k][1]),
  );
}

/** "a, b and c". */
function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The counts a reader may see: the kinds behind a section they cannot read read 0. */
export function wallPostOutcomes(
  counts: PostOutcomeCounts,
  canRead: (section: Section) => boolean,
): PostOutcomeCounts {
  return {
    follow: canRead(POST_OUTCOME_SECTION.follow) ? counts.follow : 0,
    reply: canRead(POST_OUTCOME_SECTION.reply) ? counts.reply : 0,
    payment: canRead(POST_OUTCOME_SECTION.payment) ? counts.payment : 0,
  };
}

/**
 * The one line under a post on the Creative tab: "Led to 2 follows and 1 reply". Null when it led to nothing the
 * reader may see: a quiet post says nothing, never a zero.
 */
export function postOutcomeLine(counts: PostOutcomeCounts): string | null {
  const parts = countWords(counts);
  return parts.length ? `Led to ${andList(parts)}` : null;
}

/** Where a link was shared: the network's name, or "a copied or sent link" for a copy, a message or the device's sheet. */
export function postOutcomePlace(network: PostNetwork | null): string {
  return network ? shareLabelOf(network) : "a copied or sent link";
}

/** The words of a post as a learning line quotes them: one line, at most 40 characters. */
export function postQuote(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(one);
  return chars.length <= 40 ? one : `${chars.slice(0, 39).join("").trimEnd()}…`;
}

/**
 * What "What worked" says of an outcome a shared post brought (item 8; ./morning-brief `RealOutcome.viaPost`): what an outcome's
 * line adds when a shared post brought it, "from your post on X, Nov 12" ("from a link to your post, Nov 12" for a
 * copied or sent link). The date is the day the founder opened the share for the post (else the day it was drafted).
 */
export function viaPostWords(input: { network: PostNetwork | null; sharedAt: Date; timeZone?: string | null }): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: input.timeZone || "UTC" };
  let day: string;
  try {
    day = input.sharedAt.toLocaleDateString("en-US", options);
  } catch {
    day = input.sharedAt.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
  }
  return input.network ? `from your post on ${shareLabelOf(input.network)}, ${day}` : `from a link to your post, ${day}`;
}

/** Lines of the week summary at most. */
export const POST_WEEK_SUMMARY_MAX = 3;

/**
 * One line of the social channel's weekly learning: `w3: post "…" (X): 2 follows, 1 reply (Counted, real people)`
 * (`last 7 days: …` where there is no week number, as for a new draft). Null when the post led to nothing that week (a
 * quiet week adds no line, never a zero).
 */
export function postWeekLine(input: {
  week: number | null;
  text: string;
  network: PostNetwork | null;
  counts: PostOutcomeCounts;
}): string | null {
  const parts = countWords(input.counts);
  if (!parts.length) return null;
  const when = input.week === null ? "last 7 days" : `w${input.week}`;
  return `${when}: post "${postQuote(input.text)}" (${postOutcomePlace(input.network)}): ${parts.join(", ")} (Counted, real people)`;
}
