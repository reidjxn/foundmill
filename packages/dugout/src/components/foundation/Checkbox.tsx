import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

/** 16 px box. `checked="indeterminate"` renders a dash. Space toggles. */
export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-chip border border-subtle bg-panel-alt",
        "transition-colors duration-micro ease-dugout hover:border-secondary/60",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-kit-primary data-[state=checked]:text-kit-on-primary",
        "data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-kit-primary data-[state=indeterminate]:text-kit-on-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="inline-flex">
        {props.checked === "indeterminate" ? <Icon icon={Minus} size={12} strokeWidth={2.5} /> : <Icon icon={Check} size={12} strokeWidth={2.5} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
