/**
 * /businesses — Your businesses: every business the founder belongs to (Open, Settings), then the archived ones they
 * own. Guarded like /new: signed-out visitors go to /login, a founder without a profile to /onboarding first.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BusinessesScreen } from "@/components/businesses/BusinessesScreen";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Your businesses" };
export const dynamic = "force-dynamic";

export default async function BusinessesPage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fbusinesses");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  const last = pickCurrentBusiness(await getLastBusinessId(), viewer.businesses);
  return <BusinessesScreen viewer={{ email: viewer.email }} lastBusiness={last ? { id: last.id, name: last.name } : null} />;
}
