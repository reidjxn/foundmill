/**
 * A post draft (docs/NETWORK.md F3 "Tap-to-post"; docs/DECISIONS.md 2026-11-12): what a project is about to say on a
 * social network, as plain data. One shape for both ways a post leaves: the founder's own press in the network's share
 * window (./share-targets, the default, no connector) and an optional publishing connector.
 *
 * Pure, no Zod and nothing of any vendor: browser code imports this from "@foundmill/shared/post-draft". The Zod
 * schemas of the same shape (`PostDraft`, `PostDraftVariant`, `PostDraftImage`, `PostNetwork`) are in ./types, built
 * from these constants; they hold a link and an image address to https with no credentials (`isPostUrl`).
 *
 * `POST_NETWORKS` is append-only: a network is added at the end and never removed or reordered. Nothing here or in
 * ./share-targets assumes the list is today's eight: a network with no entry in `POST_NETWORK_LIMITS` gets
 * `POST_DEFAULT_LIMIT` (the strictest), and one with no share target simply has none.
 */

export const POST_NETWORKS = ["x", "linkedin", "facebook", "threads", "reddit", "bluesky", "instagram", "tiktok"] as const;
export type PostNetwork = (typeof POST_NETWORKS)[number];

/** A picture that goes with a post. `url` is https; `alt` says what it shows. */
export interface PostDraftImage {
  url: string;
  alt: string;
}

/** What one network gets where it differs from the draft: its own text, a title where its posts have one, its own link or picture. */
export interface PostDraftVariant {
  text: string;
  title?: string;
  link?: string;
  image?: PostDraftImage;
}

/** A draft: the words, the link they point to, a picture, and what differs per network. */
export interface PostDraft {
  text: string;
  link?: string;
  image?: PostDraftImage;
  variants: Partial<Record<PostNetwork, PostDraftVariant>>;
}

/** Outer bounds of a stored draft (the Zod schemas hold a draft to these; fitting brings each network under its own). */
export const POST_TEXT_MAX = 10_000;
export const POST_TITLE_MAX = 300;
export const POST_URL_MAX = 2048;
export const POST_IMAGE_ALT_MAX = 1000;

export const isPostNetwork = (value: unknown): value is PostNetwork => typeof value === "string" && (POST_NETWORKS as readonly string[]).includes(value);

/**
 * Whether `value` may be a draft's link or picture address: an absolute https URL with a host, no user name and no
 * password, no whitespace or control characters, at most `POST_URL_MAX` characters. A connector hands these to a
 * vendor that fetches them, so nothing else passes (no http, no `javascript:` or `data:`, no `user:pass@host`).
 */
