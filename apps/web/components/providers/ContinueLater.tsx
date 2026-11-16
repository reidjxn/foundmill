"use client";
/**
 * The ways on from a desktop-only page on a small screen (WP-03 T3; CLAUDE.md "Never", small screens: never a dead end),
 * passed by `DesktopOnly` into `NeedsLargerWindow` as its `actions`:
 *   1. "Get the app" when the store links are set (`publicEnv().storeLinks`, WP-03 T9; nothing while they are unset);
 *   2. for a signed-in page a link can carry (`isContinuePath`), "Email me a link": `founder.email.sendLink` emails the
 *      person's own address a link to this page, to open on a computer. It says "Sent" only when the gateway sent it;
 *      a simulated send (mock mode), platform mail switched off, a refusal or no answer say so and offer Copy link,
 *      so no screen promises an email that did not go. Any other page offers Copy link from the start;
 *   3. one way back: a project's page goes to its Today, a signed-in page to the person's home, a signed-out page to
 *      the landing page.
 * `NextStepOnComputer` is the same email control inline, for the kept card and `/home` (the reroute, a stopgap WP-04
 * removes when it rebuilds onboarding and Commit for small screens).
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Copy, Mail } from "lucide-react";
import { Button, GetTheApp, cn } from "@foundmill/dugout";
import { isContinuePath } from "@foundmill/shared/continue-path";
import type { NotifyEmailNotSent } from "@foundmill/shared/notify-email";
import { publicEnv } from "@/lib/env";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "@/components/new/LinkButton";

export const CONTINUE_LATER_WORDS = {
  email: "Email me a link",
  sending: "Sending…",
  sent: (email: string | null) => (email ? `Sent. Check ${email}.` : "Sent. Check your email."),
  notSent: "We could not send it. Copy the link instead.",
  simulated: "Email is only simulated here, so nothing was sent. Copy the link instead.",
  copy: "Copy link",
  copied: "Copied. Open it on a computer.",
  copyFailed: "Copy did not work. Here is the link:",
  backToToday: "Back to Today",
  home: "Go to your home",
  landing: "Go to the home page",
  nextStep: "The next step needs a computer for now.",
} as const;

const PROJECT_PATH = /^\/b\/([0-9a-f-]{36})(\/|$)/i;

/** The one way back from `pathname`: a project's Today, the person's home, or (signed out) the landing page. */
export function wayBack(pathname: string, signedIn: boolean): { href: string; label: string } {
  const project = PROJECT_PATH.exec(pathname);
  if (signedIn && project) return { href: `/b/${project[1]!.toLowerCase()}/today`, label: CONTINUE_LATER_WORDS.backToToday };
  if (signedIn) return { href: "/home", label: CONTINUE_LATER_WORDS.home };
  return { href: "/", label: CONTINUE_LATER_WORDS.landing };
}

type Sent = { state: "idle" } | { state: "sent"; email: string | null } | { state: "not_sent"; reason: NotifyEmailNotSent | null };

/** "Email me a link" for `path`, falling back to Copy link; Copy link alone where no email can carry the path. */
export function EmailMeALink({ path, signedIn, className }: { path: string; signedIn: boolean; className?: string }) {
  const trpc = useTRPC();
  const canEmail = signedIn && isContinuePath(path);
  const [sent, setSent] = useState<Sent>({ state: "idle" });
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const send = useMutation(
    trpc.founder.email.sendLink.mutationOptions({
      onSuccess: (r) => setSent(r.sent ? { state: "sent", email: r.email } : { state: "not_sent", reason: r.reason }),
      onError: () => setSent({ state: "not_sent", reason: null }),
    }),
  );
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };
  const showCopy = !canEmail || sent.state === "not_sent";
  return (
    <div className={cn("flex w-full flex-col items-stretch gap-3", className)} data-testid="continue-later-email">
      {canEmail && sent.state !== "not_sent" ? (
        sent.state === "sent" ? (
          <p role="status" className="t-body text-primary" data-testid="continue-later-sent">
            {CONTINUE_LATER_WORDS.sent(sent.email)}
          </p>
        ) : (
          <Button variant="primary" size="lg" icon={Mail} className="min-h-tap w-full" disabled={send.isPending} onClick={() => send.mutate({ path })}>
            {send.isPending ? CONTINUE_LATER_WORDS.sending : CONTINUE_LATER_WORDS.email}
          </Button>
        )
      ) : null}
      {sent.state === "not_sent" ? (
        <p role="status" className="t-body text-secondary" data-testid="continue-later-not-sent">
          {sent.reason === "simulated" ? CONTINUE_LATER_WORDS.simulated : CONTINUE_LATER_WORDS.notSent}
        </p>
      ) : null}
      {showCopy ? (
        <Button variant={canEmail ? "primary" : "default"} size="lg" icon={Copy} className="min-h-tap w-full" onClick={() => void copy()}>
          {CONTINUE_LATER_WORDS.copy}
        </Button>
      ) : null}
      {copied === "copied" ? (
        <p role="status" className="t-body text-secondary">
          {CONTINUE_LATER_WORDS.copied}
        </p>
      ) : null}
      {copied === "failed" ? (
        <p role="status" className="t-body text-secondary">
          {CONTINUE_LATER_WORDS.copyFailed} <span className="t-mono select-all break-all text-primary">{url}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The controls under the small-screen note: Get the app (when set), Email me a link or Copy link, and one way back. */
export function ContinueLater({ pathname, signedIn }: { pathname: string; signedIn: boolean }) {
  const back = wayBack(pathname, signedIn);
  return (
    <div className="flex w-full flex-col items-stretch gap-3" data-testid="continue-later">
      <GetTheApp links={publicEnv().storeLinks} />
      <EmailMeALink path={pathname} signedIn={signedIn} />
      <LinkButton variant="ghost" href={back.href} icon={ArrowLeft} className="min-h-tap w-full" data-testid="continue-later-back">
        {back.label}
      </LinkButton>
    </div>
  );
}

/**
 * The reroute on the kept card and `/home` (WP-03 T3; a stopgap WP-04 removes): on a small screen, a step that opens a
 * desktop-only page says so and offers the link by email instead of linking into the wall.
 */
export function NextStepOnComputer({ path, className }: { path: string; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col gap-3", className)} data-testid="next-step-on-computer" data-path={path}>
      <p className="t-body text-secondary">{CONTINUE_LATER_WORDS.nextStep}</p>
      <EmailMeALink path={path} signedIn />
    </div>
  );
}
