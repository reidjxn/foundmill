"use client";
/**
 * Coachmark (docs/UX_AUDIT_AND_PLAN.md §6.2): anchored steps for the first-visit tours (Home, Inbox, a department tab)
 * and the single-step callouts (the first Continue, the first decision). Each step is a Popover (surface-popover,
 * elev-2) anchored to its target, which gets the 2 px kit-lift selection ring: an overlay box that follows the target's
 * rect, with no backdrop and nothing modal. Inside: a `t-title` headline, one body sentence, a mono "2 of 5", then
 * Back / Next / Skip tour. ArrowLeft and ArrowRight move, Esc skips. Overlay motion 200 ms, instant under reduced
 * motion. Finishing or skipping marks the tour done (`markTourDone`), so it never replays.
 *
 * It never starts when the tour is already done, when guidance is off, while an element with `[data-coachmark-pause]`
 * is in the document (the app sets it while Continue is processing or one of its own overlays is open), or while any
 * dialog is open (`[role="dialog"]`: a Dialog, a Sheet, the command palette, another tour's card); it waits for the
 * pause to clear and for its targets to appear, then starts. A step whose target is missing is skipped; a target that
 * leaves the page mid-tour moves the tour on; a tour none of whose targets ever appear simply never starts. The ring
 * follows its target through scrolling, resizing and layout changes.
 *
 * When the tour ends (Done, Skip tour, Esc, or the card closing for any reason) keyboard focus goes back to the element
 * that had it when the tour started (the "Replay the tour" button, a row the founder was on); when nothing had it (the
 * tour started on its own on page load), to the last target when that is focusable (the Continue button after its
 * callout), and otherwise nowhere in particular.
 *
 * Targets are found by DOM id or by a `data-coachmark="<targetId>"` attribute.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { usePrefersReducedMotion } from "../../lib/reducedMotion";
import { Button } from "../foundation/Button";
import { Popover, PopoverAnchor, PopoverContent } from "../foundation/Popover";
import { useGuidance } from "../guidance/GuidanceProvider";

export interface CoachmarkStep {
  /** A DOM id, or the value of a `data-coachmark` attribute. */
  targetId: string;
  title: string;
  /** One sentence. */
  body: string;
  /** Where the card sits relative to the target; default below. */
  side?: "top" | "right" | "bottom" | "left";
  /** How the card lines up along that side; default at the start (the target's left or top edge). */
  align?: "start" | "center" | "end";
}

export type CoachmarkOutcome = "done" | "skipped";

export interface CoachmarkProps {
  tourId: string;
  steps: readonly CoachmarkStep[];
  onDone?: (outcome: CoachmarkOutcome) => void;
  /** Start as soon as the page allows (default true). With false, the tour starts when `open` turns true. */
  autoStart?: boolean;
  /** With `autoStart` false: true starts the tour. */
  open?: boolean;
}

/** The app sets this on an element while Continue is processing or a dialog is open; no tour starts meanwhile. */
export const COACHMARK_PAUSE_SELECTOR = "[data-coachmark-pause]";

