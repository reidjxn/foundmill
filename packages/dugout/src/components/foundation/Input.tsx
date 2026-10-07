import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

export const inputBaseClass = cn(
  "w-full min-w-0 bg-panel-alt text-primary text-body rounded-panel border border-subtle",
  "placeholder:text-secondary transition-colors duration-micro ease-dugout",
  "hover:border-secondary/50 focus:border-link focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-status-bad aria-invalid:focus:border-status-bad",
);

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Height: md 32 px (default), sm 28 px. */
  controlSize?: "sm" | "md";
  invalid?: boolean;
  /** Leading Lucide icon (e.g. Search). */
  icon?: IconComponent;
  /** Trailing slot: a Kbd, a unit, a clear button. */
  trailing?: ReactNode;
  /** JetBrains Mono for ids, keys, amounts. */
  mono?: boolean;
  /** Right-align with tabular digits. */
  numeric?: boolean;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, controlSize = "md", invalid, icon, trailing, mono, numeric, wrapperClassName, ...rest },
  ref,
) {
  const h = controlSize === "sm" ? "h-control-sm" : "h-control-md";
  // The wrapper is always rendered so toggling `icon` or `trailing` (a clear button that appears once there is text)
  // never remounts the <input> and drops focus or the caret. It is full-width and shrinkable, so it behaves like the
  // bare input did inside both block and flex parents.
  return (
    <div className={cn("relative flex w-full min-w-0 items-center", wrapperClassName)} data-input-wrapper>
      {icon ? (
        <span className="pointer-events-none absolute left-2 inline-flex text-secondary">
          <Icon icon={icon} size="inline" />
        </span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || rest["aria-invalid"] || undefined}
        className={cn(
          inputBaseClass,
          h,
          icon ? "pl-7" : "pl-2",
          trailing ? "pr-8" : "pr-2",
          mono && "font-mono text-mono",
          numeric && "text-right tabular-nums",
          className,
        )}
        {...rest}
      />
      {trailing ? <span className="absolute right-2 inline-flex items-center text-secondary">{trailing}</span> : null}
    </div>
  );
});
