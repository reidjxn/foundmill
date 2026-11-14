/**
 * Showcase videos of real projects (docs/THESIS_REVIEW.md §13 item 15; approved by the network session, Nov 13, 2026).
 * Foundmill's own business (the house, `HOUSE_BUSINESS_ID` in packages/config) may ask a project with a real, public
 * milestone whether it may post a short video about it. The video is made only from what the project's story already
 * shows in public (its name, logo, brand colors, milestone labels and dates, the cards' tall images): no names, faces
 * or voices, and no number of people. Every founder of the project approves the final video; any one founder's No,
 * Withdraw or departure overrides the others' yes.
 *
 * Pure, no Zod and no crypto: the api, the db, the agents and the browser read the same rules and words from here
 * (`@foundmill/shared/showcase`). The api hashes `showcasePreviewCanonical` with SHA-256.
 */
import type { PostNetwork } from "./post-draft";
import { storyUrl } from "./project-story";
import { withVia } from "./via";

/** Where a request stands. It holds the overall state only, never who said what. */
export const SHOWCASE_REQUEST_STATES = ["asking", "approved", "declined", "withdrawn", "expired"] as const;
export type ShowcaseRequestState = (typeof SHOWCASE_REQUEST_STATES)[number];
/** The states that end a request. */
export const SHOWCASE_FINAL_STATES: readonly ShowcaseRequestState[] = ["declined", "withdrawn", "expired"];
export const isShowcaseOpen = (state: ShowcaseRequestState): boolean => state === "asking" || state === "approved";

/** One founder's answer. Null while they have not answered. */
export const SHOWCASE_ANSWERS = ["yes", "no"] as const;
export type ShowcaseAnswer = (typeof SHOWCASE_ANSWERS)[number];

/**
 * Why a request ended without a post (the house's `showcase.withdrawn {reason}`). Any one of these withdraws the video:
 * one founder's No (`declined`) or Withdraw, a founder leaving or joining, the ask expiring or the approval lapsing, the
 * page going private, a milestone being hidden, the setting being switched off, or the house taking it back.
 */
export const SHOWCASE_WITHDRAW_REASONS = ["declined", "founder_withdrew", "founders_changed", "expired", "approval_lapsed", "page_private", "milestone_hidden", "setting_off", "house_withdrew"] as const;
export type ShowcaseWithdrawReason = (typeof SHOWCASE_WITHDRAW_REASONS)[number];

/** The milestones a project can be featured for: the two recorded from one real outside event and shown in public. */
export const SHOWCASE_MILESTONE_KEYS = ["page_live", "first_follower"] as const;
export type ShowcaseMilestoneKey = (typeof SHOWCASE_MILESTONE_KEYS)[number];
export const isShowcaseMilestoneKey = (v: unknown): v is ShowcaseMilestoneKey => typeof v === "string" && (SHOWCASE_MILESTONE_KEYS as readonly string[]).includes(v);

/** The networks the house posts a showcase video on, by tap from the house business. Shown to the founders in the preview. */
export const SHOWCASE_NETWORKS: readonly PostNetwork[] = Object.freeze(["instagram", "tiktok", "x", "linkedin"] as PostNetwork[]);

const DAY_MS = 86_400_000;
/** An unanswered ask expires after 14 days. */
export const SHOWCASE_ASK_TTL_MS = 14 * DAY_MS;
/** An approval not used within 30 days lapses. */
export const SHOWCASE_APPROVAL_TTL_MS = 30 * DAY_MS;
/** No new ask within 30 days of the last one, whatever became of it. */
export const SHOWCASE_RECENT_MS = 30 * DAY_MS;
/** No new ask within 90 days of a "no". */
export const SHOWCASE_DECLINE_MS = 90 * DAY_MS;
/** The most shots one video has: one per card. */
export const SHOWCASE_MAX_SHOTS = 3;
/** The longest post text the script may write. */
export const SHOWCASE_POST_MAX = 240;

/** The link every showcase post carries: the project's story, with the project's own `via`, so the project gets the sign-up credit. */
export function showcaseLink(origin: string, slug: string): string {
  return withVia(storyUrl(origin, slug), { kind: "project_page", ref: slug });
}

// ---------------------------------------------------------------------------------------------------------------------
// The preview: exactly what would be posted
// ---------------------------------------------------------------------------------------------------------------------

/** One shot: one shown milestone's card, and the words the script put on it. */
export interface ShowcaseShot {
  /** The milestone's id (its card is `/m/<id>`). */
  milestoneId: string;
  key: ShowcaseMilestoneKey;
  /** The milestone's public words ("Page live"). */
  label: string;
  /** The date it happened, as the story prints it ("Nov 12, 2026"). */
  on: string;
  /** The card's tall image (1080 x 1920), the picture the clip starts from. */
  imageUrl: string;
  /** The shot's words, written by the script and checked ("Nov 12: page live"). */
  caption: string;
}

/** One generated clip, once the media is final. */
export interface ShowcaseClip {
  milestoneId: string;
  /** Runway's task id, through the gateway. */
  taskId: string;
  /** Where the clip plays from. Null once the media was deleted. */
  url: string | null;
}

