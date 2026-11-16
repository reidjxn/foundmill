/**
 * The note over the sideways-scrolling console (founder decision 3, Nov 16, 2026): between 640 and 1279 px the console
 * keeps its 1280 px layout and the window scrolls sideways; this one line says so, once, and goes when dismissed. It
 * sits at the bottom left of the window, over the canvas, never over a control's label: a glass slab like a toast.
 */
import type { HTMLAttributes } from "react";
import { MoveHorizontal, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";

export const NARROW_WINDOW_WORDS = {
  body: "This window is narrower than the console. Scroll sideways to see all of it, or make the window wider.",
  dismiss: "Hide this note",
} as const;

export interface NarrowWindowNoteProps extends HTMLAttributes<HTMLDivElement> {
  onDismiss: () => void;
}

export function NarrowWindowNote({ onDismiss, className, ...rest }: NarrowWindowNoteProps) {
  return (
    <div role="status" data-testid="narrow-window-note" className={cn("surface-popover fixed bottom-4 left-4 z-50 flex max-w-reading items-center gap-2 py-2 pl-3 pr-1.5 text-body text-primary", className)} {...rest}>
      <Icon icon={MoveHorizontal} className="shrink-0 text-tertiary" />
      <span className="min-w-0 flex-1">{NARROW_WINDOW_WORDS.body}</span>
      <IconButton icon={X} label={NARROW_WINDOW_WORDS.dismiss} size="sm" onClick={onDismiss} />
    </div>
  );
}
