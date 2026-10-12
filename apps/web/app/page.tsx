/**
 * `/` → signed out: the landing page (what Foundmill is, and a way in). Signed in: the last business's Home, else the
 * first business, else /new (profile complete) or /onboarding (BUILD §6.2, AC-11.1.1).
 *
 * `/?example=glitchwick|northwind|tutorlane` deep-links the landing page's example business. It is read here, on the
 * server, and the chosen business is loaded and passed down whole, so the server render and hydration show the same
 * business (Tutorlane, the default, is in the page's own bundle and needs no prop).
 */
import { redirect } from "next/navigation";
import { routes } from "@foundmill/widgets/shared/routes";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";
import { serverApi } from "@/lib/trpc-server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { LandingPage } from "@/components/landing/LandingPage";
import { DEFAULT_EXAMPLE_ID, EXAMPLE_PARAM, loadExample, parseExampleId } from "@/components/landing/examples";

export const dynamic = "force-dynamic";

export default async function IndexPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const server = await serverApi();
  if (!server) {
    const id = parseExampleId((await searchParams)[EXAMPLE_PARAM]);
    return <LandingPage initialExample={id === DEFAULT_EXAMPLE_ID ? undefined : await loadExample(id)} />;
  }
  let profile: Awaited<ReturnType<typeof server.api.founder.profile.get.query>>;
  try {
    profile = await server.api.founder.profile.get.query();
  } catch (err) {
    return <ApiErrorPage error={err} email={server.auth.email} />;
  }
  if (!profile.complete) redirect("/onboarding");
  const target = pickCurrentBusiness(await getLastBusinessId(), profile.businesses);
  if (target) redirect(routes.home(target.id));
  redirect("/new");
}