export function isPostUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > POST_URL_MAX) return false;
  // No whitespace, control character or backslash (a parser reads a backslash as a slash, which moves the host).
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f\\]/.test(value)) return false;
  if (!/^https:\/\//i.test(value)) return false;
  // The host as written, before any parser tidies it: there must be one ("https:///p/x" has none), and a user part is
  // refused even when empty ("https://@host" parses with no user name at all).
  const authority = value.slice(8).split(/[/?#]/, 1)[0] ?? "";
  if (!authority || authority.includes("@")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
}

/**
 * How long a post may be on a network and how its link counts.
 * - `max`: the most characters of a post.
 * - `link`: "fixed": every link counts as `linkLength` characters whatever its own length; "full": a link counts as
 *   its own length; "apart": the link travels in its own field and takes nothing from the text.
 * - `weighted`: wide characters (emoji, CJK) count double, as X counts them.
 * - `titleMax`: the network's posts have a title of at most this many characters (Reddit).
 */
export interface PostNetworkLimit {
  max: number;
  link: "fixed" | "full" | "apart";
  linkLength?: number;
  weighted?: boolean;
  titleMax?: number;
}

/**
 * The limits as each network states them (checked Nov 12, 2026). Where a network counts in a unit smaller than what is
 * counted here (Bluesky counts whole symbols, we count UTF-16 units), the count here is the larger one, so a fitted
 * post is never over.
 */
export const POST_NETWORK_LIMITS: Readonly<Partial<Record<PostNetwork, PostNetworkLimit>>> = Object.freeze({
  // 280 weighted characters; every link is counted as 23 whatever its length.
  x: { max: 280, link: "fixed", linkLength: 23, weighted: true },
  linkedin: { max: 3000, link: "full" },
  facebook: { max: 63_206, link: "full" },
  threads: { max: 500, link: "full" },
  // A link post is a title and a link; the title is what is limited.
  reddit: { max: 40_000, link: "apart", titleMax: 300 },
  bluesky: { max: 300, link: "full" },
  instagram: { max: 2200, link: "full" },
  tiktok: { max: 2200, link: "full" },
});

/** What a network without its own entry gets: the strictest of the known ones, with the link counted in full. */
export const POST_DEFAULT_LIMIT: PostNetworkLimit = Object.freeze({ max: 280, link: "full", weighted: true });

export function postNetworkLimit(network: PostNetwork): PostNetworkLimit {
  return POST_NETWORK_LIMITS[network] ?? POST_DEFAULT_LIMIT;
}

/** Between the text and a link that follows it: a blank line. */
export const POST_LINK_SEPARATOR = "\n\n";
const ELLIPSIS = "…";

/** Code points X counts as one; everything else (emoji, CJK) counts as two. */
const LIGHT_RANGES: readonly (readonly [number, number])[] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const weightOf = (codePoint: number): number => (LIGHT_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to) ? 1 : 2);
const weightedLength = (text: string): number => {
  let n = 0;
  for (const ch of text) n += weightOf(ch.codePointAt(0) ?? 0);
  return n;
};

/** An address inside the text: with its scheme, or a bare domain ("example.com/page"). A "fixed" network counts each as its link length. */
const LINK_IN_TEXT = /https?:\/\/[^\s]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;

/** How many characters `text` takes on `network`, counted as that network counts (never fewer). */
export function postTextLength(text: string, network: PostNetwork): number {
  const limit = postNetworkLimit(network);
  const length = limit.weighted ? weightedLength : (s: string) => s.length;
  if (limit.link !== "fixed") return length(text);
  const each = limit.linkLength ?? 0;
  let links = 0;
  const rest = text.replace(LINK_IN_TEXT, () => ((links += 1), ""));
  return length(rest) + links * each;
}

/** What a link costs toward a network's limit when it follows the text: its own count and the blank line before it. */
export function postLinkLength(link: string | undefined, network: PostNetwork): number {
  if (!link) return 0;
  const limit = postNetworkLimit(network);
  if (limit.link === "apart") return 0;
  return (limit.link === "fixed" ? (limit.linkLength ?? link.length) : link.length) + POST_LINK_SEPARATOR.length;
}

/** The characters left for the text on `network` once the link has its place. Never below zero. */
export function postTextBudget(link: string | undefined, network: PostNetwork): number {
  return Math.max(0, postNetworkLimit(network).max - postLinkLength(link, network));
}

/**
 * `text` within `budget` as `measure` counts it: unchanged when it fits; otherwise cut at the last whole word that
 * fits, with an ellipsis. A word (an address in the text, a name) is never cut in half unless the text is one word.
 */
function shorten(text: string, budget: number, measure: (s: string) => number): string {
  const clean = text.trim();
  if (measure(clean) <= budget) return clean;
  const room = budget - measure(ELLIPSIS);
  if (room <= 0) return "";
  const points = Array.from(clean);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (measure(points.slice(0, mid).join("")) <= room) low = mid;
    else high = mid - 1;
  }
  let cut = points.slice(0, low).join("");
  const midWord = low < points.length && !/\s/u.test(points[low]!) && !/\s$/u.test(cut);
  if (midWord) {
    const at = cut.search(/\s+\S*$/u);
    if (at > 0) cut = cut.slice(0, at);
  }
  cut = cut.replace(/[\s,;:.\-–—]+$/u, "");
  return cut ? `${cut}${ELLIPSIS}` : "";
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** `text` shortened to what `network` takes beside `link` (the link itself is never touched). */
export function fitPostText(text: string, link: string | undefined, network: PostNetwork): string {
  return shorten(text, postTextBudget(link, network), (s) => postTextLength(s, network));
}

/**
 * The draft with a variant for each of `networks` that fits that network: the text shortened at a word with an
 * ellipsis where it is too long, the link never cut or dropped, and a `title` where the network's posts have one. A
 * variant the draft already carries is the starting point for its network (its own text, link and picture are kept).
 * Variants of networks not asked for stay as they are.
 */
export function fitPostDraft(draft: PostDraft, networks: readonly PostNetwork[] = POST_NETWORKS): PostDraft {
  const variants: Partial<Record<PostNetwork, PostDraftVariant>> = { ...draft.variants };
  for (const network of networks) {
    const own = draft.variants[network];
    const link = own?.link ?? draft.link;
    const limit = postNetworkLimit(network);
    const text = fitPostText(own?.text ?? draft.text, link, network);
    const title = limit.titleMax ? shorten(oneLine(own?.title ?? own?.text ?? draft.text), Math.min(limit.titleMax, POST_TITLE_MAX), (s) => s.length) : own?.title;
    variants[network] = { text, ...(title ? { title } : {}), ...(own?.link ? { link: own.link } : {}), ...(own?.image ? { image: own.image } : {}) };
  }
  return { ...draft, variants };
}

/** What `network` gets: its variant laid over the draft (the draft's own text, link and picture where the variant has none). */
export function postDraftFor(draft: PostDraft, network: PostNetwork): PostDraftVariant {
  const own = draft.variants[network];
  const link = own?.link ?? draft.link;
  const image = own?.image ?? draft.image;
  return { text: own?.text ?? draft.text, ...(own?.title ? { title: own.title } : {}), ...(link ? { link } : {}), ...(image ? { image } : {}) };
}

/** The text with its link after a blank line: what a network with one text field receives, and what "Copy text" copies. */
export function postTextWithLink(post: Pick<PostDraftVariant, "text" | "link">): string {
  const text = post.text.trim();
  if (!post.link) return text;
  return text ? `${text}${POST_LINK_SEPARATOR}${post.link}` : post.link;
}

/**
 * The draft with new words (the founder changed the text before sharing): every variant that repeated the draft's own
 * text follows it, and a variant that had words of its own keeps them. Links and pictures are untouched.
 */
export function withPostText(draft: PostDraft, text: string): PostDraft {
  if (text === draft.text) return draft;
  const variants: Partial<Record<PostNetwork, PostDraftVariant>> = {};
  for (const [network, variant] of Object.entries(draft.variants) as [PostNetwork, PostDraftVariant][]) {
    variants[network] = variant.text === draft.text ? { ...variant, text } : variant;
  }
  return { ...draft, text, variants };
}
