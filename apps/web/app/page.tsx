/**
 * `/` → the last business's Home, else the first business, else /new (profile complete) or /onboarding (BUILD §6.2,
 * AC-11.1.1). The proxy already redirected signed-out visitors to /login.
 */
import { redirect } from "next/navigation";
import { routes } from "@foundmill/widgets/shared/routes";
import { getLastBusinessId } from "@/lib/auth/server";
import { serverApi } from "@/lib/trpc-server";
import { errorMessage } from "@/lib/trpc";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const dynamic = "force-dynamic";

export default async function IndexPage() {
  const server = await serverApi();
  if (!server) redirect("/login");
  let profile: Awaited<ReturnType<typeof server.api.founder.profile.get.query>>;
  try {
    profile = await server.api.founder.profile.get.query();
  } catch (err) {
    return <UnreachablePage message={errorMessage(err, "The API did not answer.")} />;
  }
  if (!profile.complete) redirect("/onboarding");
  const last = await getLastBusinessId();
  const businesses = profile.businesses;
  const target = (last && businesses.find((b) => b.id === last)) ?? businesses[0];
  if (target) redirect(routes.home(target.id));
  redirect("/new");
}