/** The element a step points at: by id, then by `data-coachmark`. */
export function findCoachmarkTarget(targetId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const byId = document.getElementById(targetId);
  if (byId) return byId;
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(targetId) : targetId.replace(/["\\]/g, "\\$&");
  return document.querySelector<HTMLElement>(`[data-coachmark="${escaped}"]`);
}

/**
 * An open dialog of any kind (a Dialog, a Sheet, the command palette, another tour's own card) also pauses a tour: a
 * coach mark must never open over a dialog, and two tours never run at once.
 */
export const COACHMARK_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/** True while something on the page asks tours to wait: a pause marker, or an open dialog. */
export function isCoachmarkPaused(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(COACHMARK_PAUSE_SELECTOR) !== null || document.querySelector(COACHMARK_DIALOG_SELECTOR) !== null;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Room between the target and its ring. */
const RING_PAD = 4;

/** True when the element takes keyboard focus on its own (a button, a link, anything with a tab stop). */
function isFocusable(el: HTMLElement): boolean {
  if (el.matches("[disabled], [aria-hidden='true']")) return false;
  if (el.tabIndex >= 0) return true;
  return el.matches("a[href], button, input, select, textarea, [contenteditable='true']");
}

/**
 * Where focus goes when a tour ends: the element that had it when the tour started (if it is still on the page), else
 * the last target when it can take focus, else nothing. Exported for tests.
 */
export function focusAfterTour(opener: HTMLElement | null, lastTarget: HTMLElement | null): HTMLElement | null {
  if (opener && opener.isConnected && opener !== document.body && isFocusable(opener)) return opener;
  if (lastTarget && lastTarget.isConnected && isFocusable(lastTarget)) return lastTarget;
  return null;
}

export function Coachmark({ tourId, steps, onDone, autoStart = true, open }: CoachmarkProps) {
  const { guidance, toursDone, markTourDone } = useGuidance();
  const reduced = usePrefersReducedMotion();
  const titleId = useId();
  const bodyId = useId();
  const [index, setIndex] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const wants = autoStart || open === true;
  const eligible = guidance === "on" && !toursDone[tourId] && !finished && wants;

  /** The nearest step from `from` in `dir` whose target is on the page, or -1. */
  const existing = useCallback((from: number, dir: 1 | -1): number => {
    const list = stepsRef.current;
    for (let i = from; i >= 0 && i < list.length; i += dir) if (findCoachmarkTarget(list[i]!.targetId)) return i;
    return -1;
  }, []);

  // What had focus when the tour started, and the target of the step on screen: focus goes back to one of them after.
  const openerRef = useRef<HTMLElement | null>(null);
  const lastTargetRef = useRef<HTMLElement | null>(null);

  const finish = useCallback(
    (outcome: CoachmarkOutcome) => {
      setIndex(null);
      setFinished(true);
      markTourDone(tourId);
      onDoneRef.current?.(outcome);
    },
    [markTourDone, tourId],
  );

  // The index as of the last render, for handlers that run outside React (observers, listeners).
  const indexRef = useRef<number | null>(null);
  indexRef.current = index;
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether Back and Next had somewhere to go as of the last render: a target that appears or leaves mid-step (a
  // decision opened in the Inbox, a panel closed) changes that without any state of ours changing, so the DOM watcher
  // asks for a render when it does.
  const navRef = useRef({ prev: false, next: false });
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const next = useCallback(() => {
    const i = indexRef.current;
    if (i === null) return;
    const n = existing(i + 1, 1);
    if (n < 0) finish("done");
    else setIndex(n);
  }, [existing, finish]);

  const back = useCallback(() => {
    const i = indexRef.current;
    if (i === null) return;
    const p = existing(i - 1, -1);
    if (p >= 0) setIndex(p);
  }, [existing]);

  // Start: when eligible and not yet showing, the first step with a target, unless the page asks tours to wait. While
  // blocked (a pause, or no target yet), watch the document and try again as it changes.
  useEffect(() => {
    if (!eligible || index !== null || typeof document === "undefined") return;
    const tryStart = (): boolean => {
      if (isCoachmarkPaused()) return false;
      const first = existing(0, 1);
      if (first < 0) return false;
      // Remembered before the card takes focus: the "Replay the tour" button, the row the founder was on, or nothing.
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      setIndex(first);
      return true;
    };
    if (tryStart()) return;
    if (typeof MutationObserver === "undefined") return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (tryStart()) observer.disconnect();
      });
    });
    // A dialog opening or closing is a mount, an unmount or a `data-state` flip; the pause marker and the targets are
    // attributes: all of these wake the retry.
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-coachmark-pause", "data-coachmark", "id", "role", "data-state"] });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [eligible, index, existing]);

  // Guidance turned off, or the tour marked done elsewhere (Settings › Preferences), mid-tour: close without marking.
  useEffect(() => {
    if (index !== null && (guidance !== "on" || toursDone[tourId])) setIndex(null);
  }, [guidance, toursDone, tourId, index]);

  // Follow the target: measure it now and on scroll, resize and its own size changes; mark it while it is the focus.
  const targetId = index !== null ? (steps[index]?.targetId ?? null) : null;
  useLayoutEffect(() => {
    if (index === null || targetId === null) return;
    const el = findCoachmarkTarget(targetId);
    if (!el) {
      // The target left the page (navigation, a panel closed): move on, or finish.
      next();
      return;
    }
    lastTargetRef.current = el;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : { top: r.top, left: r.left, width: r.width, height: r.height }));
    };
    measure();
    el.setAttribute("data-coachmark-active", "");
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // The target may be removed while this step shows: watch its ancestors' children. Another step's target may
    // appear or leave meanwhile: then Back or Next changes, so the card is rendered again.
    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            if (!el.isConnected) {
              next();
              return;
            }
            measure();
            const i = indexRef.current;
            if (i === null) return;
            const nav = { prev: existing(i - 1, -1) >= 0, next: existing(i + 1, 1) >= 0 };
            if (nav.prev !== navRef.current.prev || nav.next !== navRef.current.next) rerender();
          })
        : null;
    mo?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-coachmark", "id"] });
    return () => {
      el.removeAttribute("data-coachmark-active");
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [index, targetId, next, existing]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  };

  // The card closed (Done, Skip tour, Esc, guidance turned off, the tour marked done elsewhere): focus goes back to
  // where it was, or to the last target when that is a control. Radix would otherwise look for a trigger it never had.
  const onCloseAutoFocus = (e: Event) => {
    e.preventDefault();
    const to = focusAfterTour(openerRef.current, lastTargetRef.current);
    openerRef.current = null;
    lastTargetRef.current = null;
    to?.focus({ preventScroll: true });
  };

  const showing = index !== null && box !== null;
  const step = index !== null ? steps[index] : undefined;
  const count = steps.length;
  const single = count === 1;
  const hasPrev = index !== null && existing(index - 1, -1) >= 0;
  const hasNext = index !== null && existing(index + 1, 1) >= 0;
  navRef.current = { prev: hasPrev, next: hasNext };

  const ringStyle: CSSProperties | undefined = box
    ? { top: box.top - RING_PAD, left: box.left - RING_PAD, width: box.width + RING_PAD * 2, height: box.height + RING_PAD * 2 }
    : undefined;

  return (
    <Popover open={showing} modal={false}>
      {index !== null ? (
        <PopoverAnchor asChild>
          <div
            aria-hidden
            data-coachmark-ring=""
            data-tour={tourId}
            className={cn("pointer-events-none fixed z-40 rounded-md ring-2 ring-kit-lift shadow-glow-kit", reduced ? "transition-none" : "transition-all duration-overlay ease-out")}
            style={ringStyle}
          />
        </PopoverAnchor>
      ) : null}
      {step ? (
        <PopoverContent
          ref={contentRef}
          side={step.side ?? "bottom"}
          align={step.align ?? "start"}
          sideOffset={8 + RING_PAD}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          data-coachmark=""
          data-tour={tourId}
          data-step={index !== null ? index + 1 : undefined}
          className="w-80 outline-none"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            // Focus the card itself, so the arrows work at once and no button looks pressed.
            e.preventDefault();
            contentRef.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            finish("skipped");
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          onInteractOutside={(e) => {
            // Nothing modal: clicks reach the page; the card stays until Next, Done, Skip or Esc.
            e.preventDefault();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <p id={titleId} className="t-title text-primary">
            {step.title}
          </p>
          <p id={bodyId} className="t-body mt-1 text-secondary text-pretty">
            {step.body}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {single ? null : (
              <span className="t-mono text-tertiary" data-coachmark-count="">
                {(index ?? 0) + 1} of {count}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {single ? (
                <Button size="sm" onClick={() => finish("done")}>
                  Got it
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => finish("skipped")}>
                    Skip tour
                  </Button>
                  <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} disabled={!hasPrev}>
                    Back
                  </Button>
                  {hasNext ? (
                    <Button size="sm" iconRight={ArrowRight} onClick={next}>
                      Next
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => finish("done")}>
                      Done
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

export interface CalloutProps {
  tourId: string;
  targetId: string;
  title: string;
  body: string;
  side?: CoachmarkStep["side"];
  align?: CoachmarkStep["align"];
  onDone?: (outcome: CoachmarkOutcome) => void;
  autoStart?: boolean;
  open?: boolean;
}

/** A single-step coach mark with a "Got it": the first-Continue and first-decision callouts, the landing deck's. */
export function Callout({ tourId, targetId, title, body, side, align, onDone, autoStart, open }: CalloutProps) {
  return <Coachmark tourId={tourId} steps={[{ targetId, title, body, side, align }]} onDone={onDone} autoStart={autoStart} open={open} />;
}
