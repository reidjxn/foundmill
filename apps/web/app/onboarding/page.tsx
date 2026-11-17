/**
 * /onboarding — the founder profile (BUILD §11.1, AC-11.1.1). Renders the form for a new founder and, for a founder
 * who already has one, the same form pre-filled (reachable from Settings and the studio trail).
 *
 * For a new founder it also reads the httpOnly `fm_via` cookie (who or what brought them; lib/via.ts) and hands its
 * reference to the form, which sends it with the save that creates the profile. The cookie stays out of reach of the
 * page's scripts; a founder who already has a profile is handed nothing.
 *
 * 18 or older (0100): a new founder ticks "I am 18 or older" on the form, sent with the save that creates the profile;
 * a founder with a profile and no confirmation on record sees one step instead (components/onboarding/AdultStep.tsx),
 * which works from 390 px.
 *
 * WP-04 T1: a new account answers three questions (components/onboarding/FirstProfile.tsx) and goes on to `?next=`
 * when it names a kept card's Commit (`onboardingNext`), so the card keeps its thread; the long form is for editing on
 * a computer. Works from 390 px.
 */
import { VIA_COOKIE } from "@foundmill/shared/via";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/onboarding/OnboardingScreen";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { onboardingNext } from "@/lib/auth/redirects";
import { viaToHandOver } from "@/lib/via";

export const metadata: Metadata = { title: "Founder profile" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function OnboardingPage({ searchParams }: Props) {
  const raw = (await searchParams).next;
  // Where the three questions go on to: only a kept card's Commit or the card itself (WP-04 T1).
  const next = onboardingNext(typeof raw === "string" ? raw : undefined);
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect(`/login?next=${encodeURIComponent(next ? `/onboarding?next=${next}` : "/onboarding")}`);
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  const via = viewer.profile ? null : viaToHandOver((await cookies()).get(VIA_COOKIE)?.value);
  return <OnboardingScreen profile={viewer.profile} email={viewer.email} accountId={viewer.userId} via={via} adultConfirmed={viewer.adultConfirmed} next={next} />;
}
