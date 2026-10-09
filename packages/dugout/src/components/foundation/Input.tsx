"use client";
import { forwardRef, useCallback, useId, useRef, type InputHTMLAttributes, type PointerEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

/** The bordered control look, for elements that are their own field (Textarea). Input draws it on its wrapper. */
export const inputBaseClass = cn(
  "w-full min-w-0 bg-panel-alt text-primary text-body rounded-panel border border-subtle",
  "placeholder:text-secondary transition-colors duration-micro ease-dugout",
  "hover:border-secondary/50 focus:border-link focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-status-bad aria-invalid:focus:border-status-bad",
);

/**
 * The field: background, border, radius and focus state live on the wrapper, and everything inside it (icon, prefix,
 * the text, suffix, trailing control) sits in the normal flow with its own width. An adornment can therefore never
 * overlap what is typed, whatever its length ("GBP", "/ month", a Kbd hint, a clear button).
 */
export const inputFieldClass = cn(
  "flex w-full min-w-0 items-center overflow-hidden bg-panel-alt text-primary text-body rounded-panel border border-subtle",
  "transition-colors duration-micro ease-dugout hover:border-secondary/50 focus-within:border-link",
  "data-[tone=warn]:border-status-warn data-[tone=warn]:focus-within:border-status-warn",
  "data-[invalid]:border-status-bad data-[invalid]:focus-within:border-status-bad",
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
);

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  /** Height: md 32 px (default), sm 28 px. */
  controlSize?: "sm" | "md";
  invalid?: boolean;
  /** A non-blocking warning border (amber), e.g. an instruction that reads like a secret. `invalid` wins over it. */
  tone?: "warn";
  /** Leading Lucide icon (e.g. Search). */
  icon?: IconComponent;
  /** Text before the value, in the secondary colour: "£", "https://". */
  prefix?: ReactNode;
  /** Text after the value, in the secondary colour: a currency code ("GBP"), a unit ("%", "/ month", "hours"). */
  suffix?: ReactNode;
  /** Trailing control: a Kbd hint, a clear button. */
  trailing?: ReactNode;
  /** JetBrains Mono for ids, keys, amounts. */
  mono?: boolean;
  /** Right-align with tabular digits. */
  numeric?: boolean;
  /** Classes for the field (the bordered wrapper): width, margins. `className` styles the text element. */
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, controlSize = "md", invalid, tone, icon, prefix, suffix, trailing, mono, numeric, wrapperClassName, disabled, "aria-describedby": describedBy, ...rest },
  ref,
) {
  const h = controlSize === "sm" ? "h-control-sm" : "h-control-md";
  const isInvalid = Boolean(invalid || rest["aria-invalid"] === true || rest["aria-invalid"] === "true");
  const lead = Boolean(icon || prefix);
  const tail = Boolean(suffix || trailing);
  const suffixId = useId();
  const inner = useRef<HTMLInputElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      inner.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  // A press on the icon, prefix or suffix focuses the field, as a press on the border of a plain input would.
  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target === inner.current || target.closest("button, a, [role=button]")) return;
    e.preventDefault();
    inner.current?.focus();
  }, []);
  // The wrapper is always rendered so toggling `icon` or `trailing` (a clear button that appears once there is text)
  // never remounts the <input> and drops focus or the caret. It is full-width and shrinkable, so it behaves like the
  // bare input did inside both block and flex parents.
  return (
    <div
      className={cn(inputFieldClass, h, wrapperClassName)}
      data-input-wrapper
      data-invalid={isInvalid || undefined}
      data-tone={!isInvalid && tone ? tone : undefined}
      data-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
    >
      {icon ? (
        <span className="pointer-events-none inline-flex shrink-0 pl-2.5 text-secondary">
          <Icon icon={icon} size="inline" />
        </span>
      ) : null}
      {prefix ? (
        <span className={cn("pointer-events-none shrink-0 select-none whitespace-nowrap text-secondary", icon ? "pl-1.5" : "pl-2.5")} data-input-prefix>
          {prefix}
        </span>
      ) : null}
      <input
        ref={setRefs}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        aria-describedby={[describedBy, suffix ? suffixId : undefined].filter(Boolean).join(" ") || undefined}
        className={cn(
          "h-full w-full min-w-0 flex-1 border-0 bg-transparent text-primary placeholder:text-secondary focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed",
          lead ? "pl-1.5" : "pl-2.5",
          tail ? "pr-1.5" : "pr-2.5",
          mono && "font-mono text-mono",
          numeric && "text-right tabular-nums",
          className,
        )}
        {...rest}
      />
      {suffix ? (
        <span id={suffixId} className={cn("pointer-events-none shrink-0 select-none whitespace-nowrap text-secondary tabular-nums", trailing ? "pr-1" : "pr-2.5")} data-input-suffix>
          {suffix}
        </span>
      ) : null}
      {trailing ? <span className="inline-flex shrink-0 items-center pr-1.5 text-secondary">{trailing}</span> : null}
    </div>
  );
});
