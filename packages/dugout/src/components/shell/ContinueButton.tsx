import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ArrowRight, CircleAlert, Pause, Play, TreePalm, Undo2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/format";
import { usePrefersReducedMotion } from "../../lib/reducedMotion";
import { Button, type ButtonSize } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { Kbd } from "../foundation/Kbd";
import { Tooltip } from "../foundation/Tooltip";
import type { ContinueState } from "./types";

/** DESIGN §7: one 600 ms soft ring pulse when a cycle finishes and new items arrive, never a loop. */
export const CONTINUE_PULSE_MS = 600;

export interface ContinueHandlers {
  /** idle: advance a business cycle. */
  onContinue?: () => void;
  /** blocked: jump to the first red item. */
  onRespond?: () => void;
  /** processing: pause the running cycle. */
  onPause?: () => void;
  /** matchday: open the Journey. */
  onGoToJourney?: () => void;
  /** holiday: end the holiday early. */
  onComeBack?: () => void;
}

export interface ContinueButtonProps extends ContinueHandlers {
  state: ContinueState;
  /** Change this value (a cycle id, a timestamp) to fire the single pulse. */
  pulseKey?: string | number;
  /** Bind Space to the state's primary action (for use outside an AppShell, which binds Space through useKeyboardMap). */
  bindSpace?: boolean;
  disabled?: boolean;
  size?: ButtonSize;
  className?: string;
}

/** The visible label for a state. */
export function continueButtonLabel(state: ContinueState): string {
  switch (state.kind) {
    case "idle":
      return "Continue";
    case "blocked":
      return `Respond · ${state.count}`;
    case "processing":
      return state.label ?? "Pause";
    case "matchday":
      return "Go to Journey";
    case "holiday":
      return "Come back";
  }
}

/** "On holiday until 14 Oct 2026" / "On holiday until the launch ships" / "On holiday". */
export function holidayCaption(state: Extract<ContinueState, { kind: "holiday" }>): string {
  if (state.untilLabel) return `On holiday until ${state.untilLabel}`;
  if (state.until) return `On holiday until ${formatDate(state.until)}`;
  return "On holiday";
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
 * The Continue button (BUILD §5.4, DESIGN §7). At rest a kit-primary fill; blocked is status-bad "Respond · N";
 * processing shows a spinner, "Pause" and a 2 px sweep along the bottom edge; Match Day is gold; holiday is neutral
 * with the caption and "Come back".
 */
export const ContinueButton = forwardRef<HTMLButtonElement, ContinueButtonProps>(function ContinueButton(
  { state, pulseKey, bindSpace = false, disabled, size = "md", className, ...handlers },
  ref,
) {
  const reduced = usePrefersReducedMotion();
  const [pulsing, setPulsing] = useState(false);
  const firstPulse = useRef(true);

  useEffect(() => {
    if (firstPulse.current) {
      firstPulse.current = false;
      return;
    }
    if (pulseKey === undefined || reduced) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), CONTINUE_PULSE_MS);
    return () => clearTimeout(t);
  }, [pulseKey, reduced]);

  const action = continueButtonAction(state, handlers);
  const label = continueButtonLabel(state);

  useHotkeys(
    "space",
    (e) => {
      if (!action || disabled) return;
      e.preventDefault();
      action();
    },
    { enabled: bindSpace },
    [action, disabled, bindSpace],
  );

  const common = {
    ref,
    size,
    disabled,
    onClick: action,
    "data-continue-state": state.kind,
    "data-pulsing": pulsing || undefined,
    "aria-keyshortcuts": "Space",
  } as const;

  const pulseClass = pulsing ? "animate-ring-pulse" : "";

  let button: ReactNode;
  switch (state.kind) {
    case "idle":
      button = (
        <Button {...common} variant="primary" icon={Play} className={cn("min-w-28", pulseClass, className)}>
          {label}
        </Button>
      );
      break;
    case "blocked":
      button = (
        <Button {...common} variant="danger" icon={CircleAlert} className={cn("min-w-28", pulseClass, className)} aria-label={`Respond to ${state.count} ${state.count === 1 ? "item" : "items"}`}>
          {label}
        </Button>
      );
      break;
    case "processing":
      button = (
        <Button {...common} variant="primary" icon={Pause} className={cn("relative min-w-28 overflow-hidden", pulseClass, className)} aria-label="Pause the running cycle">
          {label}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
            <span className="block h-full w-1/2 animate-sweep bg-kit-on-primary/70" />
          </span>
        </Button>
      );
      break;
    case "matchday":
      button = (
        <Button {...common} variant="gold" iconRight={ArrowRight} className={cn("min-w-28", pulseClass, className)}>
          {label}
        </Button>
      );
      break;
    case "holiday":
      button = (
        <span className={cn("inline-flex items-center gap-2", className)} data-continue-state="holiday">
          <span className="inline-flex items-center gap-1.5 text-small text-kit-on-primary/80">
            <Icon icon={TreePalm} size="inline" />
            <span>{holidayCaption(state)}</span>
          </span>
          <Button {...common} variant="default" icon={Undo2} className={cn("min-w-28", pulseClass)}>
            {label}
          </Button>
        </span>
      );
      break;
  }

  return (
    <Tooltip
      content={
        <span className="inline-flex items-center gap-1.5">
          {state.kind === "idle" ? "Advance a business cycle" : state.kind === "blocked" ? "Continue is blocked until you respond" : state.kind === "processing" ? "A cycle is running" : state.kind === "matchday" ? "A customer was won" : holidayCaption(state)}
          <Kbd>Space</Kbd>
        </span>
      }
      side="bottom"
    >
      {button}
    </Tooltip>
  );
});
