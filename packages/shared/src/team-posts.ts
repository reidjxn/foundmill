/**
 * Posts the team writes for the founder to share by tap (docs/NETWORK.md F3 "Tap-to-post", F7 "Posting"; docs/DESIGN.md
 * §9e; founder, Nov 12, 2026: "a post the social channel agent wrote"). Drafting is separate from running a channel:
 * nothing here launches, schedules, publishes or measures anything. The social agent writes the words, the code
 * attaches the link and the picture, and the founder presses Post in the network's own window.
 *
 * A team post is an ordinary `assets` row (kind `post`, no campaign) that the Creative tab already lists:
 * - `content_ref` names what it is about, as `post-draft:<trigger>:<subject>:<id>` (`teamPostRef`). It is the key that
 *   makes a trigger write at most one draft, ever.
 * - `body` is the post's words, exactly as the share panel opens with them.
 * - `approval_state` is where it stands: `draft` (written by the team, not shared yet), `approved` (the founder opened
 *   a share for it: their own press is the only approval a post needs) and `rejected` (the founder said "Not this
 *   one"). Nothing ever says it was posted: the product cannot see the press in the network's window.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/team-posts".
 */
import { fitPostText, postTextBudget, type PostDraft } from "./post-draft";
import { milestonePostDraft, pagePostDraft } from "./share-drafts";
import { TAP_POST_NETWORKS } from "./share-targets";

/**
 * What makes the team write a post (append-only):
 * - `page_published`: the project's page went live for the first time.
 * - `milestone_shown`: a founder chose to show a reached milestone on the page.
 * - `first_follower`: the first person confirmed that they follow the project.
 */
export const TEAM_POST_TRIGGERS = ["page_published", "milestone_shown", "first_follower"] as const;
export type TeamPostTrigger = (typeof TEAM_POST_TRIGGERS)[number];

/**
 * What a post is about (append-only). Each is a real outside result recorded from one event, the same two a project
 * can show in public today (docs/DECISIONS.md 2026-11-12 "Milestones in public"): never a customer, a count or revenue.
 * A subject's key is its milestone's key.
 */
export const TEAM_POST_SUBJECTS = ["page_live", "first_follower"] as const;
export type TeamPostSubject = (typeof TEAM_POST_SUBJECTS)[number];

export const isTeamPostTrigger = (v: unknown): v is TeamPostTrigger => typeof v === "string" && (TEAM_POST_TRIGGERS as readonly string[]).includes(v);
export const isTeamPostSubject = (v: unknown): v is TeamPostSubject => typeof v === "string" && (TEAM_POST_SUBJECTS as readonly string[]).includes(v);

/** The subject's public words, the same a milestone's card shows. Never a stored label. */
export const TEAM_POST_SUBJECT_LABELS: Readonly<Record<TeamPostSubject, string>> = { page_live: "Page live", first_follower: "First follower" };

/**
 * The most drafts one project gets, counted over the last 24 hours and the last 7 days. An attempt that was dropped
 * counts too, so nothing can spend a founder's credits by trying again. The one place these numbers live.
 */
export const TEAM_POST_CAPS = { perDay: 2, perWeek: 5 } as const;
export const TEAM_POST_DAY_MS = 24 * 60 * 60 * 1000;
export const TEAM_POST_WEEK_MS = 7 * TEAM_POST_DAY_MS;

/** A post is at least a few words. */
export const TEAM_POST_TEXT_MIN = 12;
/** The longest post asked for, whatever the networks would take: a post here is one or two short sentences. */
export const TEAM_POST_TEXT_MAX = 240;

export interface TeamPostRef {
  trigger: TeamPostTrigger;
  subject: TeamPostSubject;
  /** The row the trigger names: the page for `page_published`, the milestone for the other two. */
  refId: string;
}

export const TEAM_POST_REF_PREFIX = "post-draft:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `post-draft:<trigger>:<subject>:<id>`: what an asset's `content_ref` holds for a team post. */
export function teamPostRef(ref: TeamPostRef): string {
  return `${TEAM_POST_REF_PREFIX}${ref.trigger}:${ref.subject}:${ref.refId.toLowerCase()}`;
}

