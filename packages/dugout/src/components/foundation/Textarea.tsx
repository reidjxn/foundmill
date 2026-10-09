import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { inputBaseClass } from "./Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** A non-blocking warning ring (amber). `invalid` wins over it. */
  tone?: "warn";
  mono?: boolean;
  /** Grow with content (field-sizing: content) instead of a fixed row count. */
  autoGrow?: boolean;
}

/** The same well as Input (DESIGN §8): black at 30 %, a strong hairline, an accent ring and halo on focus, an accent caret. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, tone, mono, autoGrow, rows = 3, ...rest },
  ref,
) {
  const isInvalid = Boolean(invalid || rest["aria-invalid"] === true || rest["aria-invalid"] === "true");
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={isInvalid || undefined}
      data-tone={!isInvalid && tone ? tone : undefined}
      className={cn(inputBaseClass, "block min-h-control-md resize-y px-2.5 py-2", mono && "font-mono text-mono", autoGrow && "field-sizing-content", className)}
      {...rest}
    />
  );
});
