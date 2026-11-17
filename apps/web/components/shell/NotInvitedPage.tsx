"use client";
/**
 * Rendered by server pages when the API refuses the signed-in account because this deployment is invite-only (the API's
 * SIGNUP_ALLOWLIST, appCode `not_invited`): says plainly that people are let in a few at a time, names the address that
 * signed in, saves their place on arrival (no press: the sign-in page said signing in does), and offers Sign out. A
 * listed address the sign-in did not show as confirmed (`unconfirmed`) is asked to confirm it first, and nothing is
 * joined. Works from 390 px wherever it is shown (`WorksOnSmallScreens`; WP-03 T1). The saved line promises the email
 * the waitlist sends when the place opens (WP-03 T2) only when the API says it is really sent here (`emails`, the API's
 * `waitlistEmails`: WAITLIST_EMAILS on and platform mail live); otherwise it says it cannot email yet.
 */
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Copy, ListPlus, MailX } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, EmptyState, StatusPill } from "@foundmill/dugout";
import { WorksOnSmallScreens } from "@/components/providers/DesktopOnly";
import { joinWaitlist, type WaitlistJoinState } from "./waitlist-actions";
import { BrandFrame } from "./BrandFrame";
import { SignOutButton } from "./SignOutButton";

export function NotInvitedPage({ message, email, unconfirmed = false, emails = false, keepThen = null }: { message: string; email?: string | null; unconfirmed?: boolean; emails?: boolean; keepThen?: "studio" | null }) {
  const title = unconfirmed ? (email ? `Confirm ${email} first` : "Confirm your address first") : email ? `${email} has a place in line` : "This address has a place in line";
  return (
    <BrandFrame smallScreen title="A few people at a time" footer={<span>{APP_NAME} lets new people in a few at a time.</span>}>
      <WorksOnSmallScreens />
      <div data-testid="not-invited" data-reason={unconfirmed ? "email_unconfirmed" : "not_listed"}>
        <EmptyState icon={MailX} title={title}>
          {message}
        </EmptyState>
        {!unconfirmed ? <WaitlistJoin email={email ?? null} emails={emails} keepThen={keepThen} /> : null}
        <div className="mt-3 flex justify-end">
          <SignOutButton variant="default" className="min-h-tap" />
        </div>
      </div>
    </BrandFrame>
  );
}

/**
 * The words of the waitlist join. `joined` and `joinedWithCard` are what is true while the waitlist cannot email; the
 * `…Email` lines promise the email (WP-03 T2: the orchestrator's `waitlist-admissions` sweep and the gateway's
 * `waitlist_admitted`) to the address that signed in, and are shown only where the API says it is sent.
 */
export const WAITLIST_WORDS = {
  offer: "We are saving your place.",
  join: "Save my place",
  // The Studio clause (founder, 2026-11-16) holds: on admission the kept card is offered at /new/card/keep and, once
  // kept, is in the deck the Ideation Studio lists (api test "someone not on the invite list joins the waitlist…").
  joinedWithCard: "Your place is saved, and your idea is kept for 90 days. As soon as you are off the waitlist, you can shape it further in the Ideation Studio. Come back to check; we cannot email you yet.",
  joined: "Your place is saved. Come back to check; we cannot email you yet.",
  joinedWithCardEmail: (email: string | null) => `Your place is saved, and your idea is kept for 90 days. We email ${email ?? "you"} the day your place opens, and from then you can shape it further in the Ideation Studio.`,
  joinedEmail: (email: string | null) => `Your place is saved. We email ${email ?? "you"} the day it opens.`,
  error: "That did not go through. Try again in a minute.",
  /** The person's own link (WP-03 T10): an offer, with no place number and no count ("No public counts"). */
  shareOffer: "Know someone who wants a place too? When they join through your link, your place opens sooner.",
  copyLink: "Copy link",
  copied: "Link copied",
  copyFailed: "The link could not be copied. Select it and copy it instead.",
} as const;

/** The saved line for this deployment: the email promise only when `emails`. */
export function waitlistJoinedLine({ cardKept, email, emails }: { cardKept: boolean; email: string | null; emails: boolean }): string {
  if (!emails) return cardKept ? WAITLIST_WORDS.joinedWithCard : WAITLIST_WORDS.joined;
  return cardKept ? WAITLIST_WORDS.joinedWithCardEmail(email) : WAITLIST_WORDS.joinedEmail(email);
}

/**
 * The person's place on the waitlist (docs/IDEA_BOX.md): a Server Action keeps the idea box's card with the entry. It
 * runs once on arrival; "Save my place" is shown only to try again after it failed. `emails`: see `waitlistJoinedLine`.
 * `keepThen`: the Studio choice, kept with the card so the first sign-in after admission opens the Studio on it (0127).
 */
export function WaitlistJoin({ email = null, emails = false, keepThen = null }: { email?: string | null; emails?: boolean; keepThen?: "studio" | null }) {
  const [state, action, pending] = useActionState<WaitlistJoinState, FormData>((prev) => joinWaitlist(prev, keepThen), { status: "idle" });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startTransition(() => action(new FormData()));
  }, [action]);
  if (state.status === "joined") {
    return (
      <>
        <StatusPill tone="good" role="status" className="mt-3" data-testid="waitlist-joined">
          {waitlistJoinedLine({ cardKept: state.cardKept, email, emails })}
        </StatusPill>
        {state.shareUrl ? <WaitlistShare url={state.shareUrl} /> : null}
      </>
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

/**
 * The person's own waitlist link (WP-03 T10: the waitlist is ordered by who brought whom). An offer only: the page says
 * nothing about anyone's place or how many came, and waiting without sharing is the same wait it always was.
 */
function WaitlistShare({ url }: { url: string }) {
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
      setTimeout(() => setCopied("no"), 2000);
    } catch {
      setCopied("failed");
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="waitlist-share">
      <p className="text-body text-secondary">{WAITLIST_WORDS.shareOffer}</p>
      <p className="break-all font-mono text-body text-primary select-all">{url}</p>
      <Button type="button" variant="glass" icon={Copy} onClick={() => void copy()} className="min-h-tap self-start">
        {copied === "yes" ? WAITLIST_WORDS.copied : WAITLIST_WORDS.copyLink}
      </Button>
      {copied === "failed" ? (
        <p role="alert" className="text-body text-secondary">
          {WAITLIST_WORDS.copyFailed}
        </p>
      ) : null}
    </div>
  );
}
