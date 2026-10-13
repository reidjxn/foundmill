"use client";
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type FocusEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "../../lib/cn";
import { IconButton } from "../foundation/IconButton";
import { ScrollArea } from "../foundation/ScrollArea";

export interface RightRailProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Label-style title in the rail header. */
  title?: ReactNode;
  /** Open (320 px) or collapsed to a 32 px handle. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Header slot right of the title. */
  actions?: ReactNode;
  /** Hide the collapse handle entirely (the app controls the rail). */
  hideToggle?: boolean;
  /**
   * A rail that opens on a founder's action (a channel's profile): focus moves to its title when it opens, and again
   * when `focusKey` changes (another item shown); when it closes with focus inside, focus goes back to what opened it.
   */
  focusOnOpen?: boolean;
  focusKey?: string;
  /** Esc inside the rail closes it (BUILD §5.5 "Esc = close overlay"). */
  closeOnEscape?: boolean;
  children?: ReactNode;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The optional 320 px right rail (BUILD §5.3, DESIGN §8): hover-card details, the agent log, a decision preview. On the
 * rail colour with a hairline on its inner edge that catches light at the top; a 40 px header on its own surface (the
 * title style, a rule fading out under it). Collapses to a narrow handle so the content grid gets the width back
 * (200 ms width transition).
 */
export const RightRail = forwardRef<HTMLElement, RightRailProps>(function RightRail(
  { title = "Details", open, onOpenChange, actions, hideToggle, focusOnOpen, focusKey, closeOnEscape, className, children, onKeyDown, onFocus, onBlur, ...rest },
  ref,
) {
  const asideRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  // Whether the founder's focus is in the rail. A rail that closes in place unmounts its content first, which drops
  // focus to <body> before the effect below can see it was inside; this remembers it was.
  const focusInside = useRef(false);
  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      asideRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  // Layout effects, so the cleanup still sees focus inside the rail before a closing rail leaves the page.
  useIsoLayoutEffect(() => {
    const rail = asideRef.current;
    if (!open || !focusOnOpen || !rail) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !rail.contains(active)) originRef.current = active;
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      const origin = originRef.current;
      const active = document.activeElement;
      const lost = active === null || active === document.body;
      if ((rail.contains(active) || (focusInside.current && lost)) && origin?.isConnected) origin.focus({ preventScroll: true });
      focusInside.current = false;
    };
  }, [open, focusOnOpen, focusKey]);
  const onRailKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(e);
    if (!closeOnEscape || !open || e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onOpenChange(false);
  };
  return (
    <aside
      ref={setRefs}
      onKeyDown={onRailKeyDown}
      onFocus={(e: FocusEvent<HTMLElement>) => {
        focusInside.current = true;
        onFocus?.(e);
      }}
      onBlur={(e: FocusEvent<HTMLElement>) => {
        // Only a move to somewhere else counts as leaving; focus dropped by a removed control has no new target.
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) focusInside.current = false;
        onBlur?.(e);
      }}
      aria-label={typeof title === "string" ? title : "Right rail"}
      data-state={open ? "open" : "collapsed"}
      data-side="right"
      className={cn("shell-rail flex h-full shrink-0 flex-col overflow-hidden", open ? "w-rail" : "w-control-md", className)}
      {...rest}
    >
      <div className={cn(open ? "panel-head" : "flex h-panel-header shrink-0 items-center justify-center")}>
        {open ? (
          <>
            <h2 ref={headingRef} tabIndex={focusOnOpen ? -1 : undefined} className="t-title min-w-0 flex-auto rounded-xs text-balance text-primary outline-none focus-visible:shadow-ring">
              {title}
            </h2>
            {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
          </>
        ) : null}
        {hideToggle ? null : (
          <IconButton
            icon={open ? PanelRightClose : PanelRightOpen}
            label={open ? "Collapse rail" : "Expand rail"}
            size="sm"
            variant="ghost"
            pressed={undefined}
            aria-expanded={open}
            onClick={() => onOpenChange(!open)}
            className={cn("text-tertiary", open && !actions && "ml-auto")}
          />
        )}
      </div>
      {open ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-panel-pad">{children}</div>
        </ScrollArea>
      ) : (
        <div className="flex flex-1 items-start justify-center pt-3">
          {typeof title === "string" ? (
            <span aria-hidden className="t-label whitespace-nowrap text-tertiary" style={{ writingMode: "vertical-rl" }}>
              {title}
            </span>
          ) : null}
        </div>
      )}
    </aside>
  );
});
