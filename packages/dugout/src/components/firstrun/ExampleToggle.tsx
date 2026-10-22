"use client";
/**
 * ExampleToggle (docs/UX_AUDIT_AND_PLAN.md §6.2, Phase 3 "teaching by doing"): a ghost "Show me an example" that swaps
 * a panel body or a form's values for a labeled example, and "Hide the example" to put them back. The example is
 * tagged with the neutral "Example" chip the landing page already uses and sits inside a dashed edge (`ExampleFrame`;
 * the class is `exampleFrameClass` for a caller that frames its own). Guidance off: nothing renders, the example
 * included.
 *
 * Three ways to use it:
 * - `example`: rendered in the frame under the button while shown (a panel body);
 * - a render-prop child `(shown) => node`: a form that swaps its own values and frames them itself;
 * - `onFill` / `onClear` with a controlled `shown`: a form that keeps its own state fills its fields on `onFill` and
 *   clears what the example filled (and only that) on `onClear` (the founder profile, the Finance drivers).
 *
 * `options` turns the one button into a group of chips under a lead `label` ("Try an example brief"): a chip fills
 * (`onFill(id)`), pressing the chosen chip again clears (`onClear`); `value` is the chosen id when controlled.
 */
import { useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { useGuided } from "../guidance/GuidanceProvider";

/** A dashed edge, 10 px radius, the panel's padding: the look of an example (dashed never means "measured"). */
export const exampleFrameClass = "rounded-md border border-dashed border-line-strong p-panel-pad";

/** The word on the chip that tags an example, wherever one shows. */
export const EXAMPLE_TAG = "Example";

export interface ExampleFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** The example's frame: the "Example" chip, then the content. Server-safe. */
export function ExampleFrame({ className, children, ...rest }: ExampleFrameProps) {
  return (
    <div className={cn(exampleFrameClass, "flex flex-col gap-2", className)} data-example="" {...rest}>
      <div>
        <Chip tone="neutral">{EXAMPLE_TAG}</Chip>
      </div>
      {children}
    </div>
  );
}

/** One example of a group ("Try an example brief"): the chip's label, and the id `onFill` receives. */
export interface ExampleOption {
  id: string;
  label: string;
}

export interface ExampleToggleProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onSelect" | "onToggle" | "defaultValue"> {
  /** Rendered in an `ExampleFrame` under the button while the example is shown. */
  example?: ReactNode;
  /** A render-prop: the caller swaps its own values and frames them (`ExampleFrame` or `exampleFrameClass`). */
  children?: (shown: boolean) => ReactNode;
  /** Uncontrolled start; default hidden. */
  defaultShown?: boolean;
  /** Controlled: whether the example is in. With `options`, use `value` instead. */
  shown?: boolean;
  /** Every change, either way. */
  onToggle?: (shown: boolean) => void;
  /** The example goes in: the owner fills its fields. In a group, called with the chosen option's id. */
  onFill?: (id?: string) => void;
  /** The example goes out: the owner clears what the example filled, and only that. */
  onClear?: () => void;
  showLabel?: string;
  hideLabel?: string;
  /** Several examples as chips under one lead label; a chip fills, pressing the chosen one again clears. */
  options?: readonly ExampleOption[];
  /** The group's lead label. Default "Try an example". */
  label?: string;
  /** Controlled (group): the chosen option's id, or null. */
  value?: string | null;
  /** Uncontrolled start (group). */
  defaultValue?: string | null;
  /** Nothing can be pressed (a form that is busy); what is shown stays shown. */
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function ExampleToggle({
  example,
  children,
  defaultShown = false,
  shown: shownProp,
  onToggle,
  onFill,
  onClear,
  showLabel = "Show me an example",
  hideLabel = "Hide the example",
  options,
  label = "Try an example",
  value: valueProp,
  defaultValue = null,
  disabled = false,
  size = "sm",
  className,
  ...rest
}: ExampleToggleProps) {
  const guided = useGuided();
  const [shownState, setShownState] = useState(defaultShown);
  const [valueState, setValueState] = useState<string | null>(defaultValue);
  const group = options !== undefined;
  const value = valueProp !== undefined ? valueProp : valueState;
  const shown = group ? value !== null : (shownProp ?? shownState);
  if (!guided) return null;

  const toggle = () => {
    const nextShown = !shown;
    if (shownProp === undefined) setShownState(nextShown);
    onToggle?.(nextShown);
    if (nextShown) onFill?.();
    else onClear?.();
  };
  const pick = (id: string) => {
    const next = value === id ? null : id;
    if (valueProp === undefined) setValueState(next);
    onToggle?.(next !== null);
    if (next === null) onClear?.();
    else onFill?.(next);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} data-example-toggle="" data-shown={shown || undefined} {...rest}>
      {group ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
          <span className="t-data mr-1">{label}</span>
          {options.map((o) => (
            <Chip key={o.id} onClick={disabled ? undefined : () => pick(o.id)} selected={value === o.id} data-example-option={o.id}>
              {o.label}
            </Chip>
          ))}
        </div>
      ) : (
        <div>
          <Button variant="ghost" size={size} onClick={toggle} aria-expanded={shown} disabled={disabled}>
            {shown ? hideLabel : showLabel}
          </Button>
        </div>
      )}
      {children ? children(shown) : null}
      {shown && example !== undefined && example !== null ? <ExampleFrame>{example}</ExampleFrame> : null}
    </div>
  );
}
