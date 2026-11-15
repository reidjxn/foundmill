"use client";
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ArrowRight, CircleAlert, Pause, Play, TreePalm, Undo2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { TERMS } from "@foundmill/shared/terms";
import type { DateFormatPrefs } from "../../lib/date-preferences";
import { formatDate, formatDateYearParts, type DateYearParts } from "../../lib/format";
import { useDateFormat } from "../foundation/DateFormatProvider";
import { usePrefersReducedMotion } from "../../lib/reducedMotion";
import { Button, type ButtonSize } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { Kbd } from "../foundation/Kbd";
import { Tooltip } from "../foundation/Tooltip";
import { useGuided, useTerm } from "../guidance/GuidanceProvider";
import type { ContinueState } from "./types";
import { spaceBelongsTo } from "./keyboard";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** DESIGN §7: one 600 ms soft ring pulse when a cycle finishes and new items arrive, never a loop. */
export const CONTINUE_PULSE_MS = 600;

export interface ContinueHandlers {
  /** idle: advance a business cycle. */
  onContinue?: () => void;
  /** blocked: jump to the first red item. */
  onRespond?: () => void;
  /** processing: pause the running cycle (and end the run: no new cycle starts on its own). */
  onPause?: () => void;
  /** matchday (a Customer Update is ready): open the Journey. */
  onGoToJourney?: () => void;
  /** holiday: end the holiday early. */
  onComeBack?: () => void;
}

export interface ContinueButtonProps extends ContinueHandlers {
  state: ContinueState;
  /** The running cycle's number, for the processing tooltip ("The team is working · cycle 3"). */
  cycleNumber?: number | null;
  /** Change this value (a cycle id, a timestamp) to fire the single pulse. */
  pulseKey?: string | number;
  /** Bind Space to the state's primary action (for use outside an AppShell, which binds Space through useKeyboardMap). */
  bindSpace?: boolean;
  disabled?: boolean;
  /**
   * The state's action is on its way (the cycle is starting, the pause is being sent). The button shows a spinner and
   * refuses presses but keeps keyboard focus, unlike `disabled`, so the founder does not lose their place.
   */
  pending?: boolean;
  /**
   * A sentence the tooltip adds after the state's own (first-time founder report, Nov 8, 2026): what a press can and
   * cannot do right now, e.g. "The orchestrator is not reachable: a press writes one note; no agent works." Also on the
   * button as `data-continue-caveat`, so a screen can read it.
   */
  caveat?: string | null;
  /**
   * A quiet line after the state's sentence: what the last cycle cost, as an Estimate ("Last cycle cost $0.52 ·
   * Estimate"), so a press has a price before it is made (first-time founder report, Nov 8, 2026).
   */
  hint?: string | null;
  size?: ButtonSize;
  className?: string;
}

/** The visible label for a state. */
export function continueButtonLabel(state: ContinueState): string {
  switch (state.kind) {
    case "idle":
      return "Continue";
    case "blocked":
      return `Needs you · ${state.count}`;
    case "processing":
      return state.label ?? "Pause";
    case "matchday":
      return "Go to Journey";
    case "holiday":
      return "Come back";
  }
}

/**
 * What a vacation waits for, without a leading "until": the caption adds that word itself, and a stored condition is a
 * whole phrase ("until I return" for the open-ended vacation, whatever a founder typed for a condition).
 */
export function untilPhrase(label: string): string {
  return label.trim().replace(/^until\s+/i, "");
}

/**
 * "On vacation until Oct 14, 2026" / "On vacation until the launch ships" / "On vacation". The date follows the
 * signed-in person's format when `prefs` is given ("14 Oct 2026", "2026-10-14").
 */
export function holidayCaption(state: Extract<ContinueState, { kind: "holiday" }>, prefs?: DateFormatPrefs | null): string {
  if (state.untilLabel) return `On vacation until ${untilPhrase(state.untilLabel)}`;
  if (state.until) return `On vacation until ${formatDate(state.until, "date", prefs)}`;
  return "On vacation";
}

/**
 * The caption in parts, for a top bar that has to compact (KitBarFit): the words before the date, the date with its
 * year apart (the year goes first: "Oct 14" + ", 2026", "14 Oct" + " 2026", "2026-" + "10-14"), and the short form
 * ("Until Oct 14"). Exported for tests.
 */
export function holidayCaptionParts(state: Extract<ContinueState, { kind: "holiday" }>, prefs?: DateFormatPrefs | null): { full: string; date: DateYearParts | null; short: string } {
  if (state.untilLabel) return { full: `On vacation until ${untilPhrase(state.untilLabel)}`, date: null, short: `Until ${untilPhrase(state.untilLabel)}` };
  if (state.until) return { full: "On vacation until ", date: formatDateYearParts(state.until, prefs), short: `Until ${formatDate(state.until, "dayMonth", prefs)}` };
  return { full: "On vacation", date: null, short: "On vacation" };
}

