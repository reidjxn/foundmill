/**
 * /home — the home of a signed-in person with no project yet (docs/THESIS_REVIEW.md package 2.4). The signed-in index
 * (app/start/page.tsx) sends a person here instead of /new. A person who has a project is sent to it (the index decides
 * which); a person without a profile goes to /onboarding first (AC-11.1.1).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { routes } from "@foundmill/widgets/shared/routes";
import { PersonHome } from "@/components/person-home/PersonHome";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function PersonHomePage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fhome");
  if (result.kind === "unreachable")
    return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  const current = pickCurrentBusiness(await getLastBusinessId(), viewer.businesses);
  if (current) redirect(routes.today(current.id));
  return (
    <PersonHome
      viewer={{ email: viewer.email }}
      displayName={viewer.profile?.displayName ?? null}
      liveMode={viewer.liveMode}
    />
  );
}
