"use client";
/**
 * ExampleToggle (docs/UX_AUDIT_AND_PLAN.md §6.2): a ghost "Show me an example" that swaps a panel body or a form value
 * for a labeled example, and "Hide the example" to put it back. The example is tagged with the neutral "Example" chip
 * the landing page already uses and sits inside a dashed edge (`ExampleFrame`; the class is `exampleFrameClass` for a
 * caller that frames its own). Guidance off: nothing renders, the example included.
 *
 * Two ways to use it: pass `example` (rendered in the frame under the button while shown), or a render-prop child
 * `(shown) => node` for a form that swaps its own values and frames them itself.
 */
import { useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { useGuided } from "../guidance/GuidanceProvider";

/** A dashed edge, 10 px radius, the panel's padding: the look of an example (dashed never means "measured"). */
export const exampleFrameClass = "rounded-md border border-dashed border-line-strong p-panel-pad";

export interface ExampleFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** The example's frame: the "Example" chip, then the content. Server-safe. */
export function ExampleFrame({ className, children, ...rest }: ExampleFrameProps) {
  return (
    <div className={cn(exampleFrameClass, "flex flex-col gap-2", className)} data-example="" {...rest}>
      <div>
        <Chip tone="neutral">Example</Chip>
      </div>
      {children}
    </div>
  );
}

export interface ExampleToggleProps {
  /** Rendered in an `ExampleFrame` under the button while the example is shown. */
  example?: ReactNode;
  /** A render-prop: the caller swaps its own values and frames them (`ExampleFrame` or `exampleFrameClass`). */
  children?: (shown: boolean) => ReactNode;
  /** Uncontrolled start; default hidden. */
  defaultShown?: boolean;
  /** Controlled. */
  shown?: boolean;
  onToggle?: (shown: boolean) => void;
  showLabel?: string;
  hideLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

export function ExampleToggle({
  example,
  children,
  defaultShown = false,
  shown: shownProp,
  onToggle,
  showLabel = "Show me an example",
  hideLabel = "Hide the example",
  size = "sm",
  className,
}: ExampleToggleProps) {
  const guided = useGuided();
  const [shownState, setShownState] = useState(defaultShown);
  const shown = shownProp ?? shownState;
  if (!guided) return null;
  const toggle = () => {
    const nextShown = !shown;
    if (shownProp === undefined) setShownState(nextShown);
    onToggle?.(nextShown);
  };
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} data-example-toggle="" data-shown={shown || undefined}>
      <div>
        <Button variant="ghost" size={size} onClick={toggle} aria-expanded={shown}>
          {shown ? hideLabel : showLabel}
        </Button>
      </div>
      {children ? children(shown) : null}
      {shown && example !== undefined && example !== null ? <ExampleFrame>{example}</ExampleFrame> : null}
    </div>
  );
}
