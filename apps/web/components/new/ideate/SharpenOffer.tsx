"use client";
/**
 * "Help your team help you" (WP-14 T2 step 3): once the first ideas show, a person whose Founder fit rests on the
 * first profile's quick answers is offered the long profile, once. Saving it re-rates fit on every idea in place
 * (`founder.profile.update`) and comes back here with `?sharpened=1`, where the same slot says so and offers a fresh
 * set drafted from the full profile. "Not now" is remembered in this browser for the account; the offer never comes
 * back after it, and the profile stays one press away in the trail.
 */
import type { FitBasis } from "@foundmill/config";
import { Button, Panel } from "@foundmill/dugout";
import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { LinkButton } from "../LinkButton";

export const SHARPEN_WORDS = {
  title: "Help your team help you",
  offer: "Fit is based on your quick answers. Two minutes to sharpen it?",
  go: "Sharpen my profile",
  later: "Not now",
  doneTitle: "Fit now rests on your full profile",
  done: "Founder fit was re-rated on every idea here from the skills you set. Your team can also draft a fresh set from your full profile.",
  redraft: "Draft a fresh set",
  close: "Keep these",
} as const;

/** Where the offer goes: the long profile, then back to the Studio. */
export const SHARPEN_HREF = "/onboarding?next=/new/ideate";

export function sharpenStorageKey(accountId: string | null | undefined): string {
  return `foundmill.sharpen-offer.${accountId ?? "account"}`;
}

export interface SharpenOfferProps {
  /** What Founder fit rests on now (`fitBasisOf` the profile). */
  basis: FitBasis;
  /** The person just saved the long profile over a quick one (`?sharpened=1`). */
  sharpened: boolean;
  /** The deck has at least one idea: the offer waits for the first ideas. */
  hasIdeas: boolean;
  accountId?: string | null;
  /** Draft a new set from the profile as it is now. */
  onRedraft: () => void;
  /** A draft is running: the redraft button waits. */
  busy?: boolean;
}

export function SharpenOffer({ basis, sharpened, hasIdeas, accountId = null, onRedraft, busy = false }: SharpenOfferProps) {
  const key = sharpenStorageKey(accountId);
  // Closed until the browser says the offer was never dismissed: it never flashes for a person who said "Not now".
  const [dismissed, setDismissed] = useState(true);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [key]);
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // A browser that refuses storage shows the offer again on the next visit; nothing else depends on it.
    }
  };

  if (!hasIdeas) return null;
  if (sharpened && basis === "full") {
    if (closed) return null;
    return (
      <Panel title={SHARPEN_WORDS.doneTitle} className="mb-3" data-testid="sharpen-done">
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-body text-pretty">{SHARPEN_WORDS.done}</p>
          <Button
            variant="primary"
            icon={Sparkles}
            disabled={busy}
            onClick={() => {
              setClosed(true);
              onRedraft();
            }}
            data-testid="sharpen-redraft"
          >
            {SHARPEN_WORDS.redraft}
          </Button>
          <Button variant="ghost" onClick={() => setClosed(true)}>
            {SHARPEN_WORDS.close}
          </Button>
        </div>
      </Panel>
    );
  }
  if (basis !== "quick" || dismissed) return null;
  return (
    <Panel title={SHARPEN_WORDS.title} className="mb-3" data-testid="sharpen-offer">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-body text-pretty">{SHARPEN_WORDS.offer}</p>
        <LinkButton variant="primary" iconRight={ArrowRight} href={SHARPEN_HREF} data-testid="sharpen-go">
          {SHARPEN_WORDS.go}
        </LinkButton>
        <Button variant="ghost" onClick={dismiss} data-testid="sharpen-later">
          {SHARPEN_WORDS.later}
        </Button>
      </div>
    </Panel>
  );
}
