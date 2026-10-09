/**
 * `/` → signed out: the landing page (what Foundmill is, and a way in). Signed in: the last business's Home, else the
 * first business, else /new (profile complete) or /onboarding (BUILD §6.2, AC-11.1.1).
 */
import { redirect } from "next/navigation";
import { routes } from "@foundmill/widgets/shared/routes";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";
import { serverApi } from "@/lib/trpc-server";
import { errorMessage } from "@/lib/trpc";
import { UnreachablePage } from "@/components/shell/UnreachablePage";
import { LandingPage } from "@/components/landing/LandingPage";

export const dynamic = "force-dynamic";

export default async function IndexPage() {
  const server = await serverApi();
  if (!server) return <LandingPage />;
  let profile: Awaited<ReturnType<typeof server.api.founder.profile.get.query>>;
  try {
    profile = await server.api.founder.profile.get.query();
  } catch (err) {
    return <UnreachablePage message={errorMessage(err, "The API did not answer.")} />;
  }
  if (!profile.complete) redirect("/onboarding");
  const target = pickCurrentBusiness(await getLastBusinessId(), profile.businesses);
  if (target) redirect(routes.home(target.id));
  redirect("/new");
}
