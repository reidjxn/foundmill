"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: "sm" | "md";
}

/**
 * 28×16 (sm) or 36×20 (md) track (DESIGN §8): a well when off, the accent with a glow when on; the pearl thumb springs
 * across. Space toggles; label it with <Label htmlFor>.
 */
export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(function Switch({ className, size = "md", ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      data-size={size}
      className={cn("switch-track peer inline-flex shrink-0 cursor-pointer items-center", "disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
});
