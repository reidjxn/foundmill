import { forwardRef, useId, type HTMLAttributes, type ReactNode } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { EmptyState, type EmptyStateProps } from "../foundation/EmptyState";
import { ErrorState } from "../foundation/ErrorState";
import type { IconComponent } from "../foundation/Icon";
import { SkeletonText } from "../foundation/Skeleton";
import { InfoTip } from "../guidance/InfoTip";
import { spanClass } from "./PageGrid";
import { PanelMenuButton } from "./PanelMenuButton";
import type { GridSpan } from "./types";

export interface PanelMenuItem {
  id: string;
  label: string;
  icon?: IconComponent;
  onSelect: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
}

export interface PanelMenu {
  /** "Swap content" — replace this panel's widget. */
  onSwap?: () => void;
  /** "Settings" — the widget's settings sheet. */
  onSettings?: () => void;
  /** "Pin to Home" — every panel's caret menu offers it (BUILD §11.2). */
  onPinToHome?: () => void;
  /** Already pinned: the item reads "Unpin from Home". */
  pinned?: boolean;
  /** Extra items after a separator. */
  items?: PanelMenuItem[];
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  /** Columns on the 12-column grid (BUILD §5.3). Omit when the panel is not on a PageGrid. */
  span?: GridSpan;
  /** Caret menu on the right of the header. Omitted → no caret. */
  menu?: PanelMenu;
  /** Header slot between the title and the caret (chips, a small button). Wraps under the title before it squeezes it. */
  actions?: ReactNode;
  /** Mono meta after the title, in text-3 ("6 Aug – 8 Nov 2026", "4 of 5 done"). */
  meta?: ReactNode;
  /**
   * One sentence about the panel, as an InfoTip after the meta (UX plan §6.2): a 14 px Info button named "About
   * <title>" with a tooltip. Hidden when guidance is off, since the panel's own content is the information.
   */
  help?: ReactNode;
  /** A "Learn more" target for `help` (a route slug or URL): the tip becomes a definition card with a reachable link. */
  helpLearn?: string;
  /**
   * Light inside the panel from its lit corner (DESIGN §3): a department colour (department cards, the note's metric
   * strip, the agent thread) or "brand" (the Journey, the brief). The corner of the edge takes the colour too.
   */
  glow?: DeptColourToken | "brand";
  /** Shows a skeleton body (never a spinner inside a panel, DESIGN §7). */
  loading?: boolean;
  /** Empty state: a line of text or full EmptyState props. Shown instead of children. */
  empty?: ReactNode | (Omit<EmptyStateProps, "children"> & { children: ReactNode });
  /** Error state: a line of text, shown as a status-bad pill + line. */
  error?: ReactNode;
  onRetry?: () => void;
  /** Small-style footer (provenance, "Updated 2 min ago"). */
  footer?: ReactNode;
  /** Remove the 12 px body padding (tables, charts that bleed). */
  flush?: boolean;
  /** Body min height so tiles align while loading. */
  bodyClassName?: string;
  children?: ReactNode;
}

/** Static class map so Tailwind emits every tone. */
const GLOW_CLASS: Record<DeptColourToken | "brand", string> = {
  brand: "glow-brand edge-tint",
  "dept-1": "glow-dept edge-tint tone-dept-1",
  "dept-2": "glow-dept edge-tint tone-dept-2",
  "dept-3": "glow-dept edge-tint tone-dept-3",
  "dept-4": "glow-dept edge-tint tone-dept-4",
  "dept-5": "glow-dept edge-tint tone-dept-5",
  "dept-6": "glow-dept edge-tint tone-dept-6",
  "dept-7": "glow-dept edge-tint tone-dept-7",
  "dept-8": "glow-dept edge-tint tone-dept-8",
};

function isEmptyStateProps(v: unknown): v is Omit<EmptyStateProps, "children"> & { children: ReactNode } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "children" in v && !("$$typeof" in v);
}

/**
 * The panel (DESIGN §3, §8): a machined plate — surface 1, 10 px radius, a 1 px gradient edge that catches light at
 * the top left and bottom right, a faint top light, elev-1 — optionally lit from its corner by a department or the
 * brand (`glow`). The 40 px header sits on the panel's own surface (no band): the title in Inter 600 sentence case,
 * optional mono meta, an optional help tip, then the actions and a ghost "…" menu (swap content, settings, Pin to
 * Home), with a rule under it that fades out to the right. The title is never clipped: the actions wrap under it first,
 * and a long title wraps. Loading, empty and error states replace the body; an optional footer sits under it.
 * Server-safe (no hooks but useId): the menu is a client piece whose Radix code loads only when a panel has one
 * (PanelMenuButton), and the help tip is the guidance group's client InfoTip.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { title, span, menu, actions, meta, help, helpLearn, glow, loading, empty, error, onRetry, footer, flush, bodyClassName, className, children, ...rest },
  ref,
) {
  const titleId = useId();
  const helpLabel = typeof title === "string" || typeof title === "number" ? String(title) : "this panel";
  const hasMenu = !!menu && (menu.onSwap || menu.onSettings || menu.onPinToHome || (menu.items && menu.items.length > 0));
  const state = loading ? "loading" : error ? "error" : empty !== undefined && empty !== null && empty !== false ? "empty" : "ready";

  let body: ReactNode;
  if (state === "loading") body = <SkeletonText lines={4} className="p-panel-pad" />;
  else if (state === "error")
    body = (
      <ErrorState onRetry={onRetry} className="py-6">
        {error}
      </ErrorState>
    );
  else if (state === "empty") body = isEmptyStateProps(empty) ? <EmptyState {...empty} className={cn("py-6", empty.className)} /> : <EmptyState className="py-6">{empty as ReactNode}</EmptyState>;
  else body = children;

  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={loading || undefined}
      data-state={state}
      data-span={span}
      data-glow={glow}
      className={cn("surface-panel flex min-w-0 flex-col overflow-hidden", glow && GLOW_CLASS[glow], span !== undefined && spanClass(span), className)}
      {...rest}
    >
      <header className="panel-head" data-panel-header>
        <div className="flex min-w-0 flex-auto items-baseline gap-2">
          <h2 id={titleId} className="t-title min-w-0 text-balance text-primary">
            {title}
          </h2>
          {meta ? <span className="t-mono shrink-0 text-tertiary">{meta}</span> : null}
          {help ? (
            <InfoTip label={helpLabel} learn={helpLearn} className="-my-1 self-center">
              {help}
            </InfoTip>
          ) : null}
        </div>
        {actions || hasMenu ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {actions}
            {menu && hasMenu ? <PanelMenuButton menu={menu} /> : null}
          </div>
        ) : null}
      </header>
      <div className={cn("min-h-0 flex-1", !flush && state === "ready" && "p-panel-pad", bodyClassName)} data-panel-body>
        {body}
      </div>
      {footer ? <footer className="panel-foot flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-panel-pad py-2 text-small text-tertiary">{footer}</footer> : null}
    </section>
  );
});
