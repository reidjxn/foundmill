"use client";
import { createContext, forwardRef, useContext, useMemo, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { CircleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  function Label({ className, ...props }, ref) {
    return <LabelPrimitive.Root ref={ref} className={cn("t-label block select-none", className)} {...props} />;
  },
);

interface FieldControl {
  htmlFor: string;
  describedBy?: string;
  required: boolean;
  invalid: boolean;
}
const FieldControlContext = createContext<FieldControl | null>(null);

/**
 * What a Field tells the control it labels (WCAG 1.3.1, 3.3.2): the id of its error or hint for aria-describedby,
 * whether it is required and whether it is in error. Input, Textarea and SelectTrigger read it with their own id, so a
 * caller cannot forget the wiring; a control whose id the Field does not label gets nothing.
 */
export function useFieldAria(id: string | undefined): Omit<FieldControl, "htmlFor"> | null {
  const field = useContext(FieldControlContext);
  if (!field || !id || field.htmlFor !== id) return null;
  return { describedBy: field.describedBy, required: field.required, invalid: field.invalid };
}

/** aria-describedby from several sources, each id once, in order. */
export function joinDescribedBy(...ids: Array<string | undefined | null | false>): string | undefined {
  const out: string[] = [];
  for (const group of ids) if (group) for (const id of group.split(/\s+/)) if (id && !out.includes(id)) out.push(id);
  return out.length ? out.join(" ") : undefined;
}

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

/**
 * Label + control + hint/error stack (DESIGN §8): the label in the label style (Inter 500 12, text-2, sentence case),
 * the required mark in the accent, the error with an icon so colour is never the only signal. The control whose id is
 * `htmlFor` (Input, MoneyInput, Textarea, a Select's trigger) gets aria-describedby (the error, else the hint),
 * aria-required and aria-invalid from the Field itself (`useFieldAria`).
 */
export function Field({ htmlFor, label, hint, error, required, className, children }: FieldProps) {
  const hasError = Boolean(error);
  const hasHint = Boolean(hint);
  const control = useMemo<FieldControl>(
    () => ({ htmlFor, describedBy: fieldDescribedBy(htmlFor, { hint: hasHint, error: hasError }), required: Boolean(required), invalid: hasError }),
    [htmlFor, hasHint, hasError, required],
  );
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-invalid={error ? true : undefined}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-accent">
            *
          </span>
        ) : null}
      </Label>
      <FieldControlContext.Provider value={control}>{children}</FieldControlContext.Provider>
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1.5 text-small text-status-bad">
          <Icon icon={CircleAlert} size={13} className="mt-px" />
          <span>{error}</span>
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
