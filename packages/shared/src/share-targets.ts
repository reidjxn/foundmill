/**
 * Tap-to-post (docs/NETWORK.md F3; docs/DECISIONS.md 2026-11-12, founder: "the only by-hand part of the social post
 * should be clicking the button to actually post it"): for a drafted post, the address of each network's own share
 * window with the words and the link already in it. Foundmill posts nothing: no API, no key, no developer app. The
 * founder presses Post in the network's window, which Foundmill cannot see, so a press here is a share that was
 * opened and never a post that was made.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/share-targets".
 *
 * Every network is one of three kinds:
 * - `tap`: the window opens with the text and the link filled in; pressing Post is the only step. Only these count
 *   toward the social channel being available by tap (`postsByTap`, read by ./channel-availability).
 * - `link_only`: the window opens with the link and its preview card, and the words are not carried (or one more
 *   choice is the founder's to make there). Offered, said honestly, never counted.
 * - `copy`: the network takes no ready-made post from the web. "Copy text" and the image to download. Never counted.
 *
 * Each address below was checked against the network's own pages or its live answer on Nov 12, 2026; the note on each
 * says what was found and where. A network whose window stops taking the text is moved down a kind here, and the
 * channel's availability follows from this file with no other edit. An address is built only from a draft fitted to
 * its network (./post-draft), every value percent-encoded, always https to the network's own host: nothing a founder
 * types can change the host or add a parameter.
 *
 * A network in `POST_NETWORKS` with no entry here has no target: `shareTargets` leaves it out.
 */
import { POST_NETWORKS, fitPostDraft, postDraftFor, postLinkLength, postNetworkLimit, postTextLength, postTextWithLink, type PostDraft, type PostDraftImage, type PostDraftVariant, type PostNetwork } from "./post-draft";

export const SHARE_TARGET_KINDS = ["tap", "link_only", "copy"] as const;
export type ShareTargetKind = (typeof SHARE_TARGET_KINDS)[number];

/** What a founder reads above each group of the share panel, and the one line under it. */
export const SHARE_KIND_WORDS: Readonly<Record<ShareTargetKind, { title: string; note: string }>> = {
  tap: { title: "Opens ready to post", note: "The text and the link are filled in. Press Post there and it is out." },
  link_only: { title: "Opens with your link", note: "Opens with your link; the text is not carried." },
  copy: { title: "Copy and post in the app", note: "These take no ready-made post from the web. Copy the text, then post it in the app." },
};

