"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

/** Backdrop per DESIGN §3: rgba(15,19,24,0.72) with a 2 px blur. */
export const DialogOverlay = forwardRef<ElementRef<typeof DialogPrimitive.Overlay>, ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  function DialogOverlay({ className, ...props }, ref) {
    return (
      <DialogPrimitive.Overlay
        ref={ref}
        className={cn("fixed inset-0 z-50 bg-backdrop backdrop-blur-dialog data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out", className)}
        {...props}
      />
    );
  },
);

export type DialogSize = "sm" | "md" | "lg" | "xl";
const SIZE: Record<DialogSize, string> = { sm: "w-96", md: "w-128", lg: "w-176", xl: "w-240" };

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: DialogSize;
  /** Hide the top-right close button (keep Esc and your own buttons). */
  hideClose?: boolean;
}

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(function DialogContent(
  { className, children, size = "md", hideClose, ...props },
  ref,
) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "surface-overlay fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-4rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden",
          "flex flex-col text-body text-primary outline-none",
          "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          SIZE[size],
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-chip text-secondary hover:bg-white/6 hover:text-primary"
          >
            <Icon icon={X} size="inline" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

/** 32 px raised header with the title in display-sm and a hairline underneath. */
export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-panel-header flex-col gap-0.5 border-b border-subtle bg-panel-alt px-3 py-2", className)} {...props} />;
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto bg-panel p-3", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-subtle bg-panel-alt px-3 py-2", className)} {...props} />;
}

export const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function DialogTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn("t-display-sm text-primary", className)} {...props} />;
  },
);

export const DialogDescription = forwardRef<ElementRef<typeof DialogPrimitive.Description>, ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  function DialogDescription({ className, ...props }, ref) {
    return <DialogPrimitive.Description ref={ref} className={cn("text-small text-secondary", className)} {...props} />;
  },
);
