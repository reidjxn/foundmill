"use client";
import { forwardRef, useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Keys } from "../foundation/Kbd";
import { Tooltip } from "../foundation/Tooltip";
import { Wordmark } from "../foundation/Wordmark";
import { ShellLink } from "./ShellLink";
import type { SidebarBrand, SidebarItem } from "./types";

/** `data-sidebar-item` value of the brand link (arrow keys reach it like any item while it is drawn). */
export const SIDEBAR_BRAND_ID = "brand";
/** Cap height of the wordmark in the sidebar foot, in px: the DESIGN §8a floor, a little taller than the 9 px caps of the tab-style labels. */
export const SIDEBAR_BRAND_HEIGHT = 12;

export interface SidebarProps extends Omit<HTMLAttributes<HTMLElement>, "onSelect"> {
  items: SidebarItem[];
  activeId?: string;
  /** 232 px open, 64 px collapsed (BUILD §5.3). Persist it through onCollapsedChange. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /**
   * The Foundmill wordmark, last in the foot, left-aligned with the item icons. Drawn only while expanded: collapsed to
   * 64 px the sidebar shows no brand at all (the FM monogram is reserved for the favicon). Omit to draw none.
   */
  brand?: SidebarBrand;
  /** Render the LIVE block. Items with group "live" are hidden in Personal mode. */
  showLive?: boolean;
  /** Fired on click or Enter/Space, in addition to the link's own navigation. */
  onSelect?: (item: SidebarItem) => void;
  /** Hide the collapse toggle (the app owns the control). */
  hideToggle?: boolean;
}

/** Static class maps so Tailwind emits every variant. */
const BADGE_DEPT_CLASS: Record<DeptColourToken, string> = {
  "dept-1": "bg-dept-1 text-ink",
  "dept-2": "bg-dept-2 text-ink",
  "dept-3": "bg-dept-3 text-ink",
  "dept-4": "bg-dept-4 text-ink",
  "dept-5": "bg-dept-5 text-ink",
  "dept-6": "bg-dept-6 text-ink",
  "dept-7": "bg-dept-7 text-ink",
  "dept-8": "bg-dept-8 text-ink",
};
const DOT_DEPT_CLASS: Record<DeptColourToken, string> = {
  "dept-1": "bg-dept-1",
  "dept-2": "bg-dept-2",
  "dept-3": "bg-dept-3",
  "dept-4": "bg-dept-4",
  "dept-5": "bg-dept-5",
  "dept-6": "bg-dept-6",
  "dept-7": "bg-dept-7",
  "dept-8": "bg-dept-8",
};

/** Badge classes for an item (department colour, status-bad for Inbox, neutral otherwise). Exported for tests. */
export function sidebarBadgeClass(item: Pick<SidebarItem, "dept" | "badgeTone">): string {
  if (item.dept) return BADGE_DEPT_CLASS[item.dept];
  if (item.badgeTone === "bad") return "bg-status-bad text-ink";
  return "bg-panel-alt text-primary";
}

/** Index of the item an arrow/Home/End key moves focus to, wrapping. Exported for tests. */
export function nextSidebarIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Accessible name: label plus the badge count. Exported for tests. */
export function sidebarItemName(item: SidebarItem): string {
  if (item.badge && item.badge > 0) return `${item.label}, ${item.badge} ${item.badge === 1 ? "item" : "items"}`;
  return item.label;
}

function Badge({ item, collapsed }: { item: SidebarItem; collapsed: boolean }) {
  if (!item.badge || item.badge <= 0) return null;
  const text = item.badge > 99 ? "99+" : String(item.badge);
  return (
    <span
      aria-hidden
      data-badge
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 font-display text-label font-semibold leading-none tabular-nums",
        sidebarBadgeClass(item),
        collapsed ? "absolute -right-1.5 -top-1.5 ring-2 ring-panel" : "ml-auto",
      )}
    >
      {text}
    </span>
  );
}

/**
 * The sidebar (BUILD §5.3, DESIGN §8): 232 px, 32 px items with a 16 px icon and a tab-style label; the active item has a
 * 3 px kit-primary left edge on bg-panel-alt; badges are 18 px pills in the department colour. Groups: main (Home, Inbox,
 * departments in the founder's order, CRM), a hairline, LIVE items, foot (Settings, Anthropic key, the Foundmill
 * wordmark). Collapsed to 64 px it keeps icons, dots and badges, shows labels as tooltips and drops the wordmark.
 * Arrow keys move focus; Enter or Space activates.
 */