/** The reference a `content_ref` holds, or null when the asset is not a team post. Never throws. */
export function parseTeamPostRef(contentRef: unknown): TeamPostRef | null {
  if (typeof contentRef !== "string" || !contentRef.startsWith(TEAM_POST_REF_PREFIX)) return null;
  const [trigger, subject, refId, ...rest] = contentRef.slice(TEAM_POST_REF_PREFIX.length).split(":");
  if (rest.length > 0 || !isTeamPostTrigger(trigger) || !isTeamPostSubject(subject) || !refId || !UUID.test(refId)) return null;
  return { trigger, subject, refId };
}

/** Whether an asset is a post the team wrote for the founder to share. */
export function isTeamPost(asset: { kind?: string | null; contentRef?: string | null }): boolean {
  return (asset.kind === undefined || asset.kind === "post") && parseTeamPostRef(asset.contentRef) !== null;
}

/** The title of the asset on the Creative tab: written by code from the subject, never by the model. */
export function teamPostTitle(ref: Pick<TeamPostRef, "trigger" | "subject">): string {
  if (ref.trigger === "milestone_shown") return `A post about your milestone: ${TEAM_POST_SUBJECT_LABELS[ref.subject]}`;
  return ref.subject === "page_live" ? "A post about your page going live" : "A post about your first follower";
}

/** What the post points to. */
export interface TeamPostPage {
  /** The web app's own origin (APP_URL). */
  origin: string;
  slug: string;
  projectName: string;
  /** The page's one-line pitch as published. */
  pitch: string;
}

export interface TeamPostShareInput {
  /** The post's words. */
  text: string;
  ref: TeamPostRef;
  /** The project's page while it is published; null when it is not (the post then carries no link). */
  page: TeamPostPage | null;
  /** True while the milestone a `milestone_shown` post names is on the page, so its card answers. */
  cardShown?: boolean;
}

/**
 * The post as the share panel opens it: the team's words, and the link and picture the code attaches. A post about a
 * shown milestone points to the milestone's card while the card is up; every other post points to the project's page.
 * Both carry the page's `via` reference. Nothing is fitted here: `shareTargets` fits the draft to each network every
 * time the words change, so a change the founder makes in the panel reaches every network.
 */
export function teamPostShareDraft(input: TeamPostShareInput): PostDraft {
  const text = input.text.trim();
  if (!input.page) return { text, variants: {} };
  if (input.ref.trigger === "milestone_shown" && input.cardShown) {
    const card = milestonePostDraft({ origin: input.page.origin, slug: input.page.slug, projectName: input.page.projectName, milestoneId: input.ref.refId, label: TEAM_POST_SUBJECT_LABELS[input.ref.subject] });
    // The card's tall picture stays for the networks that take one; their words are the team's.
    const variants = Object.fromEntries(Object.entries(card.variants).map(([network, v]) => [network, { ...v, text }]));
    return { ...card, text, variants };
  }
  const page = pagePostDraft(input.page);
  return { text, link: page.link, image: page.image, variants: {} };
}

/**
 * The most characters a post may have so that no network that opens ready to post has to shorten it beside `link`,
 * and never more than `TEAM_POST_TEXT_MAX`. The founder is never left with a cut sentence.
 */
export function teamPostTextBudget(link: string | undefined): number {
  const budgets = TAP_POST_NETWORKS.map((n) => postTextBudget(link, n));
  return Math.max(0, Math.min(TEAM_POST_TEXT_MAX, ...budgets));
}

/** Whether `text` goes out whole, beside `link`, on every network that opens ready to post. */
export function teamPostFits(text: string, link: string | undefined): boolean {
  const clean = text.trim();
  if (clean.length < TEAM_POST_TEXT_MIN || clean.length > teamPostTextBudget(link)) return false;
  return TAP_POST_NETWORKS.every((n) => fitPostText(clean, link, n) === clean);
}

/** The words a founder reads about a team post. */
export const TEAM_POST_WORDS = {
  /** Today's one quiet line while a post waits. */
  today: (waiting: number): string => (waiting === 1 ? "A post is ready to share" : `${waiting} posts are ready to share`),
  open: "Open",
  /** Under the asset's title on the Creative tab, where a campaign's name would be. */
  source: "Written by your team for you to share",
  /** The dismissal: the draft is set aside and not offered again. */
  dismiss: "Not this one",
  /** Where a team post stands, in place of the approval words of a campaign's creative. */
  states: { draft: "Not shared yet", pending: "Not shared yet", approved: "Share opened", rejected: "Set aside" },
} as const;
