"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";
import { FocusOrigin, useReturnFocus } from "./ReturnFocus";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

/** Backdrop (DESIGN §3): the canvas at 66 % over a 6 px blur, fading with the dialog. */
export const DialogOverlay = forwardRef<ElementRef<typeof DialogPrimitive.Overlay>, ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  function DialogOverlay({ className, ...props }, ref) {
    return <DialogPrimitive.Overlay ref={ref} className={cn("backdrop-motion fixed inset-0 z-50 bg-backdrop backdrop-blur-dialog", className)} {...props} />;
  },
);

export type DialogSize = "sm" | "md" | "lg" | "xl";
const SIZE: Record<DialogSize, string> = { sm: "w-96", md: "w-128", lg: "w-176", xl: "w-240" };

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: DialogSize;
  /** Hide the top-right close button (keep Esc and your own buttons). */
  hideClose?: boolean;
}

/**
 * The dialog surface (DESIGN §3, §7): glass on r-lg with elev-3, centred, scaling .98 → 1 from its centre as it fades in
 * (200 ms). The close button sits in the top-right corner; DialogHeader keeps its title clear of it. On close, focus
 * goes back to whatever had it when the dialog opened (`useReturnFocus`), so openers need no `<DialogTrigger>`.
 */
export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(function DialogContent(
  { className, children, size = "md", hideClose, onCloseAutoFocus, ...props },
  ref,
) {
  const returnFocus = useReturnFocus(onCloseAutoFocus);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        className={cn(
          "surface-dialog overlay-motion fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-4rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden",
          "flex flex-col text-body text-primary outline-none",
          SIZE[size],
          className,
        )}
        {...props}
      >
        <FocusOrigin origin={returnFocus.origin} />
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            data-dialog-close
            className={cn(
              "absolute right-3 top-3 inline-flex size-control-sm items-center justify-center rounded-sm text-tertiary",
              "transition-colors duration-hover ease-out hover:bg-white/8 hover:text-primary focus-ring",
            )}
          >
            <Icon icon={X} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

/**
 * The title block on the dialog's own glass (no band). Its first line (the title) keeps 29 px clear on the right, so a
 * long or wrapping title never runs under the close button; the description below it uses the full width.
 */
export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-dialog-header className={cn("flex min-h-panel-header flex-col gap-1 px-gutter pb-2 pt-gutter [&>:first-child]:pr-9", className)} {...props} />;
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-gutter py-3", className)} {...props} />;
}

/** Actions, right-aligned on a darker strip under a hairline. */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-line-faint bg-black/15 px-gutter py-3", className)} {...props} />;
}

export const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function DialogTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn("t-display-sm text-balance text-primary", className)} {...props} />;
  },
);

export const DialogDescription = forwardRef<ElementRef<typeof DialogPrimitive.Description>, ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  function DialogDescription({ className, ...props }, ref) {
    return <DialogPrimitive.Description ref={ref} className={cn("text-small text-pretty text-secondary", className)} {...props} />;
  },
);