export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { items, activeId, collapsed, onCollapsedChange, brand, showLive = true, onSelect, hideToggle, className, ...rest },
  ref,
) {
  const visible = items.filter((it) => it.group !== "live" || showLive);
  const main = visible.filter((it) => it.group === "main" || it.group === "department");
  const live = visible.filter((it) => it.group === "live");
  const foot = visible.filter((it) => it.group === "foot");
  const ordered = [...main, ...live, ...foot];
  const enabled = ordered.filter((it) => !it.disabled);
  const showBrand = !!brand && !collapsed;
  // Roving focus order: every enabled item, then the wordmark link while it is drawn.
  const focusOrder = [...enabled.map((it) => it.id), ...(showBrand ? [SIDEBAR_BRAND_ID] : [])];
  const focusable = activeId && enabled.some((it) => it.id === activeId) ? activeId : focusOrder[0];
  const refs = useRef(new Map<string, HTMLElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const id = target.getAttribute("data-sidebar-item");
    if (!id) return;
    const pos = focusOrder.indexOf(id);
    const next = nextSidebarIndex(e.key, pos < 0 ? 0 : pos, focusOrder.length);
    if (next === null) return;
    e.preventDefault();
    const nextId = focusOrder[next];
    if (nextId) refs.current.get(nextId)?.focus();
  };

  const renderBrand = (b: SidebarBrand) => {
    const name = b.label ?? APP_NAME;
    return (
      <li key={SIDEBAR_BRAND_ID} className="relative">
        <ShellLink
          ref={(node: HTMLAnchorElement | null) => {
            if (node) refs.current.set(SIDEBAR_BRAND_ID, node);
            else refs.current.delete(SIDEBAR_BRAND_ID);
          }}
          href={b.href}
          aria-label={name}
          tabIndex={SIDEBAR_BRAND_ID === focusable ? 0 : -1}
          data-sidebar-item={SIDEBAR_BRAND_ID}
          className={cn(
            "relative flex h-8 w-full items-center rounded-none pl-3 pr-2 text-primary",
            "transition-colors duration-micro ease-dugout hover:bg-white/4 hover:no-underline",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
          )}
        >
          <Wordmark height={SIDEBAR_BRAND_HEIGHT} label={null} className="animate-fade-in" style={{ animationDelay: "var(--dur-micro)" }} />
        </ShellLink>
      </li>
    );
  };

  const renderItem = (item: SidebarItem) => {
    const active = item.id === activeId;
    const name = sidebarItemName(item);
    const cls = cn(
      "group/item relative flex h-8 w-full items-center gap-2 rounded-none text-secondary",
      "transition-colors duration-micro ease-dugout hover:bg-white/4 hover:text-primary hover:no-underline",
      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
      collapsed ? "justify-center px-0" : "pl-3 pr-2",
      active && "bg-panel-alt text-primary",
      item.disabled && "pointer-events-none opacity-50",
    );
    const inner = (
      <>
        {active ? <span aria-hidden data-active-edge className="absolute inset-y-0 left-0 w-0.75 bg-kit-primary" /> : null}
        <span className="relative inline-flex shrink-0">
          <Icon icon={item.icon} />
          {item.dept ? <span aria-hidden data-dept-dot className={cn("absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-panel", DOT_DEPT_CLASS[item.dept])} /> : null}
          {collapsed ? <Badge item={item} collapsed /> : null}
        </span>
        <span className={cn("t-tab min-w-0 flex-1 truncate text-left", collapsed ? "sr-only" : "animate-fade-in")} style={collapsed ? undefined : { animationDelay: "var(--dur-micro)" }}>
          {item.label}
        </span>
        {collapsed ? null : <Badge item={item} collapsed={false} />}
      </>
    );
    const common = {
      "data-sidebar-item": item.id,
      "data-active": active || undefined,
      "aria-current": active ? ("page" as const) : undefined,
      "aria-label": name,
      "aria-keyshortcuts": item.keys ? item.keys.join(" ") : undefined,
      tabIndex: item.id === focusable ? 0 : -1,
      className: cls,
    };
    const setRef = (node: HTMLElement | null) => {
      if (node) refs.current.set(item.id, node);
      else refs.current.delete(item.id);
    };
    const el = item.href ? (
      <ShellLink ref={setRef} href={item.href} onClick={() => onSelect?.(item)} {...common}>
        {inner}
      </ShellLink>
    ) : (
      <button type="button" ref={setRef} disabled={item.disabled} onClick={() => onSelect?.(item)} {...common}>
        {inner}
      </button>
    );
    const content: ReactNode = collapsed ? (
      <Tooltip
        side="right"
        content={
          <span className="inline-flex items-center gap-2">
            <span>{name}</span>
            {item.keys ? <Keys keys={item.keys} /> : null}
          </span>
        }
      >
        {el}
      </Tooltip>
    ) : (
      el
    );
    return (
      <li key={item.id} className="relative">
        {content}
      </li>
    );
  };

  return (
    <nav
      ref={ref}
      aria-label="Primary"
      data-collapsed={collapsed || undefined}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-subtle bg-panel transition-[width] duration-panel ease-dugout",
        collapsed ? "w-sidebar-collapsed" : "w-sidebar",
        className,
      )}
      onKeyDown={onKeyDown}
      {...rest}
    >
      <ul className="flex flex-col py-2">{main.map(renderItem)}</ul>
      {live.length > 0 ? (
        <>
          <div role="separator" className="mx-3 h-px bg-subtle" />
          <div className={cn("flex items-center", collapsed ? "h-2" : "h-6 px-3")}>
            <span className={cn("t-label", collapsed && "sr-only")}>Live</span>
          </div>
          <ul className="flex flex-col pb-2">{live.map(renderItem)}</ul>
        </>
      ) : null}
      <div className="mt-auto border-t border-subtle">
        <ul className="flex flex-col py-2">
          {foot.map(renderItem)}
          {brand && showBrand ? renderBrand(brand) : null}
        </ul>
        {hideToggle ? null : (
          <div className={cn("flex h-8 items-center pb-2", collapsed ? "justify-center" : "px-2")}>
            <IconButton
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              size="sm"
              variant="ghost"
              aria-expanded={!collapsed}
              onClick={() => onCollapsedChange(!collapsed)}
              data-testid="sidebar-toggle"
            />
          </div>
        )}
      </div>
    </nav>
  );
});
