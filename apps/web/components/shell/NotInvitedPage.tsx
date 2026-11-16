"use client";
/**
 * Rendered by server pages when the API refuses the signed-in account because this deployment is invite-only (the API's
 * SIGNUP_ALLOWLIST, appCode `not_invited`): says plainly that people are let in a few at a time, names the address that
 * signed in, saves their place on arrival (no press: the sign-in page said signing in does), and offers Sign out. A
 * listed address the sign-in did not show as confirmed (`unconfirmed`) is asked to confirm it first, and nothing is
 * joined. Works from 390 px wherever it is shown (`WorksOnSmallScreens`; WP-03 T1). No line promises an email until the
 * waitlist sends one.
 */
import { startTransition, useActionState, useEffect, useRef } from "react";
import { ListPlus, MailX } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, EmptyState, StatusPill } from "@foundmill/dugout";
import { WorksOnSmallScreens } from "@/components/providers/DesktopOnly";
import { joinWaitlist, type WaitlistJoinState } from "./waitlist-actions";
import { BrandFrame } from "./BrandFrame";
import { SignOutButton } from "./SignOutButton";

export function NotInvitedPage({ message, email, unconfirmed = false }: { message: string; email?: string | null; unconfirmed?: boolean }) {
  const title = unconfirmed ? (email ? `Confirm ${email} first` : "Confirm your address first") : email ? `${email} has a place in line` : "This address has a place in line";
  return (
    <BrandFrame smallScreen title="A few people at a time" footer={<span>{APP_NAME} lets new people in a few at a time.</span>}>
      <WorksOnSmallScreens />
      <div data-testid="not-invited" data-reason={unconfirmed ? "email_unconfirmed" : "not_listed"}>
        <EmptyState icon={MailX} title={title}>
          {message}
        </EmptyState>
        {!unconfirmed ? <WaitlistJoin /> : null}
        <div className="mt-3 flex justify-end">
          <SignOutButton variant="default" className="min-h-tap" />
        </div>
      </div>
    </BrandFrame>
  );
}

/** The words of the waitlist join. */
export const WAITLIST_WORDS = {
  offer: "We are saving your place.",
  join: "Save my place",
  joinedWithCard: "Your place is saved, and your card is kept for 90 days. Come back to check; we cannot email you yet.",
  joined: "Your place is saved. Come back to check; we cannot email you yet.",
  error: "That did not go through. Try again in a minute.",
} as const;

/**
 * The person's place on the waitlist (docs/IDEA_BOX.md): a Server Action keeps the idea box's card with the entry. It
 * runs once on arrival; "Save my place" is shown only to try again after it failed.
 */
export function WaitlistJoin() {
  const [state, action, pending] = useActionState<WaitlistJoinState, FormData>((prev) => joinWaitlist(prev), { status: "idle" });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startTransition(() => action(new FormData()));
  }, [action]);
  if (state.status === "joined") {
    return (
      <StatusPill tone="good" role="status" className="mt-3" data-testid="waitlist-joined">
        {state.cardKept ? WAITLIST_WORDS.joinedWithCard : WAITLIST_WORDS.joined}
      </StatusPill>
    );
  }
  if (state.status !== "error") {
    return (
      <p role="status" className="mt-3 text-body text-secondary" data-testid="waitlist-saving">
        {WAITLIST_WORDS.offer}
      </p>
    );
  }
  return (
    <form action={action} className="mt-3 flex flex-col gap-2" data-testid="waitlist-join">
      <StatusPill tone="bad" role="alert">
        {WAITLIST_WORDS.error}
      </StatusPill>
      <Button type="submit" variant="glass" icon={ListPlus} loading={pending} className="min-h-tap self-start">
        {WAITLIST_WORDS.join}
      </Button>
    </form>
  );
}
