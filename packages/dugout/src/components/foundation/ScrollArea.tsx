"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../../lib/cn";

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  orientation?: "vertical" | "horizontal" | "both";
  viewportClassName?: string;
}

/** Radix scroll area with Dugout's 6 px scrollbars (thumb hairline, track transparent). */
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
      <ScrollAreaPrimitive.Scrollbar
        ref={ref}
        orientation={orientation}
        className={cn(
          "flex touch-none select-none transition-opacity duration-micro ease-dugout",
          orientation === "vertical" ? "h-full w-1.5" : "h-1.5 flex-col",
          className,
        )}
        {...props}
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-subtle" />
      </ScrollAreaPrimitive.Scrollbar>
    );
  },
);
