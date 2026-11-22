/**
 * "I posted it" (WP-08 T4; founder decision D1, Nov 16, 2026): a post counts as posted only after the founder says so,
 * and as visited only once a first visit came back through that post's own link. A tap on Share is never a post.
 * Pure, no Zod: browser code imports this from "@foundmill/shared/post-published".
 */
import { POST_NETWORKS } from "./post-draft";
import { shareHostOf, shareLabelOf } from "./share-targets";

/** The longest link a founder may paste. */
export const POST_URL_MAX = 500;

export const POST_PUBLISHED_WORDS = { question: "Did you post it?", yes: "Yes, I posted it", notYet: "Not yet", linkLabel: "Paste the post's link" } as const;

const isPostNetwork = (n: string | null): n is (typeof POST_NETWORKS)[number] => n !== null && (POST_NETWORKS as readonly string[]).includes(n);
const bare = (host: string): string => host.replace(/^www\./, "");

/**
 * Why a pasted link cannot be the post's address, or null: https only, on the network's own host, no credentials, at
 * most 500 characters. A message app or no network takes no link.
 */
export function postUrlProblem(network: string | null, url: string): string | null {
  if (url.length > POST_URL_MAX) return "That link is too long.";
  if (!isPostNetwork(network)) return "A link needs a network.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That is not a web address.";
  }
  if (parsed.protocol !== "https:") return "The link must start with https://.";
  if (parsed.username || parsed.password) return "The link must not hold a name or a password.";
  const host = shareHostOf(network);
  if (!host || bare(parsed.hostname) !== bare(host)) return `The link must be on ${shareLabelOf(network)}.`;
  return null;
}

/** The line under a confirmed post: "Posted on X, Nov 16". */
export function postedLine(network: string | null, at: Date, timeZone?: string | null): string {
  const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timeZone || "UTC" });
  return isPostNetwork(network) ? `Posted on ${shareLabelOf(network)}, ${day}` : `Posted, ${day}`;
}
