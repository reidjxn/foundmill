"use client";
/**
 * The definition surface (docs/UX_AUDIT_AND_PLAN.md §6.2, §6.4 relaxation 1): a HoverCard (surface-popover, 320 px)
 * that opens 300 ms after hover or focus and holds the word in display-sm, the short line in body, an optional
 * "In this business: …" fact row, the longer explanation in small, and a ghost "Learn more" with an arrow.
 *
 * Tooltips are labels, so a link inside one is unreachable by keyboard (finding D2). Here the card *persists on
 * Enter* (or Space, or a click): it stays open, focus lands on "Learn more" (or on the card when there is no link),
 * Escape closes it and gives focus back to the word, and a click or Tab away closes it. Hover alone never pins it.
 */
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { HOVER_CARD_OPEN_DELAY, HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
import { isExternalLearnHref, useLearnHref } from "./LearnLink";

export interface DefinitionCardProps {
  /** The trigger: one element that takes a ref and props (a button, a focusable span). */
  children: ReactElement;
  /** The display word, in display-sm. */
  word: ReactNode;
  /** One sentence a student understands, in body. */
  short: ReactNode;
  /** A longer explanation, in small. */
  long?: ReactNode;
  /** The business's own figure for the word ("£18,400 · 7 months"); shown as "In this business: …". */
  fact?: ReactNode;
  /** The fact row's label (default "In this business"). */
  factLabel?: ReactNode;
  /** The "Learn more" target: a route slug the app resolves, or an absolute URL. */
  learn?: string;
  learnLabel?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Hover and focus delay in ms (default 300, DESIGN §7). */
  openDelay?: number;
  /** Classes for the card. */
  className?: string;
}

const ACTIVATION_KEYS = new Set(["Enter", " "]);

export function DefinitionCard({ children, word, short, long, fact, factLabel = "In this business", learn, learnLabel = "Learn more", side = "bottom", align = "start", openDelay = HOVER_CARD_OPEN_DELAY, className }: DefinitionCardProps) {
  const id = useId();
  const href = useLearnHref(learn);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Read synchronously in Radix's callbacks, which fire between renders.
  const pinnedRef = useRef(false);
  const focusInside = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  // The card mounts in a portal one render after `open` flips, so it is state: the focus effect waits for it.
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const learnLink = useRef<HTMLAnchorElement | null>(null);

  const pin = (moveFocus: boolean) => {
    pinnedRef.current = true;
    focusInside.current = moveFocus;
    setPinned(true);
    setOpen(true);
  };
  const unpin = (returnFocus: boolean) => {
    pinnedRef.current = false;
    focusInside.current = false;
    setPinned(false);
    setOpen(false);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open || !pinned || !focusInside.current || !content) return;
    focusInside.current = false;
    // Radix keeps a hover card's links out of the tab order; a pinned card hands focus to its link itself.
    (learnLink.current ?? content).focus({ preventScroll: true });
  }, [open, pinned, content]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || !ACTIVATION_KEYS.has(e.key)) return;
    e.preventDefault();
    if (pinnedRef.current) unpin(false);
    else pin(true);
  };
  const onTriggerClick = (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented) return;
    if (pinnedRef.current) unpin(false);
    else pin(e.detail === 0);
  };
  const onContentBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!pinnedRef.current) return;
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget.contains(next) || trigger.current?.contains(next))) return;
    unpin(false);
  };

  return (
    <HoverCard
      open={open}
      openDelay={openDelay}
      onOpenChange={(next) => {
        // A pinned card ignores the hover and blur closes; Escape and an outside press unpin it first.
        if (!next && pinnedRef.current) return;
        setOpen(next);
      }}
    >
      <HoverCardTrigger
        asChild
        ref={(el: HTMLElement | null) => {
          trigger.current = el;
        }}
        aria-expanded={open}
        aria-controls={open ? `${id}-card` : undefined}
        onKeyDown={onTriggerKeyDown}
        onClick={onTriggerClick}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        ref={setContent}
        id={`${id}-card`}
        side={side}
        align={align}
        tabIndex={-1}
        role="group"
        aria-labelledby={`${id}-word`}
        aria-describedby={`${id}-short`}
        data-definition-card=""
        data-pinned={pinned || undefined}
        className={cn("flex w-80 flex-col gap-2 text-pretty focus-visible:shadow-ring", className)}
        onEscapeKeyDown={() => unpin(true)}
        onPointerDownOutside={() => unpin(false)}
        onBlur={onContentBlur}
      >
        <p id={`${id}-word`} className="t-display-sm text-primary">
          {word}
        </p>
        <p id={`${id}-short`} className="t-body text-primary">
          {short}
        </p>
        {fact ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-definition-fact="">
            <span className="t-data">{factLabel}</span>
            <span className="t-body-strong tabular text-primary">{fact}</span>
          </p>
        ) : null}
        {long ? <p className="t-small text-secondary">{long}</p> : null}
        {href ? (
          <div className="-mb-1.5 -ml-2.5 flex">
            <Button asChild variant="ghost" size="sm" iconRight={ArrowRight}>
              <a
                ref={learnLink}
                href={href}
                aria-describedby={`${id}-short`}
                target={isExternalLearnHref(href) ? "_blank" : undefined}
                rel={isExternalLearnHref(href) ? "noreferrer" : undefined}
                data-definition-learn=""
              >
                {learnLabel}
              </a>
            </Button>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
