"use client";
import { forwardRef, useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import { FitText } from "../foundation/FitText";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Keys } from "../foundation/Kbd";
import { Tooltip } from "../foundation/Tooltip";
import { Wordmark } from "../foundation/Wordmark";
import { ShellLink } from "./ShellLink";
import type { SidebarBrand, SidebarItem } from "./types";

/** `data-sidebar-item` value of the brand link (arrow keys reach it like any item while it is drawn). */
export const SIDEBAR_BRAND_ID = "brand";
/** Cap height of the wordmark in the sidebar foot, in px: the DESIGN §8a floor. */
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

/** Static class maps so Tailwind emits every variant: the tone the dot, the badge and their glows read. */
const DEPT_TONE: Record<DeptColourToken, string> = {
  "dept-1": "tone-dept-1",
  "dept-2": "tone-dept-2",
  "dept-3": "tone-dept-3",
  "dept-4": "tone-dept-4",
  "dept-5": "tone-dept-5",
  "dept-6": "tone-dept-6",
  "dept-7": "tone-dept-7",
  "dept-8": "tone-dept-8",
};

/**
 * The badge's tone class for an item: the department colour, status-bad for the Inbox (items that need a response),
 * nothing for a neutral badge (a surface-3 plate). Exported for tests.
 */
export function sidebarBadgeClass(item: Pick<SidebarItem, "dept" | "badgeTone">): string {
  if (item.dept) return DEPT_TONE[item.dept];
  if (item.badgeTone === "bad") return "tone-status-bad";
  return "";
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
  const tone = sidebarBadgeClass(item);
  return (
    <span aria-hidden data-badge data-tone={tone ? undefined : "neutral"} data-collapsed={collapsed || undefined} className={cn("sidebar-badge", tone, !collapsed && "ml-auto")}>
      {text}
    </span>
  );
}

/**
 * The sidebar (BUILD §5.3, DESIGN §8): 232 px on the rail, its inner hairline catching light at the top. Items are
 * 32 px, 10 px in from the edges, sentence case: a 16 px icon in text-3 and an action-style label in text-2; hover adds a
 * 3.5 % plate. The active item takes a brand plate with a kit-lift ring and icon, and a lit 3 px edge with its glow at
 * the rail's edge. Department icons carry a small dot in their colour; badges are 18 px glowing pills in the department
 * colour. Groups: main (Home, Inbox, departments in the founder's order, CRM), a fading hairline, LIVE items, foot
 * (Settings, Anthropic key, the Foundmill wordmark). A long founder-defined label wraps to two lines and steps down to
 * fit, never silently clipped (its full text in a tooltip only as the last resort). Collapsed to 64 px it keeps icons,
 * dots and badges, shows labels and chords as tooltips and drops the wordmark. Arrow keys move focus; Enter or Space
 * activates.
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
      <ShellLink
        ref={(node: HTMLAnchorElement | null) => {
          if (node) refs.current.set(SIDEBAR_BRAND_ID, node);
          else refs.current.delete(SIDEBAR_BRAND_ID);
        }}
        href={b.href}
        aria-label={name}
        tabIndex={SIDEBAR_BRAND_ID === focusable ? 0 : -1}
        data-sidebar-item={SIDEBAR_BRAND_ID}
        className="sidebar-item min-w-0 flex-1 text-primary hover:text-primary"
      >
        <Wordmark height={SIDEBAR_BRAND_HEIGHT} label={null} className="animate-fade-in" style={{ animationDelay: "var(--dur-micro)" }} />
      </ShellLink>
    );
  };

  const renderItem = (item: SidebarItem) => {
    const active = item.id === activeId;
    const name = sidebarItemName(item);
    const inner = (
      <>
        {active ? <span aria-hidden data-active-edge className="sidebar-edge" /> : null}
        <span className="relative inline-flex shrink-0" data-sidebar-icon>
          <Icon icon={item.icon} />
          {item.dept ? <span aria-hidden data-dept-dot className={cn("sidebar-dot", DEPT_TONE[item.dept])} /> : null}
          {collapsed ? <Badge item={item} collapsed /> : null}
        </span>
        {collapsed ? (
          <span className="sr-only">{item.label}</span>
        ) : (
          <FitText lines={2} className="min-w-0 flex-1 animate-fade-in text-left" style={{ animationDelay: "var(--dur-micro)" }} data-sidebar-label>
            {item.label}
          </FitText>
        )}
        {collapsed ? null : <Badge item={item} collapsed={false} />}
      </>
    );
    const common = {
      "data-sidebar-item": item.id,
      "data-active": active || undefined,
      "data-collapsed": collapsed || undefined,
      "aria-current": active ? ("page" as const) : undefined,
      "aria-label": name,
      "aria-keyshortcuts": item.keys ? item.keys.join(" ") : undefined,
      "aria-disabled": item.disabled || undefined,
      tabIndex: item.id === focusable ? 0 : -1,
      className: "sidebar-item",
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
      className={cn("shell-rail flex h-full shrink-0 flex-col overflow-hidden", collapsed ? "w-sidebar-collapsed" : "w-sidebar", className)}
      onKeyDown={onKeyDown}
      {...rest}
    >
      <ul className="flex flex-col gap-0.5 pb-2 pt-3">{main.map(renderItem)}</ul>
      {live.length > 0 ? (
        <>
          <div role="separator" className="rail-rule" />
          <div className={cn("flex items-center", collapsed ? "h-2" : "h-control-xs px-5")}>
            <span className={cn("t-data", collapsed && "sr-only")}>Live</span>
          </div>
          <ul className="flex flex-col gap-0.5 pb-2">{live.map(renderItem)}</ul>
        </>
      ) : null}
      <div className="mt-auto flex flex-col pb-2">
        <div role="separator" className="rail-rule mt-0" />
        <ul className="flex flex-col gap-0.5 pb-1">{foot.map(renderItem)}</ul>
        {showBrand || !hideToggle ? (
          <div className={cn("flex items-center", collapsed ? "justify-center" : "pr-2.5")}>
            {brand && showBrand ? renderBrand(brand) : null}
            {hideToggle ? null : (
              <IconButton
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                size="sm"
                variant="ghost"
                aria-expanded={!collapsed}
                onClick={() => onCollapsedChange(!collapsed)}
                className={cn("text-tertiary", !showBrand && !collapsed && "ml-auto")}
                data-testid="sidebar-toggle"
              />
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
});