/** Percent-encodes one value for a query string: everything but letters, digits and `-._~`. Never throws. */
export function encodeShareValue(value: string): string {
  // A lone surrogate (half of a cut emoji) cannot be encoded; it becomes the replacement character.
  const whole = value.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  return encodeURIComponent(whole).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `base` (a constant https address with no query) with `params` appended in order, each value encoded; empty values are left out. */
function shareAddress(base: string, params: readonly (readonly [string, string | undefined])[]): string {
  const query = params
    .filter((p): p is readonly [string, string] => typeof p[1] === "string" && p[1].length > 0)
    .map(([key, value]) => `${key}=${encodeShareValue(value)}`)
    .join("&");
  return query ? `${base}?${query}` : base;
}

interface NetworkShare {
  label: string;
  kind: ShareTargetKind;
  /** The network's own host: every address of this network is https to exactly this host. */
  host?: string;
  /** The address for a fitted post, or null when this post cannot be opened there (a link-only window with no link). */
  address?: (post: PostDraftVariant) => string | null;
  /** The parameters `address` may carry (tests hold every address to these). */
  params?: readonly string[];
  /** The network's own honest line where the group's line is not exactly true of it. */
  note?: string;
}

/**
 * How a tap works on each network. Sources, all read Nov 12, 2026.
 */
const NETWORK_SHARES: Readonly<Partial<Record<PostNetwork, NetworkShare>>> = Object.freeze({
  /*
   * X. `https://x.com/intent/post?text=…&url=…` opens the composer with the text and the link after it. X's own guide
   * to web intents is no longer on its documentation site (developer.x.com's "Web Intent" guide now redirects to the
   * documentation's front page), so this rests on the live answer: signed out, x.com/intent/post answers with a
   * sign-in redirect that carries `text` and `url` through unchanged, and twitter.com/intent/tweet redirects to x.com.
   * 280 weighted characters, a link counts as 23.
   */
  x: { label: "X", kind: "tap", host: "x.com", params: ["text", "url"], address: (p) => shareAddress("https://x.com/intent/post", [["text", p.text], ["url", p.link]]) },
  /*
   * LinkedIn. The documented share address takes a link and nothing else:
   * `https://www.linkedin.com/sharing/share-offsite/?url=…` (Microsoft Learn, LinkedIn "Share Plugin": only `data-url`;
   * live, it redirects through sign-in to the share window with the `url`). An undocumented feed address is reported to
   * pre-fill text "usually, not guaranteed"; it is not used, so LinkedIn is link only.
   */
  linkedin: { label: "LinkedIn", kind: "link_only", host: "www.linkedin.com", params: ["url"], address: (p) => (p.link ? shareAddress("https://www.linkedin.com/sharing/share-offsite/", [["url", p.link]]) : null) },
  /*
   * Facebook. No text can be pre-filled: Meta's Share dialog reference lists `href` and `hashtag` and no text
   * parameter (the old `quote` is gone), and its dialog address needs an app id, which Foundmill does not have. The
   * plain sharer address takes the link: `https://www.facebook.com/sharer/sharer.php?u=…`.
   */
  facebook: { label: "Facebook", kind: "link_only", host: "www.facebook.com", params: ["u"], address: (p) => (p.link ? shareAddress("https://www.facebook.com/sharer/sharer.php", [["u", p.link]]) : null) },
  /*
   * Threads. `https://www.threads.com/intent/post?text=…&url=…` (Meta, "Threads web intents": `text` "the text that
   * the post dialog should be prefilled with", `url` "the URL for an optional link attachment"). 500 characters.
   */
  threads: { label: "Threads", kind: "tap", host: "www.threads.com", params: ["text", "url"], address: (p) => shareAddress("https://www.threads.com/intent/post", [["text", p.text], ["url", p.link]]) },
  /*
   * Reddit. `https://www.reddit.com/submit?url=…&title=…` opens the post form with the link and the title (no page of
   * Reddit's documents it; a share library's maintainer confirmed both fields fill, Oct 12, 2026, and the address
   * answers today). The founder still has to choose a community there before posting, so it is not one press: link
   * only, with its own line.
   */
  reddit: {
    label: "Reddit",
    kind: "link_only",
    host: "www.reddit.com",
    params: ["url", "title"],
    address: (p) => (p.link ? shareAddress("https://www.reddit.com/submit", [["url", p.link], ["title", p.title ?? p.text]]) : null),
    note: "Opens with your title and link. You choose the community there.",
  },
  /*
   * Bluesky. `https://bsky.app/intent/compose?text=…` (Bluesky documentation, "Action Intent Links": one parameter,
   * `text`; the link goes in the text; 300 characters).
   */
  bluesky: { label: "Bluesky", kind: "tap", host: "bsky.app", params: ["text"], address: (p) => shareAddress("https://bsky.app/intent/compose", [["text", postTextWithLink(p)]]) },
  // Instagram and TikTok take no pre-filled post from a web address: the text is copied and posted in the app.
  instagram: { label: "Instagram", kind: "copy" },
  tiktok: { label: "TikTok", kind: "copy" },
});

/** The kind a network is when its window has everything it needs (a link-only window with no link falls to `copy`). */
export function shareKindOf(network: PostNetwork): ShareTargetKind | null {
  return NETWORK_SHARES[network]?.kind ?? null;
}

/** The networks whose window opens with the text and the link filled in, in `POST_NETWORKS` order. */
export const TAP_POST_NETWORKS: readonly PostNetwork[] = Object.freeze(POST_NETWORKS.filter((n) => NETWORK_SHARES[n]?.kind === "tap"));

/** Whether any network passes the founder's test today: pressing Post is the only thing done by hand. */
export function postsByTap(): boolean {
  return TAP_POST_NETWORKS.length > 0;
}

/** One network's way to share a draft. */
export interface ShareTarget {
  network: PostNetwork;
  /** For this draft: a link-only network is `copy` when the draft has no link to open it with. */
  kind: ShareTargetKind;
  label: string;
  /** `tap` and `link_only`: the network's share window, https to its own host, every value encoded. */
  href?: string;
  /** The text as this network gets it (fitted). */
  text: string;
  /** What "Copy text" copies for this network: the fitted text and the link after it. */
  copyText: string;
  link?: string;
  image?: PostDraftImage;
  /** Characters used of the network's limit, the link included, counted as the network counts. */
  used: number;
  max: number;
  /** True when the text was shortened to fit this network. */
  shortened: boolean;
  /** The network's own line, where the group's is not exactly true of it. */
  note?: string;
}

/**
 * Every network's way to share `draft`, in `POST_NETWORKS` order: the draft is fitted to each network first, and an
 * address is built only from that fitted variant. A network with no known share target is left out.
 */
export function shareTargets(draft: PostDraft): ShareTarget[] {
  const networks = POST_NETWORKS.filter((n) => NETWORK_SHARES[n]);
  const fitted = fitPostDraft(draft, networks);
  const asWritten = (draft.variants ?? {}) as PostDraft["variants"];
  return networks.map((network) => {
    const share = NETWORK_SHARES[network]!;
    const post = postDraftFor(fitted, network);
    const href = share.kind === "copy" ? null : (share.address?.(post) ?? null);
    const written = (asWritten[network]?.text ?? draft.text).trim();
    return {
      network,
      kind: href ? share.kind : "copy",
      label: share.label,
      ...(href ? { href } : {}),
      text: post.text,
      copyText: postTextWithLink(post),
      ...(post.link ? { link: post.link } : {}),
      ...(post.image ? { image: post.image } : {}),
      used: postTextLength(post.text, network) + postLinkLength(post.link, network),
      max: postNetworkLimit(network).max,
      shortened: post.text !== written,
      ...(href && share.note ? { note: share.note } : {}),
    };
  });
}

/** The host every address of `network` goes to, or null for a network with no share window. */
export function shareHostOf(network: PostNetwork): string | null {
  return NETWORK_SHARES[network]?.host ?? null;
}

/** The network's name as a founder reads it ("X", "LinkedIn"); the key itself for a network with no share target. */
export function shareLabelOf(network: PostNetwork): string {
  return NETWORK_SHARES[network]?.label ?? network;
}

/** The query parameters an address of `network` may carry. */
export function shareParamsOf(network: PostNetwork): readonly string[] {
  return NETWORK_SHARES[network]?.params ?? [];
}

/*
 * Sending to someone (not posting): a message to a friend with the words and the link. Separate from the networks and
 * never part of whether a channel is available.
 */

export const MESSAGE_APPS = ["whatsapp", "telegram"] as const;
export type MessageApp = (typeof MESSAGE_APPS)[number];

/** The heading of the group, and the label of the plain copy. */
export const SHARE_MESSAGE_WORDS = { title: "Send to someone", copyLink: "Copy link", copied: "Link copied" } as const;

export interface MessageTarget {
  app: MessageApp;
  label: string;
  href: string;
}

/** A message stays readable: the words are cut to this before the link (Telegram's own limit is 4,096). */
const MESSAGE_TEXT_MAX = 1000;

const clipMessage = (text: string): string => {
  const clean = text.trim();
  if (clean.length <= MESSAGE_TEXT_MAX) return clean;
  const cut = Array.from(clean).slice(0, MESSAGE_TEXT_MAX - 1).join("");
  const space = cut.search(/\s+\S*$/u);
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/u, "")}…`;
};

/**
 * The messaging addresses for a draft (sources read Nov 12, 2026):
 * - WhatsApp: `https://wa.me/?text=…` (WhatsApp Help Center, "How to use click to chat": "To create a link with just a
 *   pre-filled message, use https://wa.me/?text=urlencodedtext"; the person then picks who to send it to).
 * - Telegram: `https://t.me/share/url?url=…&text=…` (Telegram, "Sharing Button": `url` the link, `text` an optional
 *   description). It needs a link, so a draft without one has no Telegram target.
 */
