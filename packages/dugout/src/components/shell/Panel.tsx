import { forwardRef, useId, type HTMLAttributes, type ReactNode } from "react";
import { EllipsisVertical, Pin, Replace, Settings2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { EmptyState, type EmptyStateProps } from "../foundation/EmptyState";
import { ErrorState } from "../foundation/ErrorState";
import { Icon, type IconComponent } from "../foundation/Icon";
import { SkeletonText } from "../foundation/Skeleton";
import { spanClass } from "./PageGrid";
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
  /** Header slot between the title and the caret (chips, a small button). */
  actions?: ReactNode;
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

function isEmptyStateProps(v: unknown): v is Omit<EmptyStateProps, "children"> & { children: ReactNode } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "children" in v && !("$$typeof" in v);
}

/**
 * The panel (DESIGN §3, §8): bg-panel, hairline, 4 px radius, inner highlight, no shadow. 32 px raised header with the
 * title in label style and a caret menu (swap content, settings, Pin to Home). Loading, empty and error states replace
 * the body; an optional footer sits under it.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { title, span, menu, actions, loading, empty, error, onRetry, footer, flush, bodyClassName, className, children, ...rest },
  ref,
) {
  const titleId = useId();
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
      className={cn("surface-panel flex min-w-0 flex-col overflow-hidden", span !== undefined && spanClass(span), className)}
      {...rest}
    >
      <header className="flex h-panel-header shrink-0 items-center gap-2 border-b border-subtle bg-panel-alt pl-panel-pad pr-1">
        <h2 id={titleId} className="t-label min-w-0 flex-1 truncate">
          {title}
        </h2>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Panel menu"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-chip text-secondary outline-none hover:bg-white/6 hover:text-primary focus-visible:outline-2 focus-visible:outline-link data-[state=open]:bg-white/6 data-[state=open]:text-primary"
              >
                <Icon icon={EllipsisVertical} size="inline" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu?.onSwap ? (
                <DropdownMenuItem onSelect={menu.onSwap}>
                  <Icon icon={Replace} size="inline" className="text-secondary" />
                  Swap content
                </DropdownMenuItem>
              ) : null}
              {menu?.onSettings ? (
                <DropdownMenuItem onSelect={menu.onSettings}>
                  <Icon icon={Settings2} size="inline" className="text-secondary" />
                  Settings
                </DropdownMenuItem>
              ) : null}
              {menu?.onPinToHome ? (
                <DropdownMenuItem onSelect={menu.onPinToHome}>
                  <Icon icon={Pin} size="inline" className="text-secondary" />
                  {menu.pinned ? "Unpin from Home" : "Pin to Home"}
                </DropdownMenuItem>
              ) : null}
              {menu?.items && menu.items.length > 0 ? (
                <>
                  {menu.onSwap || menu.onSettings || menu.onPinToHome ? <DropdownMenuSeparator /> : null}
                  {menu.items.map((item) => (
                    <DropdownMenuItem key={item.id} onSelect={item.onSelect} variant={item.variant} disabled={item.disabled}>
                      {item.icon ? <Icon icon={item.icon} size="inline" className="text-secondary" /> : null}
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <div className={cn("min-h-0 flex-1", !flush && state === "ready" && "p-panel-pad", bodyClassName)} data-panel-body>
        {body}
      </div>
      {footer ? <footer className="flex shrink-0 items-center gap-2 border-t border-subtle px-panel-pad py-1.5 text-small text-secondary">{footer}</footer> : null}
    </section>
  );
});
