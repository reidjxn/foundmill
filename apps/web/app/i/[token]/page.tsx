/**
 * `/i/<token>`: an invitation to a project (THESIS_REVIEW package 3.1). Public (lib/auth/redirects.ts
 * `PUBLIC_PREFIXES`), from 390 px (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`), never indexed and never
 * cached: the token is the credential. What it says comes from the api's public `invitation.byToken` (rate-limited; an
 * unknown, expired, revoked or used token reads the same).
 *
 * The invitation survives sign-up without any change to sign-in: "Sign in to accept" goes to /login with `next` back
 * here, the sign-in callback returns here, and the signed-in page offers Accept.
 */
import type { Metadata } from "next";
import { InvitationScreen, type InvitationPreview } from "@/components/people/InvitationScreen";
import { getServerAuth } from "@/lib/auth/server";
import { createApiClient, SERVER_LIMITS } from "@/lib/trpc";

export const metadata: Metadata = { title: "An invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = createApiClient({ getToken: () => null, fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }), limits: SERVER_LIMITS });
  const preview: InvitationPreview = await api.invitation.byToken.query({ token: token.slice(0, 100) }).catch(() => ({ state: "unavailable" as const }));
  const auth = await getServerAuth();
  return <InvitationScreen token={token} preview={preview} signedIn={auth !== null} />;
}
