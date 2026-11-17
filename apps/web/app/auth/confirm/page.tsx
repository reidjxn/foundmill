import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { confirmationLink } from "@/lib/auth/confirm-link";
import { SIGN_IN_ERROR_PARAM } from "@/lib/auth/sign-in-errors";
import { hasSupabase, publicEnv } from "@/lib/env";
import { ConfirmSignIn } from "./ConfirmSignIn";

/** The address carries a one-time token: never indexed. */
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where the sign-in email's link lands (lib/auth/confirm-link.ts): the page reads `confirmation_url` on the server and
 * shows the one button that opens it. A link that is not this deployment's own Supabase confirmation link, or a server
 * without Supabase, goes to /login with the same reason codes /auth/callback uses, where the form sends a new link.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (!hasSupabase()) redirect(`/login?${SIGN_IN_ERROR_PARAM}=not_configured`);
  const link = confirmationLink(params, publicEnv().supabaseUrl);
  if (!link) redirect(`/login?${SIGN_IN_ERROR_PARAM}=missing_code`);
  return <ConfirmSignIn link={link} />;
}
