/**
 * A Customer Update shared as a card (docs/holistic-plan/WP-14-behavior-brief.md T9; docs/DESIGN.md §9f; migration
 * 0166): the addresses and the words, shared by the api, the web and the design system so each is written once.
 *
 * A founder shares one Customer Update at a time, by their own press; nothing is public until then. The card carries
 * the project's name and logo, the day, the lead channel and the standout agent. It never carries the customer's
 * name, the amount or a count: the only words about the customer are the ones a founder types into the note. Only a
 * Customer Update that came from a real payment can be shared (DESIGN §9f "What can be shown").
 */
import { clipText } from "./project-page";
import { CARD_PATH_PREFIX } from "./project-story";

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The route prefix of every shared Customer Update, under the cards' own prefix: "/m/update/". */
export const UPDATE_CARD_PATH_PREFIX = `${CARD_PATH_PREFIX}update/`;

/** A shared Customer Update's address: "/m/update/<id>". */
export function updateCardPath(id: string): string {
  return `${UPDATE_CARD_PATH_PREFIX}${id}`;
}

/** Its full URL at `origin` (APP_URL). */
export function updateCardUrl(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, "")}${updateCardPath(id)}`;
}

/** The tall share image, for story posts (1080 × 1920): "/m/update/<id>/story-image". */
export function updateCardTallImagePath(id: string): string {
  return `${updateCardPath(id)}/story-image`;
}

/** What the card says happened: a first payment from this customer, or one from a customer who paid before. Never a count. */
export const UPDATE_CARD_HEADLINES = ["new_customer", "returning_customer"] as const;
export type UpdateCardHeadline = (typeof UPDATE_CARD_HEADLINES)[number];

export const UPDATE_CARD_HEADLINE_WORDS: Readonly<Record<UpdateCardHeadline, string>> = {
  new_customer: "New customer",
  returning_customer: "A customer came back",
};

/** The founder's own line on a card, in characters. */
export const UPDATE_CARD_NOTE_MAX = 140;
/** The standout agent's name as stored on a card, in characters. */
export const UPDATE_CARD_AGENT_MAX = 80;

/**
 * A founder's note as it is stored: one line, trimmed, without invisible or direction-changing characters (it is
 * public text on a Foundmill address), null when empty. Longer than the limit is the caller's to refuse.
 */
export function cleanUpdateCardNote(note: string | null | undefined): string | null {
  const clean = oneLine((note ?? "").replace(/[\p{Cf}\p{Cc}]/gu, " "));
  return clean.length ? clean : null;
}

/** The words a card prints around the project's own. `appName` is APP_NAME. */
export function updateCardWords(appName: string) {
  return {
    /**
     * What "verified" means for a card about a payment: the project's payment provider reported it. It does not say
     * more than the platform knows (a provider's test mode is not told apart yet; see the log entry of WP-14 T9).
     */
    verifiedNote: `${appName} recorded this payment when it arrived. It was not typed in.`,
    /**
     * A payment that came through a pasted Stripe key is real but not verified: the founder holds the signing secret
     * that would also sign a made-up one (founder, Nov 22, 2026). The card says where it comes from and no more.
     */
    recordedNote: "Recorded from the founder's Stripe account.",
    leadChannel: "Lead channel",
    standoutAgent: "Standout agent",
    /** Beside the agent's name, always: an agent is never passed off as a person. */
    aiAgent: "AI agent",
    /** Above the founder's own line: "A note from Northwind Skincare". */
    noteFrom: (name: string) => `A note from ${oneLine(name)}`,
  } as const;
}

/** A card's browser and share title: "New customer: Northwind Skincare". */
export function updateCardTitle(headline: UpdateCardHeadline, name: string, max = 70): string {
  return clipText(`${UPDATE_CARD_HEADLINE_WORDS[headline]}: ${oneLine(name)}`, max);
}

/** A card's description: "Northwind Skincare took a payment on Nov 12, 2026. Verified by Foundmill." (verified only; else "Recorded from the founder's Stripe account."). */
export function updateCardDescription(name: string, on: string, appName: string, verified: boolean, max = 160): string {
  return clipText(`${oneLine(name)} took a payment on ${on}. ${verified ? `Verified by ${appName}.` : updateCardWords(appName).recordedNote}`, max);
}

/** The console's words for sharing a Customer Update (the Customer Update screen's toolbar and its dialog). */
export const UPDATE_CARD_SHARE_WORDS = {
  share: "Share as a card",
  shared: "Shared as a card",
  copy: "Copy card link",
  copied: "Card link copied",
  open: "Open the card",
  stop: "Stop sharing",
  stopped: "The card is no longer public",
  dialogTitle: "Share this Customer Update",
  /** What the card shows and leaves out, said before the press. */
  dialogBody: "This makes a public card with your project's name and logo, the date, the lead channel and the standout agent. It leaves out the customer's name, the amount and everything else about them.",
  dialogConsent: "Nothing is public until you press Make the card, and you can stop sharing at any time.",
  noteLabel: "A line of your own (optional)",
  noteHint: "Anything you write here is public. Leave the customer's name out unless they said you can use it.",
  confirm: "Make the card",
  cancel: "Cancel",
  made: "The card is public. Its link is copied.",
} as const;

/** Why a Customer Update has no share action, said in place of the button where a reason helps. */
export const UPDATE_CARD_NEEDS_PAGE_MESSAGE = "Publish your project's page first. A card links back to that page.";
export const UPDATE_CARD_SAMPLE_MESSAGE = "This is a sample business, so it shares nothing in public. Start your own project to share its Customer Updates.";
export const UPDATE_CARD_ROLE_MESSAGE = "Only an owner or an admin can share a Customer Update or stop sharing it.";
export const UPDATE_CARD_NOT_REAL_MESSAGE = "Only a Customer Update that came from a real payment can be shared as a card.";
export const UPDATE_CARD_NOT_FOUND_MESSAGE = "That Customer Update is not one of this project's.";
export const UPDATE_CARD_NOTE_TOO_LONG_MESSAGE = `Keep your line to ${UPDATE_CARD_NOTE_MAX} characters.`;