/** What the founders see and approve, and what the house would post. Snapshot in `showcase_requests.preview`. */
export interface ShowcasePreview {
  slug: string;
  projectName: string;
  brandPrimary: string;
  brandSecondary: string;
  shots: ShowcaseShot[];
  /** The post's words. */
  postText: string;
  /** `showcaseLink`. */
  link: string;
  networks: PostNetwork[];
  /** Null while the media is not final: a request without its video never goes out for a yes. */
  video: { clips: ShowcaseClip[] } | null;
}

/** Recursively key-sorted JSON, so the same preview always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The text the preview's hash is taken of: everything a founder approves (the words, the link, the networks, the
 * shots and the clips by their task ids), and not where a clip happens to be served from today.
 */
export function showcasePreviewCanonical(preview: Pick<ShowcasePreview, "slug" | "projectName" | "shots" | "postText" | "link" | "networks" | "video">): string {
  return canonical({
    slug: preview.slug,
    projectName: preview.projectName,
    shots: preview.shots.map((s) => ({ milestoneId: s.milestoneId, key: s.key, label: s.label, on: s.on, caption: s.caption })),
    postText: preview.postText,
    link: preview.link,
    networks: [...preview.networks],
    clips: preview.video?.clips.map((c) => ({ milestoneId: c.milestoneId, taskId: c.taskId })) ?? null,
  });
}

/** The draft a showcase post would go out as: its words from the asset, everything else from the approved preview. */
export function showcaseDraftCanonical(preview: ShowcasePreview, draftBody: string): string {
  return showcasePreviewCanonical({ ...preview, postText: draftBody });
}

// ---------------------------------------------------------------------------------------------------------------------
// Who may be asked
// ---------------------------------------------------------------------------------------------------------------------

export interface ShowcaseEligibilityFacts {
  /** The project's page is public (published, at its address). */
  pagePublic: boolean;
  /** The milestones the project shows in public now, by key, with whether each was recorded from a simulated source. */
  shownMilestones: { key: string; simulated: boolean }[];
  /** A sample business (the seeded demos) or an example. */
  isSample: boolean;
  /** The house business itself. */
  isHouse: boolean;
  /** A request for this project is asking or approved now. */
  openRequest: boolean;
  /** When the last request for this project was made, whatever became of it. */
  lastRequestAt: Date | null;
  /** When a founder last said no. */
  lastDeclinedAt: Date | null;
  /** "Foundmill may ask to feature this project", as the project reads it (`showcaseMayAsk`). */
  mayAsk: boolean;
}

export const SHOWCASE_INELIGIBLE = ["page_private", "no_real_milestone", "sample", "house", "open_request", "recent_request", "recent_no", "setting_off"] as const;
export type ShowcaseIneligible = (typeof SHOWCASE_INELIGIBLE)[number];

