"use client";
import { forwardRef, useCallback, useId, useRef, type InputHTMLAttributes, type PointerEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

/**
 * The field look (DESIGN §8), for elements that are their own field (Textarea): a well — black at 30 % over the panel,
 * a strong hairline ring and an inset shadow — that lights with an accent ring and halo on focus, an accent caret, a
 * warning or invalid ring (`field-well`, controls.css).
 */
export const inputBaseClass = cn(
  "field-well w-full min-w-0 rounded-sm text-primary text-body",
  "placeholder:text-tertiary focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/**
 * The field: the well, its radius and its focus light live on the wrapper, and everything inside it (icon, prefix,
 * the text, suffix, trailing control) sits in the normal flow with its own width. An adornment can therefore never
 * overlap what is typed, whatever its length ("GBP", "/ month", a Kbd hint, a clear button).
 */
export const inputFieldClass = cn(
  "field-well flex w-full min-w-0 items-center overflow-hidden rounded-sm text-primary text-body",
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
);

/** Field heights: sm 28, md 32 (toolbars, beside 32 px buttons), lg 36 (forms), xl 46 (MoneyInput, form selects). */
export type InputSize = "sm" | "md" | "lg" | "xl";
export const INPUT_HEIGHT: Record<InputSize, string> = {
  sm: "h-control-sm",
  md: "h-control-md",
  lg: "h-field",
  xl: "h-field-lg rounded-track",
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  /** Height: md 32 px (default), sm 28, lg 36 (form fields), xl 46 (MoneyInput, form selects). */
  controlSize?: InputSize;
  invalid?: boolean;
  /** A non-blocking warning ring (amber), e.g. an instruction that reads like a secret. `invalid` wins over it. */
  tone?: "warn";
  /** Leading Lucide icon (e.g. Search). */
  icon?: IconComponent;
  /** Text before the value, in text-3: "£", "https://". */
  prefix?: ReactNode;
  /** Text after the value: a currency code ("GBP"), a unit ("%", "/ month", "hours"). */
  suffix?: ReactNode;
  /** "text" (default): the suffix in text-2 inside the value's flow. "segment": its own plate behind a hairline. */
  suffixVariant?: "text" | "segment";
  /** Trailing control: a Kbd hint, a clear button. */
  trailing?: ReactNode;
  /** JetBrains Mono for ids, keys, amounts. */
  mono?: boolean;
  /** Right-align with tabular digits. */
  numeric?: boolean;
  /** Classes for the field (the wrapper): width, margins. `className` styles the text element. */
  wrapperClassName?: string;
  /** Classes for the prefix (MoneyInput sets its symbol in Barlow). */
  prefixClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    controlSize = "md",
    invalid,
    tone,
    icon,
    prefix,
    suffix,
    suffixVariant = "text",
    trailing,
    mono,
    numeric,
    wrapperClassName,
    prefixClassName,
    disabled,
    "aria-describedby": describedBy,
    ...rest
  },
  ref,
) {
  const isInvalid = Boolean(invalid || rest["aria-invalid"] === true || rest["aria-invalid"] === "true");
  const lead = Boolean(icon || prefix);
  const segment = Boolean(suffix) && suffixVariant === "segment";
  const tail = Boolean(suffix || trailing);
  const roomy = controlSize === "xl";
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
      className={cn(inputFieldClass, INPUT_HEIGHT[controlSize], wrapperClassName)}
      data-input-wrapper
      data-size={controlSize}
      data-invalid={isInvalid || undefined}
      data-tone={!isInvalid && tone ? tone : undefined}
      data-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
    >
      {icon ? (
        <span className={cn("pointer-events-none inline-flex shrink-0 text-tertiary", roomy ? "pl-3" : "pl-2.5")}>
          <Icon icon={icon} size="inline" />
        </span>
      ) : null}
      {prefix ? (
        <span
          className={cn("pointer-events-none shrink-0 select-none whitespace-nowrap text-tertiary", icon ? "pl-1.5" : roomy ? "pl-3.5" : "pl-2.5", prefixClassName)}
          data-input-prefix
        >
          {prefix}
        </span>
      ) : null}
      <input
        ref={setRefs}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        aria-describedby={[describedBy, suffix ? suffixId : undefined].filter(Boolean).join(" ") || undefined}
        className={cn(
          "h-full w-full min-w-0 flex-1 border-0 bg-transparent text-primary placeholder:text-tertiary focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed",
          lead ? "pl-1.5" : roomy ? "pl-3.5" : "pl-2.5",
          segment ? "pr-2.5" : tail ? "pr-1.5" : roomy ? "pr-3.5" : "pr-2.5",
          mono && "font-mono text-mono",
          numeric && "text-right tabular-nums",
          className,
        )}
        {...rest}
      />
      {suffix ? (
        <span
          id={suffixId}
          className={cn(
            "pointer-events-none shrink-0 select-none whitespace-nowrap tabular-nums",
            segment ? "field-affix" : cn("text-secondary", trailing ? "pr-1" : "pr-2.5"),
          )}
          data-input-suffix
          data-variant={suffixVariant}
        >
          {suffix}
        </span>
      ) : null}
      {trailing ? <span className="inline-flex shrink-0 items-center pr-1.5 text-secondary">{trailing}</span> : null}
    </div>
  );
});
