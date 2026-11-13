/**
 * The post drafts a project already has (docs/NETWORK.md F3 "Tap-to-post"), built from facts that are public anyway
 * and nothing else: no model writes them. One for a milestone shown on the page (its card), one for the page itself,
 * and one around a post the social channel's agent drafted.
 *
 * The words are the project's own and plain: its name and what happened or what it is. No "we", no praise, no
 * hashtag, no emoji, and nothing that states a number. Every link carries the `via` reference of the project's page
 * (./via), so a visit that comes back through a shared link is known for what brought it. The picture is the share
 * image that address already serves.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/share-drafts". On a development stack the origin is
 * http://localhost, so these drafts are for the share panel there; the Zod `PostDraft` (https only) is for a draft
 * handed to a connector.
 */
import type { PostDraft, PostDraftImage } from "./post-draft";
import { pageTitle, pageUrl } from "./project-page";
import { cardTallImagePath, cardTitle, cardUrl } from "./project-story";
import { withVia } from "./via";

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const viaPage = (url: string, slug: string): string => withVia(url, { kind: "project_page", ref: slug });
const base = (origin: string): string => origin.replace(/\/+$/, "");
/** A sentence end, unless the words already have one. */
const sentence = (s: string): string => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** The share image a public address serves (Next's `opengraph-image` route beside the page). */
export const SHARE_IMAGE_SUFFIX = "/opengraph-image";

export interface MilestonePostInput {
  /** The web app's own origin (APP_URL). */
  origin: string;
  /** The project page's address under /p/. */
  slug: string;
  projectName: string;
  milestoneId: string;
  /** The milestone's public words, built from its key ("Page live", "First follower"): never a stored label. */
  label: string;
}

/**
 * The draft for a milestone shown on the page: "Northwind Skincare reached a milestone: Page live." with the card's
 * address (`/m/<id>?via=p.<slug>`). The picture is the card's wide share image; the networks that take a tall picture
 * for a story post (Instagram, TikTok) get the tall one.
 */
export function milestonePostDraft(input: MilestonePostInput): PostDraft {
  const name = oneLine(input.projectName);
  const label = oneLine(input.label);
  const card = cardUrl(input.origin, input.milestoneId);
  const alt = cardTitle(label, name, 200);
  const tall: PostDraftImage = { url: `${base(input.origin)}${cardTallImagePath(input.milestoneId)}`, alt };
  const text = sentence(`${name} reached a milestone: ${label}`);
  return {
    text,
    link: viaPage(card, input.slug),
    image: { url: `${card}${SHARE_IMAGE_SUFFIX}`, alt },
    variants: { instagram: { text, image: tall }, tiktok: { text, image: tall } },
  };
}

export interface PagePostInput {
  origin: string;
  slug: string;
  projectName: string;
  /** The page's one-line pitch as published. */
  pitch: string;
}

/** The draft for the project's page: "Northwind Skincare: Refillable skincare for sensitive skin." with the page's address. */
export function pagePostDraft(input: PagePostInput): PostDraft {
  const name = oneLine(input.projectName);
  const pitch = oneLine(input.pitch);
  const page = pageUrl(input.origin, input.slug);
  const text = sentence(!pitch || pitch.toLowerCase() === name.toLowerCase() ? name : `${name}: ${pitch}`);
  return { text, link: viaPage(page, input.slug), image: { url: `${page}${SHARE_IMAGE_SUFFIX}`, alt: pageTitle(name, pitch, 200) }, variants: {} };
}

export interface WrittenPostInput {
  /** The post as it was drafted (the social channel agent's copy). */
  text: string;
  /** The project's page, when it is published: the link the post points to, and its share image. */
  page?: { origin: string; slug: string; projectName: string; pitch: string } | null;
}

/** The draft around a post someone already wrote: its words as they are, and the project page's address when the page is live. */
export function writtenPostDraft(input: WrittenPostInput): PostDraft {
  const text = input.text.trim();
  if (!input.page) return { text, variants: {} };
  const page = pagePostDraft(input.page);
  return { text, link: page.link, image: page.image, variants: {} };
}

/** The words on the controls that open the share panel. */
export const SHARE_OPEN_WORDS = {
  /** On a milestone shown on the page, beside "Copy card link", and on a drafted post. */
  share: "Share",
  /** Product › Public page, once the page is live. */
  sharePage: "Share your page",
  milestoneTitle: (label: string) => `Share “${oneLine(label)}”`,
  pageTitle: "Share your page",
  draftTitle: "Share this post",
  /** Under the title of each panel. */
  description: "Pick where it goes. The text and the link are ready.",
} as const;
