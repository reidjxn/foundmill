"use client";
/**
 * What a visitor can do with the idea the landing page's idea box just shaped (founder, 2026-11-16: "the user should
 * have the option to open their idea in the ideation studio to shape the idea further, or to proceed right away"):
 * two choices, each a link the page builds (both go through sign-in and keep the card), then "Try another idea" behind
 * a warning that the card on screen will be discarded. When the browser has no redraw left today it says so plainly
 * instead of offering the button (founder, 2026-11-15, D3: up to 2 redraws a day).
 *
 * The warning is inline, in place of the button, so it works the same at 390 px and needs no browser dialog: focus
 * moves to it, Escape or "Keep <name>" puts the button back and focus on it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, PenLine, Rocket, RotateCcw, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";

export const IDEA_NEXT_WORDS = {
  title: (name: string) => `What next for ${name}?`,
  studio: "Shape it in the Ideation Studio",
  studioWhy: "Ask your team about it, try other directions and change the words until it feels right.",
  studioOnComputer: "The Ideation Studio opens on a computer.",
  build: "Start building it now",
  buildWhy: "Make it your project and put your team to work on it.",
  tryAnother: "Try another idea",
  left: (n: number) => (n === 1 ? "1 more today" : `${n} more today`),
  noneLeft: "That is all the new ideas for this device today. Come back tomorrow, or shape this one in the Ideation Studio.",
  confirmTitle: "Try another idea?",
  confirmBody: (name: string) => `${name} will be discarded. This device holds one idea at a time, and the new one takes its place.`,
  confirmLeft: (n: number) => (n === 1 ? "You can do this once more today." : `You can do this ${n} more times today.`),
  confirm: "Discard it and try another",
  cancel: (name: string) => `Keep ${name}`,
} as const;

export interface IdeaNextStepsProps {
  /** The idea's name, as the card shows it. */
  name: string;
  /** "Shape it in the Ideation Studio": where it goes (sign-in first for a visitor). */
  studioHref: string;
  /** "Start building it now": where it goes (sign-in first for a visitor). */
  buildHref: string;
  /** Under the two choices: what keeping the idea involves today (sign-in, the waitlist). */
  lead?: ReactNode;
  /** After the lead: the smaller print (what it costs, how long the idea waits). */
  children?: ReactNode;
  /** The visitor is on a small screen: say the Studio opens on a computer. */
  studioOnComputer?: boolean;
  /** Redraws left today; 0 says so instead of the button; null when unknown (the button shows, the api decides). */
  redrawsLeft: number | null;
  /** The visitor confirmed: discard this idea and try another. */
  onRedraw: () => void;
  className?: string;
}

export function IdeaNextSteps({ name, studioHref, buildHref, lead, children, studioOnComputer = false, redrawsLeft, onRedraw, className }: IdeaNextStepsProps) {
  const W = IDEA_NEXT_WORDS;
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (confirming) {
      opened.current = true;
      panel.current?.focus();
    } else if (opened.current) {
      trigger.current?.focus();
    }
  }, [confirming]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setConfirming(false);
    }
  };

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-5 text-left", className)} data-testid="idea-keep">
      <h2 className="t-landing-h3 text-primary">{W.title(name)}</h2>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Button asChild variant="glass" size="lg" icon={PenLine} iconRight={ArrowRight} className="min-h-tap w-full">
            <a href={studioHref} data-testid="idea-open-studio">
              {W.studio}
            </a>
          </Button>
          <p className="t-landing-small text-secondary">
            {W.studioWhy}
            {studioOnComputer ? ` ${W.studioOnComputer}` : null}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button asChild variant="default" size="lg" icon={Rocket} iconRight={ArrowRight} className="min-h-tap w-full">
            <a href={buildHref} data-testid="idea-build">
              {W.build}
            </a>
          </Button>
          <p className="t-landing-small text-secondary">{W.buildWhy}</p>
        </div>
      </div>
      {lead}
      {children}
      <div className="border-t border-line pt-5">
        {redrawsLeft === 0 ? (
          <p className="t-landing-small text-secondary" data-testid="idea-no-redraws">
            {W.noneLeft}
          </p>
        ) : confirming ? (
          <div
            ref={panel}
            role="group"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="surface-panel flex flex-col gap-3 p-4 focus-visible:outline-none focus-visible:shadow-ring"
            data-testid="idea-redraw-confirm"
          >
            <p id={titleId} className="t-landing-body flex items-center gap-2 font-medium text-primary">
              <Icon icon={TriangleAlert} size="default" className="text-status-warn" />
              {W.confirmTitle}
            </p>
            <p className="t-landing-small text-secondary">
              {W.confirmBody(name)}
              {redrawsLeft !== null ? ` ${W.confirmLeft(redrawsLeft)}` : null}
            </p>
            <div className="flex flex-col gap-2 @page-wide:flex-row @page-wide:flex-wrap">
              <Button
                variant="danger"
                icon={RotateCcw}
                className="min-h-tap"
                onClick={() => {
                  opened.current = false;
                  setConfirming(false);
                  onRedraw();
                }}
                data-testid="idea-redraw-confirm-yes"
              >
                {W.confirm}
              </Button>
              <Button variant="default" className="min-h-tap" onClick={() => setConfirming(false)} data-testid="idea-redraw-confirm-no">
                {W.cancel(name)}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button ref={trigger} variant="ghost" icon={RotateCcw} className="min-h-tap" onClick={() => setConfirming(true)} data-testid="idea-try-another">
              {W.tryAnother}
            </Button>
            {redrawsLeft !== null ? <span className="t-landing-small text-tertiary">{W.left(redrawsLeft)}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
