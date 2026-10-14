/**
 * /onboarding — the founder profile (BUILD §11.1, AC-11.1.1). Renders the form for a new founder and, for a founder
 * who already has one, the same form pre-filled (reachable from Settings and the studio trail).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/onboarding/OnboardingScreen";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "Founder profile" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fonboarding");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  return <OnboardingScreen profile={viewer.profile} email={viewer.email} accountId={viewer.userId} />;
}
