"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../lib/cn";

export interface SliderProps extends ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Accessible name for each thumb (one per value). */
  thumbLabels?: string[];
  /** What a screen reader hears for each thumb's value ("1:24"), on the thumb, where aria-valuetext is allowed. */
  thumbValueText?: string[];
  /** Colour of the range and the thumb's halo; default the brand lifted for dark (kit-lift). */
  tone?: "kit" | "good" | "warn" | "bad" | "info" | "gold";
}

const TONE: Record<NonNullable<SliderProps["tone"]>, string> = {
  kit: "tone-kit-lift",
  good: "tone-status-good",
  warn: "tone-status-warn",
  bad: "tone-status-bad",
  info: "tone-status-info",
  gold: "tone-gold",
};

/**
 * A 4 px well track with the range in its tone, a 16 px pearl thumb with a tone halo that springs on hover and drag
 * (DESIGN §8). Arrow keys step, Shift+Arrow steps ×10, Home/End jump. For 1–20 skill ratings use SkillSlider.
 */
export const Slider = forwardRef<ElementRef<typeof SliderPrimitive.Root>, SliderProps>(function Slider(
  { className, thumbLabels, thumbValueText, tone = "kit", value, defaultValue, ...props },
  ref,
) {
  const count = (value ?? defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      className={cn("relative flex h-slider-thumb w-full touch-none select-none items-center data-disabled:opacity-50", TONE[tone], className)}
      {...props}
    >
      <SliderPrimitive.Track className="slider-track">
        <SliderPrimitive.Range className="slider-range" />
      </SliderPrimitive.Track>
      {Array.from({ length: count }, (_, i) => (
        <SliderPrimitive.Thumb key={i} aria-label={thumbLabels?.[i]} aria-valuetext={thumbValueText?.[i]} className="slider-thumb cursor-grab active:cursor-grabbing disabled:pointer-events-none" />
      ))}
    </SliderPrimitive.Root>
  );
});
