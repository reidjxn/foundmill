/**
 * `/i/<token>`: an invitation to a project (THESIS_REVIEW package 3.1). Public (lib/auth/redirects.ts
 * `PUBLIC_PREFIXES`), from 390 px (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`), never indexed and never
 * cached: the token is the credential. What it says comes from the api's public `invitation.byToken` (rate-limited; an
 * unknown, expired, revoked or used token reads the same).
 *
 * The browser asks the api itself (components/people/InvitationScreen.tsx), never this server render: the api's
 * per-caller limit then counts each visitor's own address, so nobody can use up every visitor's reads by opening links
 * through the web (which would give the api one address for everyone). Too many opens at once read "Too many people
 * opened links just now. Try again in a minute.", never "no longer works".
 *
 * The invitation survives sign-up without any change to sign-in: "Sign in to accept" goes to /login with `next` back
 * here, the sign-in callback returns here, and the signed-in page offers Accept.
 */
import { PublicAppPrompt } from "@/components/shell/PublicAppPrompt";
import type { Metadata } from "next";
import { InvitationScreen } from "@/components/people/InvitationScreen";
import { getServerAuth } from "@/lib/auth/server";

export const metadata: Metadata = { title: "An invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await getServerAuth();
  return (
    <>
      <InvitationScreen token={token.slice(0, 100)} signedIn={auth !== null} />
      <PublicAppPrompt />
    </>
  );
}