/** "One round of work: …" → "A cycle is one round of work: …": the definition as a sentence of its own. */
export function cycleDefinitionSentence(short: string): string {
  const text = short.trim();
  return text ? `A cycle is ${text.charAt(0).toLowerCase()}${text.slice(1)}` : "";
}

/**
 * The tooltip's sentence per state (docs/UX_AUDIT_AND_PLAN.md §7.7, B1): what pressing does, in the business's words.
 * Idle says the loop once (since Nov 7, 2026 one press keeps the team working until nothing is left); blocked counts the
 * notes and says what the press opens; processing names the cycle, and during a run says new cycles start on their own;
 * the Customer Update and vacation states keep their words. Exported for tests.
 *
 * `cycleDefinition` (the definitions map's `cycle.short`, passed while guidance is on): the idle sentence names the
 * cycle and defines it in words. A tooltip is a label and cannot hold the Term's button, so the definition is a
 * sentence instead of an underline.
 */
export function continueTooltip(state: ContinueState, cycleNumber?: number | null, prefs?: DateFormatPrefs | null, cycleDefinition?: string | null): string {
  switch (state.kind) {
    case "idle": {
      const defined = cycleDefinition ? cycleDefinitionSentence(cycleDefinition) : "";
      return defined ? `Let the team work, one cycle after another, until nothing is left to do. ${defined}` : "Let the team work until nothing is left to do. Their notes land in the Inbox.";
    }
    case "blocked":
      return `${state.count} ${state.count === 1 ? "thing needs" : "things need"} you before the team can work (credits used up or a key to replace). Press to open the first.`;
    case "processing": {
      const working = typeof cycleNumber === "number" && cycleNumber > 0 ? `The team is working · cycle ${cycleNumber}` : "The team is working";
      return state.run ? `${working}. New cycles start on their own until nothing is left to do.` : working;
    }
    case "matchday":
      return "A customer was won";
    case "holiday":
      return holidayCaption(state, prefs);
  }
}

/** The callback Space (and a click) should run for a state. */
export function continueButtonAction(state: ContinueState, handlers: ContinueHandlers): (() => void) | undefined {
  switch (state.kind) {
    case "idle":
      return handlers.onContinue;
    case "blocked":
      return handlers.onRespond;
    case "processing":
      return handlers.onPause;
    case "matchday":
      return handlers.onGoToJourney;
    case "holiday":
      return handlers.onComeBack;
  }
}

/**
 * The Continue button (BUILD §5.4, DESIGN §7). At rest the brand primary with its light (Play, "Continue"). Blocked
 * (only a hard stop since Nov 7, 2026: credits used up, a revoked key) is amber "Needs you" with the count in a capsule
 * and one 600 ms ring pulse when it turns blocked; open decisions never block it. Processing is a dark slab with a light arc orbiting its edge and "Pause", for the whole run one press of Continue starts (between its cycles too). A Customer Update is gold.
 * Vacation is neutral with the caption and "Come back". It keeps one width through its states, so the bar never jumps.
 */
