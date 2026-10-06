import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: "sm" | "md";
}

/** 28×16 (sm) or 36×20 (md) track; on = kit-primary. Space toggles; label it with <Label htmlFor>. */
export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(function Switch({ className, size = "md", ...props }, ref) {
  const sm = size === "sm";
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-subtle bg-panel-alt p-0.5",
        "transition-colors duration-micro ease-dugout",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-kit-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sm ? "h-4 w-7" : "h-5 w-9",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-secondary shadow-sm transition-transform duration-micro ease-dugout",
          "data-[state=checked]:bg-kit-on-primary",
          sm ? "size-2.5 data-[state=checked]:translate-x-3" : "size-3.5 data-[state=checked]:translate-x-4",
        )}
      />
    </SwitchPrimitive.Root>
  );
});
