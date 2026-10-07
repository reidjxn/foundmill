"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../lib/cn";

export interface SliderProps extends ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Accessible name for each thumb (one per value). */
  thumbLabels?: string[];
  /** Fill colour of the range; default kit-primary. */
  tone?: "kit" | "good" | "warn" | "bad" | "info" | "gold";
}

const RANGE_TONE: Record<NonNullable<SliderProps["tone"]>, string> = {
  kit: "bg-kit-primary",
  good: "bg-status-good",
  warn: "bg-status-warn",
  bad: "bg-status-bad",
  info: "bg-status-info",
  gold: "bg-gold",
};

/** 4 px track, 12 px thumb. Arrow keys step, Shift+Arrow steps ×10, Home/End jump. */
export const Slider = forwardRef<ElementRef<typeof SliderPrimitive.Root>, SliderProps>(function Slider(
  { className, thumbLabels, tone = "kit", value, defaultValue, ...props },
  ref,
) {
  const count = (value ?? defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      className={cn("relative flex h-4 w-full touch-none select-none items-center data-disabled:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-panel-alt">
        <SliderPrimitive.Range className={cn("absolute h-full", RANGE_TONE[tone])} />
      </SliderPrimitive.Track>
      {Array.from({ length: count }, (_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={thumbLabels?.[i]}
          className={cn(
            "block size-3 rounded-full border border-subtle bg-primary shadow-sm",
            "transition-transform duration-micro ease-dugout hover:scale-110 focus-visible:scale-110 disabled:pointer-events-none",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