export function messageTargets(draft: Pick<PostDraft, "text" | "link">): MessageTarget[] {
  const text = clipMessage(draft.text);
  const targets: MessageTarget[] = [{ app: "whatsapp", label: "WhatsApp", href: shareAddress("https://wa.me/", [["text", postTextWithLink({ text, link: draft.link })]]) }];
  if (draft.link) targets.push({ app: "telegram", label: "Telegram", href: shareAddress("https://t.me/share/url", [["url", draft.link], ["text", text]]) });
  return targets;
}

/** The host of each messaging address. */
export const MESSAGE_APP_HOSTS: Readonly<Record<MessageApp, string>> = { whatsapp: "wa.me", telegram: "t.me" };

/*
 * Recording a share (`share.opened`, packages/events): which control was pressed, never the words. A press opens a
 * window or copies something; whether anything was posted is not known here, so nothing calls it posted.
 */

/** What was shared: a milestone's card, the project's page, or a drafted post. */
export const SHARE_SUBJECT_KINDS = ["milestone", "page", "draft"] as const;
export type ShareSubjectKind = (typeof SHARE_SUBJECT_KINDS)[number];

/** How: a network's window (`tap`, `link_only`), something copied, a message to someone, or the device's own share sheet. */
export const SHARE_OPEN_TARGETS = ["tap", "link_only", "copy", "message", "device"] as const;
export type ShareOpenTarget = (typeof SHARE_OPEN_TARGETS)[number];

/** Where: a network or a messaging app; null for the device's own sheet and for a plain copy of the link or the text. */
export const SHARE_DESTINATIONS = [...POST_NETWORKS, ...MESSAGE_APPS] as const;
export type ShareDestination = (typeof SHARE_DESTINATIONS)[number];

/** One pressed share control, as the web reports it and the event carries it. */
export interface ShareOpened {
  network: ShareDestination | null;
  target: ShareOpenTarget;
}

/** The words of the share panel that are not about one network. */
export const SHARE_PANEL_WORDS = {
  text: "Text",
  textHint: "Change it here if you want. Each network gets it fitted to its own length.",
  link: "Link",
  device: "Share…",
  copyText: "Copy text",
  textCopied: "Text copied",
  downloadImage: "Download image",
  shortened: "shortened to fit",
  close: "Close",
  /** Said once at the foot: what a press does and does not do. */
  honest: (appName: string) => `${appName} posts nothing for you. Each button opens that network's own window, and you press Post there.`,
} as const;

/** "212 of 280": how much of a network's limit a post uses. */
export function shareCountWords(used: number, max: number): string {
  return `${used.toLocaleString("en-US")} of ${max.toLocaleString("en-US")}`;
}
