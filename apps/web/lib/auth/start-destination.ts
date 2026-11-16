/**
 * Where a signed-in person goes from `/` (app/start/page.tsx): the one routing table for a person who has just signed
 * in, so the sessions that add a step (the landing page's claimed concept card, an invitation) add one branch here
 * instead of each editing the page (alignment, Nov 12, 2026). Pure, so it is unit-tested without Next.js.
 *
 * Before this runs, a person not on the list has already been answered by the api (the not-invited page): the table
 * only sees people who may be here.
 *
 * In order:
 *  0. A card waiting from the landing page's idea box: `/new/card/keep`, where the person sees it and keeps it (founder,
 *     2026-11-13: the person lands on their saved card; the profile questions come at the next step).
 *  1. No profile yet: /onboarding (AC-11.1.1).
 *  2. A project: its Today, the last one opened, else the newest of their own (never the example they walked around).
 *  3. Otherwise the person's home, /home (docs/THESIS_REVIEW.md 2.4).
 */
import { routes } from "@foundmill/widgets/shared/routes";
import { IDEA_CLAIM_PARAM } from "@foundmill/shared";
import { KEEP_THEN_PARAM, KEEP_THEN_STUDIO } from "./constants";
import { pickCurrentBusiness } from "./current-business";

export interface StartInput {
  /** `founder.profile.get` complete and adultConfirmed: the founder profile exists and "I am 18 or older" is on record. */
  profileComplete: boolean;
  /** `founder.profile.get` businesses, newest first; an example membership carries `isExample`. */
  businesses: readonly { id: string; isExample?: boolean }[];
  /** The last business the person opened (the fm_last_business cookie). */
  lastBusinessId: string | null | undefined;
  /** Where the idea box's waiting card is kept (`/new/card/keep…`, app/start/page.tsx), or null. */
  keepCardPath?: string | null;
}

export function startDestination(input: StartInput): string {
  if (input.keepCardPath) return input.keepCardPath;
  if (!input.profileComplete) return "/onboarding";
  const current = pickCurrentBusiness(input.lastBusinessId, input.businesses);
  if (current) return routes.today(current.id);
  return "/home";
}

/**
 * Where to keep a waiting card (`/new/card/keep`), or null when there is none: with the sign-in link's claim token when
 * the card came by the link, and `then=studio` when the person chose "Shape it in the Ideation Studio", from the address
 * (`studio`) or, for the waitlist's card, as the waitlist kept it (`card.then`, 0124): a person let in from the waitlist
 * who chose the Studio is taken there on their first sign-in after, on any browser.
 */
export function keepCardPathFor(card: { source: "browser" | "link" | "waitlist"; then: "studio" | null } | null, input: { claim: string | null; studio: boolean }): string | null {
  if (!card) return null;
  const query = new URLSearchParams();
  if (input.claim && card.source === "link") query.set(IDEA_CLAIM_PARAM, input.claim);
  if (input.studio || card.then === KEEP_THEN_STUDIO) query.set(KEEP_THEN_PARAM, KEEP_THEN_STUDIO);
  const search = query.toString();
  return search ? `/new/card/keep?${search}` : "/new/card/keep";
}
