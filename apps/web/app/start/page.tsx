/**
 * The signed-in index: proxy.ts serves it for `/` when the last-business cookie does not answer that itself (no cookie,
 * or the cookie's business is gone). The last business's Home when the founder still has it, else their newest business
 * of their own (never the example business they are walking around, which counts only as the last one opened), else
 * the person's home at /home (profile complete; docs/THESIS_REVIEW.md 2.4) or /onboarding (BUILD §6.2, AC-11.1.1).
 * The address stays `/` for a business.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDEA_CLAIM_PARAM, IDEA_COOKIE } from "@foundmill/shared";
import { KEEP_THEN_PARAM, KEEP_THEN_STUDIO } from "@/lib/auth/constants";
import { keepCardPathFor, startDestination } from "@/lib/auth/start-destination";
import { getLastBusinessId } from "@/lib/auth/server";
import { serverApi } from "@/lib/trpc-server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { LandingPage } from "@/components/landing/LandingPage";
import { calendarDay } from "@/components/landing/examples/helpers";

export const dynamic = "force-dynamic";

export default async function StartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const server = await serverApi();
  // The proxy let a signed-in founder through but the session did not hold up here (it ended in between, or Supabase
  // Auth did not answer in time): the landing page, as `/` shows anyone signed out. Never a redirect that could loop.
  if (!server) return <LandingPage renderDay={calendarDay(new Date(), "utc")} />;
  const params = await searchParams;
  // "Shape it in the Ideation Studio" on the idea box: keeping the card opens the Studio on it (`?then=studio`).
  const studio = params[KEEP_THEN_PARAM] === KEEP_THEN_STUDIO;
  let profile: Awaited<ReturnType<typeof server.api.founder.profile.get.query>>;
  try {
    profile = await server.api.founder.profile.get.query();
  } catch (err) {
    // Not let in yet: the waitlist keeps the card, and the Studio choice with it (0126), for the first sign-in after.
    return <ApiErrorPage error={err} email={server.auth.email} keepThen={studio ? KEEP_THEN_STUDIO : null} />;
  }
  // The landing page's card first (docs/IDEA_BOX.md): this browser's (the `fm_idea` cookie), the one the sign-in link
  // carried (`?claim=`, another device), or the one the person's waitlist entry holds. Nothing is kept here: the person
  // sees the card and presses "Keep this card" (/new/card/keep), so nobody's card lands in a deck unseen.
  const claim = params[IDEA_CLAIM_PARAM];
  const keepCardPath = await cardToKeep(server.api, (await cookies()).get(IDEA_COOKIE)?.value ?? null, typeof claim === "string" ? claim : null, studio);
  // The one routing table for a person just signed in (lib/auth/start-destination.ts).
  // A profile counts once the person's "I am 18 or older" is on record too (0100): /onboarding asks for what is missing.
  redirect(startDestination({ profileComplete: profile.complete && profile.adultConfirmed, businesses: profile.businesses, lastBusinessId: await getLastBusinessId(), keepCardPath }));
}

/** The waiting card's keep step (`keepCardPathFor`, lib/auth/start-destination.ts), or null when there is none. */
async function cardToKeep(api: NonNullable<Awaited<ReturnType<typeof serverApi>>>["api"], token: string | null, claim: string | null, studio: boolean): Promise<string | null> {
  try {
    return keepCardPathFor(await api.ideaBox.preview.query({ token, claim }), { claim, studio });
  } catch {
    return null;
  }
}
