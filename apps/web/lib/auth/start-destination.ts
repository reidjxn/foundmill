/**
 * Where a signed-in person goes from `/` (app/start/page.tsx): the one routing table for a person who has just signed
 * in, so the sessions that add a step (the landing page's claimed concept card, an invitation) add one branch here
 * instead of each editing the page (alignment, Nov 12, 2026). Pure, so it is unit-tested without Next.js.
 *
 * Before this runs, a person not on the list has already been answered by the api (the not-invited page): the table
 * only sees people who may be here.
 *
 * In order:
 *  1. No profile yet: /onboarding (AC-11.1.1).
 *  2. A project: its Today, the last one opened, else the newest of their own (never the example they walked around).
 *  3. Otherwise the person's home, /home (docs/THESIS_REVIEW.md 2.4).
 */
import { routes } from "@foundmill/widgets/shared/routes";
import { pickCurrentBusiness } from "./current-business";

export interface StartInput {
  /** `founder.profile.get` complete: the founder profile exists. */
  profileComplete: boolean;
  /** `founder.profile.get` businesses, newest first; an example membership carries `isExample`. */
  businesses: readonly { id: string; isExample?: boolean }[];
  /** The last business the person opened (the fm_last_business cookie). */
  lastBusinessId: string | null | undefined;
}

export function startDestination(input: StartInput): string {
  if (!input.profileComplete) return "/onboarding";
  const current = pickCurrentBusiness(input.lastBusinessId, input.businesses);
  if (current) return routes.today(current.id);
  return "/home";
}
