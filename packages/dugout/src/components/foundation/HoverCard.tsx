"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { cn } from "../../lib/cn";

/** DESIGN §7: 300 ms delay, then fade + 4 px rise over 160 ms. */
export const HOVER_CARD_OPEN_DELAY = 300;
export const HOVER_CARD_CLOSE_DELAY = 120;

export type HoverCardProps = ComponentPropsWithoutRef<typeof HoverCardPrimitive.Root>;

export function HoverCard({ openDelay = HOVER_CARD_OPEN_DELAY, closeDelay = HOVER_CARD_CLOSE_DELAY, ...props }: HoverCardProps) {
  return <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props} />;
}

export const HoverCardTrigger = HoverCardPrimitive.Trigger;
export const HoverCardPortal = HoverCardPrimitive.Portal;

export const HoverCardContent = forwardRef<ElementRef<typeof HoverCardPrimitive.Content>, ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>>(
  function HoverCardContent({ className, align = "start", sideOffset = 6, collisionPadding = 8, ...props }, ref) {
    return (
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cn(
            "surface-overlay z-50 w-80 p-3 text-body text-primary outline-none",
            "data-[state=open]:animate-rise-in data-[state=closed]:animate-fade-out",
            className,
          )}
          {...props}
        />
      </HoverCardPrimitive.Portal>
    );
  },
);
