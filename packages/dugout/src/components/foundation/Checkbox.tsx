"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

/**
 * 16 px box (DESIGN §8): a well with a visible 1.5 px ring at rest; checked is the accent with an ink mark and a soft
 * glow, so shape and colour both carry the state. `checked="indeterminate"` renders a dash. Space toggles.
 */
export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "check-box peer inline-grid size-check shrink-0 place-items-center rounded-xs",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="inline-flex animate-pop">
        {props.checked === "indeterminate" ? <Icon icon={Minus} size={12} strokeWidth={2.75} /> : <Icon icon={Check} size={12} strokeWidth={2.75} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
