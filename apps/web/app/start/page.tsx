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
import { startDestination } from "@/lib/auth/start-destination";
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
  let profile: Awaited<ReturnType<typeof server.api.founder.profile.get.query>>;
  try {
    profile = await server.api.founder.profile.get.query();
  } catch (err) {
    return <ApiErrorPage error={err} email={server.auth.email} />;
  }
  // The landing page's card first (docs/IDEA_BOX.md): this browser's (the `fm_idea` cookie) or the one the sign-in link
  // carried (`?claim=`, another device). The person lands on it; the profile questions come after.
  const claimedIdeaId = await claimIdeaBoxCard(server.api, (await cookies()).get(IDEA_COOKIE)?.value ?? null, (await searchParams)[IDEA_CLAIM_PARAM]);
  // The one routing table for a person just signed in (lib/auth/start-destination.ts).
  redirect(startDestination({ profileComplete: profile.complete, businesses: profile.businesses, lastBusinessId: await getLastBusinessId(), claimedIdeaId }));
}

/** Claims the idea box's card, or null (nothing to claim, or the api said no: the person goes on as usual). */
async function claimIdeaBoxCard(api: NonNullable<Awaited<ReturnType<typeof serverApi>>>["api"], token: string | null, claim: string | string[] | undefined): Promise<string | null> {
  const claimToken = typeof claim === "string" ? claim : null;
  if (!token && !claimToken) return null;
  try {
    const res = await api.ideaBox.claim.mutate({ token, claim: claimToken });
    return res?.ideaId ?? null;
  } catch {
    return null;
  }
}