/** Whether the house may ask this project now, and if not, the first reason. */
export function showcaseEligibility(f: ShowcaseEligibilityFacts, now: Date): { eligible: true } | { eligible: false; reason: ShowcaseIneligible } {
  const no = (reason: ShowcaseIneligible) => ({ eligible: false as const, reason });
  if (f.isHouse) return no("house");
  if (f.isSample) return no("sample");
  if (!f.mayAsk) return no("setting_off");
  if (!f.pagePublic) return no("page_private");
  if (!f.shownMilestones.some((m) => isShowcaseMilestoneKey(m.key) && !m.simulated)) return no("no_real_milestone");
  if (f.openRequest) return no("open_request");
  if (f.lastRequestAt && now.getTime() - f.lastRequestAt.getTime() < SHOWCASE_RECENT_MS) return no("recent_request");
  if (f.lastDeclinedAt && now.getTime() - f.lastDeclinedAt.getTime() < SHOWCASE_DECLINE_MS) return no("recent_no");
  return { eligible: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// The answers, and what they come to
// ---------------------------------------------------------------------------------------------------------------------

/** One founder's row, as the settlement reads it. */
export interface ShowcaseConsentFacts {
  userId: string;
  answer: ShowcaseAnswer | null;
  withdrawnAt: Date | null;
  expiresAt: Date;
}

export type ShowcaseSettlement = { state: "asking" } | { state: "approved" } | { state: "declined" | "withdrawn" | "expired"; reason: ShowcaseWithdrawReason };

/**
 * What the answers come to, against the founders as they are now. Any ONE founder's No or Withdraw ends it; a founder who
 * left or a new one who was never asked ends it too (the founders changed); an ask nobody finished in time expires. Only
 * a yes from every current founder, on the same video, approves.
 */
export function settleShowcase(consents: readonly ShowcaseConsentFacts[], currentOwnerIds: readonly string[], now: Date): ShowcaseSettlement {
  if (consents.some((c) => c.answer === "no")) return { state: "declined", reason: "declined" };
  if (consents.some((c) => c.withdrawnAt)) return { state: "withdrawn", reason: "founder_withdrew" };
  const asked = new Set(consents.map((c) => c.userId));
  const current = new Set(currentOwnerIds);
  if (current.size === 0 || asked.size !== current.size || [...current].some((id) => !asked.has(id))) return { state: "withdrawn", reason: "founders_changed" };
  if (consents.every((c) => c.answer === "yes")) return { state: "approved" };
  if (consents.some((c) => c.answer === null && c.expiresAt.getTime() <= now.getTime())) return { state: "expired", reason: "expired" };
  return { state: "asking" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The share gate
// ---------------------------------------------------------------------------------------------------------------------

export interface ShowcaseShareFacts {
  state: ShowcaseRequestState;
  approvedUntil: Date | null;
  /** The approved preview's hash, and the hash of the draft as it stands now. */
  previewHash: string;
  draftHash: string;
  /** Who said yes, and who has an owner's standing in the project now. */
  yesUserIds: readonly string[];
  currentOwnerIds: readonly string[];
  /** The project's page is public at the preview's address. */
  pagePublic: boolean;
  /** Every milestone the video shows is still shown in public. */
  milestonesShown: boolean;
  /** The approved preview carries its final, real video. */
  videoFinal: boolean;
}

export const SHOWCASE_SHARE_REFUSALS = ["not_approved", "approval_lapsed", "draft_changed", "founders_changed", "page_private", "milestone_hidden", "no_video"] as const;
export type ShowcaseShareRefusal = (typeof SHOWCASE_SHARE_REFUSALS)[number];

/** Whether the house may share the showcase post now, and if not, why. Every share and every connector asks this first. */
export function showcaseShareRefusal(f: ShowcaseShareFacts, now: Date): ShowcaseShareRefusal | null {
  if (f.state !== "approved") return "not_approved";
  if (!f.approvedUntil || f.approvedUntil.getTime() <= now.getTime()) return "approval_lapsed";
  if (!f.videoFinal) return "no_video";
  if (f.draftHash !== f.previewHash) return "draft_changed";
  const yes = new Set(f.yesUserIds);
  const current = new Set(f.currentOwnerIds);
  if (current.size === 0 || yes.size !== current.size || [...current].some((id) => !yes.has(id))) return "founders_changed";
  if (!f.pagePublic) return "page_private";
  if (!f.milestonesShown) return "milestone_hidden";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------

/** The words a founder reads about an ask. `appName` is APP_NAME. */
export function showcaseWords(appName: string) {
  return {
    /** The note's subject in Needs you. */
    subject: (projectName: string) => `${appName} would like to feature ${projectName.replace(/\s+/g, " ").trim()} in a short video`,
    /** The note's body. */
    body: `${appName} made a short video from your project's public story and would like to post it. Open this note to watch it and answer. Nothing is posted unless every founder says yes.`,
    heading: "Can we post this video?",
    intro: `${appName} made this short video from your project's public story. It shows only what your story already shows: the name, the logo, the brand colors and the milestones with their dates.`,
    videoLabel: "The video",
    postLabel: "The post",
    linkLabel: "The link",
    networksLabel: "Where it would be posted",
    /** The sentence the founders must read before they answer. */
    recall: `You can withdraw any time before it's posted. Once ${appName} posts it, it can't be pulled back from those networks.`,
    everyone: "Every founder is asked. It is posted only if every founder says yes.",
    yes: "Yes, post it",
    no: "No, thanks",
    withdraw: "Withdraw my yes",
    answeredYes: "You said yes. You can withdraw any time before it's posted.",
    answeredNo: "You said no. Nothing will be posted.",
    /** Where the request stands, in the founder's words. */
    states: {
      asking: "Waiting for answers",
      approved: "Every founder said yes",
      declined: "Not posted: a founder said no",
      withdrawn: "Not posted: withdrawn",
      expired: "Not posted: the ask ran out",
    } satisfies Record<ShowcaseRequestState, string>,
    expires: (on: string) => `This ask stays open until ${on}.`,
    /** The project setting. */
    setting: `${appName} may ask to feature this project`,
    settingHint: `${appName} may ask you, and every founder, before posting a short video about your project's public milestones. Nothing is posted unless every founder says yes.`,
    /** For the house owner, when a withdrawn video's share had been opened. */
    removeByHand: (projectName: string) => `Take the video about ${projectName.replace(/\s+/g, " ").trim()} down by hand`,
    removeByHandBody: (networks: string) => `Its founders withdrew it, but a share of it was opened on ${networks}. Remove the post there by hand: it cannot be pulled back from here.`,
    /** Refusals. */
    onlyFounders: "Only the project's founders answer this.",
    closed: "This ask is closed.",
  } as const;
}

/** The plain words for a refused share of a showcase post. */
export const SHOWCASE_SHARE_REFUSAL_WORDS: Readonly<Record<ShowcaseShareRefusal, string>> = {
  not_approved: "This video is not approved by every founder, so it cannot be shared.",
  approval_lapsed: "The approval for this video ran out. Ask the founders again.",
  draft_changed: "The post changed after the founders said yes. Ask them again with the new version.",
  founders_changed: "The project's founders changed after they said yes. Ask them again.",
  page_private: "The project's page is no longer public, so the video cannot be shared.",
  milestone_hidden: "A milestone in the video is no longer shown on the project's page.",
  no_video: "The video is not ready, so nothing can be shared.",
};
