"use client";
/**
 * AdultCheck: the one "I am 18 or older" box, wherever a person confirms it (CLAUDE.md: 18 or older for the whole
 * product, confirmed once at sign-up). The founder profile that creates an account, the one step a person from before
 * sees once, and an invitation's Accept all use it, so the words and the control are the same everywhere. Controlled:
 * the caller holds `checked` and sends the confirmation with its own action.
 *
 * Works from 390 px: the label is part of the tap target (the whole row is at least 44 px tall), and the hint wraps.
 * `error` shows under the row in the danger tone and is announced with it (`aria-describedby`).
 */
import { CircleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Checkbox } from "../foundation/Checkbox";
import { Icon } from "../foundation/Icon";
import { Label } from "../foundation/Label";

/** The words of the box itself: the age, named, nothing else. */
export const ADULT_CHECK_LABEL = "I am 18 or older";

export interface AdultCheckProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** A line under the box ("You confirm this once."); none by default. */
  hint?: ReactNode;
  /** Why the action did not go ahead (the box was not ticked); shown under the row. */
  error?: ReactNode;
  disabled?: boolean;
  /** The checkbox id; one is made when absent. */
  id?: string;
  className?: string;
  "data-testid"?: string;
}

export function AdultCheck({ checked, onCheckedChange, hint, error, disabled = false, id, className, "data-testid": testId = "adult-check" }: AdultCheckProps) {
  const made = useId();
  const boxId = id ?? `adult-check-${made}`;
  const hintId = hint ? `${boxId}-hint` : undefined;
  const errorId = error ? `${boxId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid={testId}>
      <div className="flex min-h-tap items-center gap-2">
        <Checkbox id={boxId} checked={checked} disabled={disabled} onCheckedChange={(v) => onCheckedChange(v === true)} aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
        <Label htmlFor={boxId} className="flex min-h-tap flex-1 items-center normal-case tracking-normal text-body text-primary">
          {ADULT_CHECK_LABEL}
        </Label>
      </div>
      {hint ? (
        <p id={hintId} className="text-small text-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-small text-status-bad">
          <Icon icon={CircleAlert} size={13} className="mt-px" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
