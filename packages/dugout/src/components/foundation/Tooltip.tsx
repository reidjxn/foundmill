"use client";
import { createContext, forwardRef, useContext, type ComponentProps, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/cn";

/** True below a `TooltipProvider`: a `Tooltip` there mounts no provider of its own. */
const HasTooltipProvider = createContext(false);

/**
 * Put one at the app root so tooltips share a delay group (apps/web AppProviders, AppShell). Below it every `Tooltip`
 * uses it instead of mounting its own (perf audit item 7: hundreds of closed triggers on a screen).
 */
export function TooltipProvider(props: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <HasTooltipProvider.Provider value={true}>
      <TooltipPrimitive.Provider {...props} />
    </HasTooltipProvider.Provider>
  );
}
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

/** A label, not a surface: the overlay glass on a 10 px radius, scaling from its trigger as it fades in. */
export const TooltipContent = forwardRef<ElementRef<typeof TooltipPrimitive.Content>, ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(
  function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(
            "surface-overlay overlay-motion z-50 max-w-72 px-2.5 py-1.5 text-small text-primary text-pretty",
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Portal>
    );
  },
);

const DEFAULT_DELAY_MS = 400;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** This tooltip's own delay; default the provider's (400 ms). */
  delayDuration?: number;
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Convenience tooltip: wraps the child (which must accept a ref and props, e.g. a button). Below a `TooltipProvider` it
 * joins that provider's delay group; outside one (a story, a test) it mounts its own so it still works.
 */
export function Tooltip({ content, children, side = "top", align = "center", delayDuration, open, onOpenChange, className }: TooltipProps) {
  const shared = useContext(HasTooltipProvider);
  if (content === null || content === undefined || content === "") return <>{children}</>;
  const root = (
    // A delay given here is this tooltip's own; otherwise the provider's (400 ms in the app) applies.
    <TooltipPrimitive.Root open={open} onOpenChange={onOpenChange} delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
  if (shared) return root;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration ?? DEFAULT_DELAY_MS} skipDelayDuration={300}>
      {root}
    </TooltipPrimitive.Provider>
  );
}
