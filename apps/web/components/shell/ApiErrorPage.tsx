/**
 * What a server page renders when its first API call fails: the invite-only page for an account this deployment does
 * not admit (the API's SIGNUP_ALLOWLIST), else UnreachablePage. Server-safe (no "use client"): it only picks which client
 * page to render, with plain string props.
 */
import { errorMessage, isNotInvited } from "@/lib/trpc";
import { NotInvitedPage } from "./NotInvitedPage";
import { UnreachablePage } from "./UnreachablePage";

export function ApiErrorPage({ error, email, fallback = "The API did not answer." }: { error: unknown; email?: string | null; fallback?: string }) {
  if (isNotInvited(error)) return <NotInvitedPage message={errorMessage(error)} email={email} />;
  return <UnreachablePage message={errorMessage(error, fallback)} />;
}