export const ContinueButton = forwardRef<HTMLButtonElement, ContinueButtonProps>(function ContinueButton(
  { state, cycleNumber, pulseKey, bindSpace = false, disabled, pending = false, caveat = null, hint = null, size = "md", className, ...handlers },
  ref,
) {
  const reduced = usePrefersReducedMotion();
  // The vacation state wraps the button with its caption, so entering or leaving it swaps the element under the
  // keyboard: when the old button had focus, the new one takes it (WCAG 2.4.3). Read at render, before the swap commits.
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const setButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const wrapped = state.kind === "holiday";
  const hadFocus = typeof document !== "undefined" && buttonRef.current !== null && buttonRef.current === document.activeElement;
  useIsoLayoutEffect(() => {
    const el = buttonRef.current;
    if (hadFocus && el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [wrapped, hadFocus]);
  const datePrefs = useDateFormat();
  // While guidance is on, the idle tooltip defines "cycle" (the business's own word from the map, else the source).
  const guided = useGuided();
  const cycleTerm = useTerm("cycle");
  const cycleDefinition = guided ? (cycleTerm?.short ?? TERMS.cycle.short) : null;
  const [pulsing, setPulsing] = useState(false);
  const firstPulse = useRef(true);
  const lastKind = useRef(state.kind);

  const pulse = useCallback(() => {
    if (reduced) return undefined;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), CONTINUE_PULSE_MS);
    return () => clearTimeout(t);
  }, [reduced]);

  useEffect(() => {
    if (firstPulse.current) {
      firstPulse.current = false;
      return;
    }
    if (pulseKey === undefined) return;
    return pulse();
  }, [pulseKey, pulse]);

  // One ring pulse in red when Continue turns blocked (never on mount, never a loop).
  useEffect(() => {
    const was = lastKind.current;
    lastKind.current = state.kind;
    if (state.kind === "blocked" && was !== "blocked") return pulse();
    return undefined;
  }, [state.kind, pulse]);

  const action = continueButtonAction(state, handlers);
  const label = continueButtonLabel(state);

  useHotkeys(
    "space",
    (e) => {
      if (!action || disabled || pending) return;
      e.preventDefault();
      action();
    },
    // A focused control keeps Space (Space on this button presses it natively).
    { enabled: (e) => bindSpace && !spaceBelongsTo(e.target) },
    [action, disabled, pending, bindSpace],
  );

  const common = {
    ref: setButtonRef,
    size,
    disabled,
    loading: pending,
    onClick: action,
    "data-continue-state": state.kind,
    "data-continue-caveat": caveat || undefined,
    "data-pulsing": pulsing || undefined,
    "aria-keyshortcuts": "Space",
    // The first-time callout (Coachmark, next wave) anchors here.
    "data-coachmark": "continue",
  } as const;

  const pulseClass = pulsing ? "animate-ring-pulse" : "";
  const skin = "continue-skin min-w-continue-min";

  let button: ReactNode;
  switch (state.kind) {
    case "idle":
      button = (
        <Button {...common} variant="primary" icon={Play} className={cn(skin, pulseClass, className)}>
          {label}
        </Button>
      );
      break;
    case "blocked":
      button = (
        // Only a hard stop (credits used up, a revoked key) gets here since Nov 7, 2026: amber, never the red "Respond"
        // that every open decision and customer win used to turn Continue into.
        <Button
          {...common}
          variant="default"
          icon={CircleAlert}
          className={cn(skin, "tone-status-warn text-status-warn font-semibold", pulseClass, className)}
          aria-label={`${state.count} ${state.count === 1 ? "thing needs" : "things need"} you before the team can work`}
        >
          <span>Needs you</span>
          <span className="sr-only"> · </span>
          <span className="continue-count" data-continue-count>
            {state.count > 99 ? "99+" : state.count}
          </span>
        </Button>
      );
      break;
    case "processing":
      button = (
        <Button {...common} variant="default" icon={Pause} className={cn(skin, "orbit", pulseClass, className)} aria-label="Pause the running cycle">
          {label}
        </Button>
      );
      break;
    case "matchday":
      button = (
        <Button {...common} variant="gold" iconRight={ArrowRight} className={cn(skin, "tone-gold", pulseClass, className)}>
          {label}
        </Button>
      );
      break;
    case "holiday": {
      const holidayParts = holidayCaptionParts(state, datePrefs);
      button = (
        <span className="inline-flex items-center gap-2" data-continue-state="holiday">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-small text-kit-on-primary/80" data-holiday-caption>
            <Icon icon={TreePalm} size="inline" />
            {/* In a crowded top bar the caption shortens, then leaves only its icon (KitBarFit); the words stay for
                screen readers and in the tooltip. */}
            <span className="sr-only">{holidayCaption(state, datePrefs)}</span>
            <span aria-hidden className="kitbar-holiday-full">
              {holidayParts.full}
              {holidayParts.date?.lead ? <span className="kitbar-year">{holidayParts.date.lead}</span> : null}
              {holidayParts.date?.core}
              {holidayParts.date?.tail ? <span className="kitbar-year">{holidayParts.date.tail}</span> : null}
            </span>
            <span aria-hidden className="kitbar-holiday-short">
              {holidayParts.short}
            </span>
          </span>
          <Button {...common} variant="default" icon={Undo2} className={cn(skin, pulseClass, className)}>
            {label}
          </Button>
        </span>
      );
      break;
    }
  }

  return (
    <Tooltip
      content={
        <span className="flex max-w-80 flex-col gap-1">
          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{continueTooltip(state, cycleNumber, datePrefs, cycleDefinition)}</span>
            {/* A control hint, like the search's ⌘K: it stays whatever the guidance setting. */}
            <Kbd>Space</Kbd>
          </span>
          {caveat ? <span className="text-status-warn">{caveat}</span> : null}
          {hint ? <span className="text-secondary" data-continue-hint="">{hint}</span> : null}
        </span>
      }
      side="bottom"
    >
      {button}
    </Tooltip>
  );
});
