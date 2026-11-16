/**
 * What a server page renders when its first API call fails: for a person the admission did not let in today (the
 * API's `on_waitlist`), "You're on the list" (OnWaitlistPage, which works from 390 px wherever it is shown); the
 * invite-only page for an account this deployment does not admit (`not_invited`); else UnreachablePage. Both waitlist
 * pages get `emails` (the API's `waitlistEmails`), so their saved line promises an email only where one is sent. Server-safe
 * (no "use client"): it only picks which client page to render, with plain string props.
 */
import { errorMessage, isNotInvited, isOnWaitlist, notInvitedReason, waitlistEmails } from "@/lib/trpc";
import { NotInvitedPage } from "./NotInvitedPage";
import { OnWaitlistPage } from "./OnWaitlistPage";
import { UnreachablePage } from "./UnreachablePage";

/**
 * `keepThen`: where the waiting card should go once the person is let in ("studio", the idea box's "Shape it in the
 * Ideation Studio"), saved with it when the waitlist keeps it (0124). Only /start knows it, from its address.
 */
export function ApiErrorPage({ error, email, fallback = "The API did not answer.", keepThen = null }: { error: unknown; email?: string | null; fallback?: string; keepThen?: "studio" | null }) {
  if (isOnWaitlist(error)) return <OnWaitlistPage email={email ?? null} emails={waitlistEmails(error)} keepThen={keepThen} />;
  if (isNotInvited(error)) return <NotInvitedPage message={errorMessage(error)} email={email} unconfirmed={notInvitedReason(error) === "email_unconfirmed"} emails={waitlistEmails(error)} keepThen={keepThen} />;
  return <UnreachablePage message={errorMessage(error, fallback)} />;
}
