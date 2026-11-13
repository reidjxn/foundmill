/**
 * A project's story and its milestone cards (docs/NETWORK.md F2 "the story", F3 "cards"; docs/THESIS_REVIEW.md package
 * 5.3; migration 0089): the addresses, the words and the titles, shared by the api, the web and the design system so
 * each is written once.
 *
 * A milestone is something the platform recorded when it happened (the page went live, a person confirmed that they
 * follow the project, a first payment arrived). The founders choose, one at a time, which reached milestones to show.
 * Shown milestones make up the story at `/p/<slug>/story`, oldest first, and each has a card at `/m/<id>`.
 *
 * Founder, Nov 12, 2026: a public page lists dated things that happened and never a tally, so nothing here counts.
 * "Verified by Foundmill" is the proof and stays on every plan; "Built on Foundmill" and "Start your own" are the mark
 * and belong to a project on the free plan only (`builtOnWords`, `tierShowsBuiltOnMark`).
 */
import { clipText, pagePath } from "./project-page";

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The story's address: "/p/<slug>/story". */
export function storyPath(slug: string): string {
  return `${pagePath(slug)}/story`;
}

/** The story's full URL at `origin` (APP_URL). */
export function storyUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}${storyPath(slug)}`;
}

/** The route prefix every milestone card lives under. */
export const CARD_PATH_PREFIX = "/m/";

/** A card's address: "/m/<id>". */
export function cardPath(id: string): string {
  return `${CARD_PATH_PREFIX}${id}`;
}

/** A card's full URL at `origin` (APP_URL). */
export function cardUrl(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, "")}${cardPath(id)}`;
}

/** The tall share image of a card, for story posts (1080 × 1920): "/m/<id>/story-image". */
export function cardTallImagePath(id: string): string {
  return `${cardPath(id)}/story-image`;
}

/** The words the story and the cards print around the project's own. `appName` is APP_NAME. */
export function storyWords(appName: string) {
  return {
    /** The story's heading and title: "How Northwind Skincare was built". */
    heading: (name: string) => `How ${oneLine(name)} was built`,
    /** The proof beside every milestone, on every plan. */
    verified: `Verified by ${appName}`,
    /** What "verified" means, once, under the heading. */
    verifiedNote: `${appName} recorded each of these when it happened. None was typed in.`,
    /** The same for one card. */
    verifiedNoteOne: `${appName} recorded this when it happened. It was not typed in.`,
    /** The link back to the project's page: "See Northwind Skincare". */
    seeProject: (name: string) => `See ${oneLine(name)}`,
    /** The link from a card to the whole story. */
    seeStory: (name: string) => `How ${oneLine(name)} was built`,
    /** The accessible name of the timeline. */
    timeline: "Milestones",
  } as const;
}

/** The story's browser and share title, cut to about 70 characters at a word. */
export function storyTitle(name: string, max = 70): string {
  return clipText(`How ${oneLine(name)} was built`, max);
}

/** The story's description for search and share cards. */
export function storyDescription(name: string, appName: string, max = 160): string {
  return clipText(`What ${oneLine(name)} has done so far, each step recorded by ${appName} when it happened.`, max);
}

/** A card's browser and share title: "Page live: Northwind Skincare". */
export function cardTitle(label: string, name: string, max = 70): string {
  return clipText(`${oneLine(label)}: ${oneLine(name)}`, max);
}

/** A card's description: "Northwind Skincare reached this on Nov 12, 2026. Verified by Foundmill." */
export function cardDescription(name: string, on: string, appName: string, max = 160): string {
  return clipText(`${oneLine(name)} reached this on ${on}. Verified by ${appName}.`, max);
}

/** The console's words for showing a reached milestone (Plan › Milestones). */
export const MILESTONE_SHOW_WORDS = {
  show: "Show on your page",
  shown: "On your page",
  hide: "Hide",
  copy: "Copy card link",
  copied: "Card link copied",
  /** Shown before, while the page is not live: it is public again as soon as the page is. */
  waiting: "Shown when your page is live",
  /** Under the milestones, once, while the page is live. */
  note: "A milestone is public only after you press Show on your page, and you can hide it again at any time.",
  /** The same place, while the page is not published. */
  needsPage: "Publish your project's page to show a milestone on it.",
} as const;

/** The refusal when a founder tries to show a milestone before the page is published (`appCode: "milestone_needs_page"`). */
export const MILESTONE_NEEDS_PAGE_MESSAGE = "Publish your project's page first. A milestone is shown on that page.";
/** A sample business shows nothing in public (`appCode: "page_sample_business"`, as its page). */
export const MILESTONE_SAMPLE_MESSAGE = "This is a sample business, so it shows nothing in public. Start your own project to show its milestones.";
/** Showing and hiding are an owner's or an admin's. */
export const MILESTONE_SHOW_ROLE_MESSAGE = "Only an owner or an admin can show a milestone on the page or hide it.";
/**
 * A reached milestone that cannot be shown yet (`appCode: "milestone_not_showable"`): a customer or revenue milestone
 * is counted or estimated, not recorded from one real outside event, so it does not carry "Verified" in public.
 */
export const MILESTONE_NOT_SHOWABLE_MESSAGE = "This milestone cannot be shown on your page yet. For now your page shows only what was recorded from one real event: the page going live and your first follower.";
/** A milestone that is not reached, was archived, or was not recorded by the platform. */
export const MILESTONE_NOT_FOUND_MESSAGE = "That milestone is not one this project has reached.";
