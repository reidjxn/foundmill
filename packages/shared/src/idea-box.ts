/**
 * The landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md): what the browser, the api and the web share. The
 * request a draft takes, the events its stream answers, the fixed sentences a refusal reads, the interests "Surprise me"
 * offers, and the cookie that holds a visitor's card.
 */
import { z } from "zod";

/** The cookie holding the browser's token (httpOnly; the api sets it, the web's /start reads it). */
export const IDEA_COOKIE = "fm_idea";
/** How long the cookie lives: the draft's own life. */
export const IDEA_COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;
/** The longest line the box takes. */
export const IDEA_BOX_PROMPT_MAX = 500;
/** The shortest line worth drafting from. */
export const IDEA_BOX_PROMPT_MIN = 3;
/**
 * The longest a card's model call may take (WP-03 T7): past it the api stops the call and answers the `failed` line.
 * The page's own timer waits 5 seconds longer, for a stream that stalls on the way.
 */
export const IDEA_BOX_DEADLINE_MS = 30_000;
/**
 * How many times a day a browser may replace its card with a new one ("Try another idea"; founder, 2026-11-15, WP-03
 * decision 3). Each redraw also counts as a card for the address and the day's ceiling.
 */
export const IDEA_BOX_REDRAWS_PER_BROWSER = 2;
/** The query parameter the sign-in link carries to /start so another device can claim the card. */
export const IDEA_CLAIM_PARAM = "claim";

/** What "Surprise me" offers (one tap drafts a card from the interest). Ordinary interests, no jobs or careers. */
export const IDEA_BOX_INTERESTS = [
  "Food and cooking",
  "Games",
  "Fitness",
  "Pets",
  "Travel",
  "Music",
  "Fashion",
  "Home and garden",
  "Kids and parents",
  "Teaching",
  "Money and saving",
  "Making things",
] as const;
export type IdeaBoxInterest = (typeof IDEA_BOX_INTERESTS)[number];

/** A token as the cookie and the claim link carry it: 32 random bytes, base64url. */
export const IdeaToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const IdeaBoxDraftRequest = z
  .strictObject({
    prompt: z.string().max(IDEA_BOX_PROMPT_MAX).default(""),
    interest: z.enum(IDEA_BOX_INTERESTS).nullable().default(null),
    /** The Turnstile widget's token. */
    turnstile: z.string().min(1).max(2048),
    /** A field no person fills (hidden from people and from assistive technology): a bot that fills it gets nothing. */
    website: z.string().max(200).default(""),
    /** "Try another idea": replace the browser's card instead of getting it back (`IDEA_BOX_REDRAWS_PER_BROWSER`). */
    again: z.boolean().default(false),
  })
  .refine((r) => r.interest !== null || r.prompt.trim().length >= IDEA_BOX_PROMPT_MIN, { message: "Write your idea in a sentence, or pick an interest" });
export type IdeaBoxDraftRequest = z.input<typeof IdeaBoxDraftRequest>;

/** The card as the box shows it while it fills in: the members that have arrived so far. */
export interface IdeaBoxPartialCard {
  name?: string;
  pitch?: string;
  archetype?: string;
  stars_current?: number;
  stars_potential?: number;
}

export interface IdeaBoxRating {
  key: string;
  value: number;
  evidence: string;
}

export interface IdeaBoxCard extends Required<IdeaBoxPartialCard> {
  id: string;
  attributes: IdeaBoxRating[];
  citations: { title: string; url: string; note: string }[];
  crest_seed: string;
}

export type IdeaBoxErrorCode = "invalid" | "bot" | "limit" | "resting" | "unavailable" | "refused" | "failed";

/** The stream's lines (NDJSON), in order: started, partials and ratings as they arrive, then card or error. */
export type IdeaBoxEvent =
  | { type: "started" }
  | { type: "partial"; card: IdeaBoxPartialCard }
  | { type: "rating"; index: number; rating: IdeaBoxRating }
  /** `claim`: the one-time token the sign-in link carries so another device can claim the card (`/start?claim=`). */
  | { type: "card"; card: IdeaBoxCard; prompt: string; interest: string | null; sample: boolean; again: boolean; claim: string | null }
  | { type: "error"; code: IdeaBoxErrorCode; message: string };

/** What each refusal reads. Plain, short, never the vendor's or the model's own words. */
export const IDEA_BOX_ERRORS: Record<IdeaBoxErrorCode, string> = {
  invalid: "Write your idea in a sentence, up to 500 characters.",
  bot: "We could not check this browser. Reload the page and try again.",
  limit: "That is all the cards from this connection today. Come back tomorrow for another.",
  resting: "The idea box is resting until tomorrow. Come back then and it will shape your idea.",
  unavailable: "The idea box is not open right now. Try again in a minute.",
  refused: "That one cannot become a card. Try another idea.",
  failed: "The card could not be finished. Try again.",
};
