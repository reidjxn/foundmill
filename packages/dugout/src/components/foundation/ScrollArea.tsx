"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../../lib/cn";

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  orientation?: "vertical" | "horizontal" | "both";
  viewportClassName?: string;
}

/** Radix scroll area with Dugout's 6 px rails: they fade in on hover or scroll; the thumb brightens under the pointer. */
export const ScrollArea = forwardRef<ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(function ScrollArea(
  { className, children, orientation = "vertical", viewportClassName, type = "hover", ...props },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root ref={ref} type={type} className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport className={cn("size-full rounded-[inherit] [&>div]:!block", viewportClassName)}>{children}</ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== "vertical" ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});

export const ScrollBar = forwardRef<ElementRef<typeof ScrollAreaPrimitive.Scrollbar>, ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>>(
  function ScrollBar({ className, orientation = "vertical", ...props }, ref) {
    return (
      <ScrollAreaPrimitive.Scrollbar ref={ref} orientation={orientation} className={cn("scroll-rail", className)} {...props}>
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-pill bg-white/14 transition-colors duration-hover ease-out hover:bg-white/26 active:bg-white/32" />
      </ScrollAreaPrimitive.Scrollbar>
    );
  },
);
