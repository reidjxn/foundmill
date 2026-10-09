"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "../../lib/cn";

export interface SeparatorProps extends ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  /** 50 % opacity hairline, for table rows. */
  faint?: boolean;
  /**
   * How the hairline ends (DESIGN §3: dividers inside panels fade out, never hard full-width rules): "end" (default)
   * fades out towards its end, "both" fades at both ends, "none" is a solid hairline (tables, tight grids).
   */
  fade?: "end" | "both" | "none";
}

/** A 1 px hairline in the `line` token that fades out. */
export const Separator = forwardRef<ElementRef<typeof SeparatorPrimitive.Root>, SeparatorProps>(function Separator(
  { className, orientation = "horizontal", decorative = true, faint, fade = "end", ...props },
  ref,
) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      data-fade={fade}
      className={cn(
        "shrink-0",
        fade === "end" ? "hairline-fade" : fade === "both" ? "hairline-fade-both" : "bg-line",
        faint && "opacity-50",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
});
