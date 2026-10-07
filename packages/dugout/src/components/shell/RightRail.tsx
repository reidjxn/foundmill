"use client";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
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
  children?: ReactNode;
}

/**
 * The optional 320 px right rail (BUILD §5.3): hover-card details, the agent log, a decision preview.
 * Collapses to a narrow handle so the content grid gets the width back; 200 ms width transition (DESIGN §7).
 */
export const RightRail = forwardRef<HTMLElement, RightRailProps>(function RightRail(
  { title = "Details", open, onOpenChange, actions, hideToggle, className, children, ...rest },
  ref,
) {
  return (
    <aside
      ref={ref}
      aria-label={typeof title === "string" ? title : "Right rail"}
      data-state={open ? "open" : "collapsed"}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-l border-subtle bg-panel transition-[width] duration-panel ease-dugout",
        open ? "w-rail" : "w-8",
        className,
      )}
      {...rest}
    >
      <div className={cn("flex h-panel-header shrink-0 items-center border-b border-subtle bg-panel-alt", open ? "gap-2 pl-panel-pad pr-1" : "justify-center")}>
        {open ? (
          <>
            <h2 className="t-label min-w-0 flex-1 truncate">{title}</h2>
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
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
            className="size-6"
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
            <span aria-hidden className="t-label whitespace-nowrap text-secondary/70" style={{ writingMode: "vertical-rl" }}>
              {title}
            </span>
          ) : null}
        </div>
      )}
    </aside>
  );
});
