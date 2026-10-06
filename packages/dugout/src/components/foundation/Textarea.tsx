import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { inputBaseClass } from "./Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
  /** Grow with content (field-sizing: content) instead of a fixed row count. */
  autoGrow?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, mono, autoGrow, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || rest["aria-invalid"] || undefined}
      className={cn(inputBaseClass, "min-h-control-md resize-y px-2 py-1.5", mono && "font-mono text-mono", autoGrow && "field-sizing-content", className)}
      {...rest}
    />
  );
});
