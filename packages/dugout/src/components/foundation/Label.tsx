import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../../lib/cn";

export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  function Label({ className, ...props }, ref) {
    return <LabelPrimitive.Root ref={ref} className={cn("t-label block select-none", className)} {...props} />;
  },
);

export interface FieldProps {
  /** The control's id; the label points at it. */
  htmlFor: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error stack. Pass `aria-describedby={fieldDescribedBy(id)}` on the control. */
export function Field({ htmlFor, label, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)} data-invalid={error ? true : undefined}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-status-warn">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-small text-status-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-small text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Ids a Field renders for hint and error, for aria-describedby. */
export function fieldDescribedBy(id: string, opts: { hint?: boolean; error?: boolean }): string | undefined {
  const ids = [opts.error ? `${id}-error` : null, opts.hint && !opts.error ? `${id}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}
