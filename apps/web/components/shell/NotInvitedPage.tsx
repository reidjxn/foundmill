"use client";
/**
 * Rendered by server pages when the API refuses the signed-in account because this deployment is invite-only (the API's
 * SIGNUP_ALLOWLIST, appCode `not_invited`): says so plainly, names the address that signed in, and offers to sign out
 * so the founder can use an address that is on the list. A listed address the sign-in did not show as confirmed
 * (`unconfirmed`) is asked to confirm it first.
 */
import { useActionState } from "react";
import { ListPlus, MailX } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, EmptyState, StatusPill } from "@foundmill/dugout";
import { joinWaitlist, type WaitlistJoinState } from "./waitlist-actions";
import { BrandFrame } from "./BrandFrame";
import { SignOutButton } from "./SignOutButton";

export function NotInvitedPage({ message, email, unconfirmed = false }: { message: string; email?: string | null; unconfirmed?: boolean }) {
  const title = unconfirmed ? (email ? `Confirm ${email} first` : "Confirm your address first") : email ? `${email} is not on the list` : "This address is not on the list";
  return (
    <BrandFrame title="Invite only for now" footer={<span>{APP_NAME} is open to invited founders while it is in preview.</span>}>
      <div data-testid="not-invited" data-reason={unconfirmed ? "email_unconfirmed" : "not_listed"}>
        <EmptyState icon={MailX} title={title}>
          {message}
        </EmptyState>
        {!unconfirmed ? <WaitlistJoin email={email ?? null} /> : null}
        <div className="mt-3 flex justify-end">
          <SignOutButton variant="default" />
        </div>
      </div>
    </BrandFrame>
  );
}

/**
 * The words of the waitlist offer. The joined lines promise the email the waitlist sends when the place opens
 * (WP-03 T2: the orchestrator's `waitlist-admissions` sweep and the gateway's `waitlist_admitted`), to the address that
 * signed in.
 */
export const WAITLIST_WORDS = {
  offer: "Join the waitlist and we will let you in as soon as there is room. If you made a card on the home page, it is kept for you.",
  join: "Join the waitlist",
  joinedWithCard: (email: string | null) => `Your place is saved, and your card is kept for 90 days. We email ${email ?? "you"} the day your place opens.`,
  joined: (email: string | null) => `Your place is saved. We email ${email ?? "you"} the day it opens.`,
  error: "That did not go through. Try again in a minute.",
} as const;

/** "Join the waitlist" (docs/IDEA_BOX.md): a Server Action keeps the idea box's card with the entry. */
function WaitlistJoin({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState<WaitlistJoinState, FormData>((prev) => joinWaitlist(prev), { status: "idle" });
  if (state.status === "joined") {
    return (
      <StatusPill tone="good" role="status" className="mt-3" data-testid="waitlist-joined">
        {state.cardKept ? WAITLIST_WORDS.joinedWithCard(email) : WAITLIST_WORDS.joined(email)}
      </StatusPill>
    );
  }
  return (
    <form action={action} className="mt-3 flex flex-col gap-2" data-testid="waitlist-join">
      <p className="text-body text-secondary">{WAITLIST_WORDS.offer}</p>
      <Button type="submit" variant="glass" icon={ListPlus} loading={pending} className="min-h-tap self-start">
        {WAITLIST_WORDS.join}
      </Button>
      {state.status === "error" ? (
        <StatusPill tone="bad" role="alert">
          {WAITLIST_WORDS.error}
        </StatusPill>
      ) : null}
    </form>
  );
}
