/**
 * /public-profile — Your public profile (docs/THESIS_REVIEW.md package 2.3): where the person writes, previews and
 * publishes their own page at /u/<handle>. Guarded like /businesses: signed-out visitors go to /login, a person without
 * a profile to /onboarding first. It needs no business.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { PublicProfileScreen } from "@/components/profile/PublicProfileScreen";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Your public profile" };
export const dynamic = "force-dynamic";

export default async function PublicProfilePage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fpublic-profile");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  const last = pickCurrentBusiness(await getLastBusinessId(), viewer.businesses);
  return <PublicProfileScreen viewer={{ email: viewer.email }} lastBusiness={last ? { id: last.id, name: last.name } : null} />;
}
