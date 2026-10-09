"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Ellipsis } from "lucide-react";
import { cn } from "../../lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { Icon } from "../foundation/Icon";
import { ShellLink } from "./ShellLink";
import type { TabItem } from "./types";

export const TAB_COUNT_MIN = 3;
export const TAB_COUNT_MAX = 7;
/** The gap between tabs, in px (matches `gap-1` at the 13 px root closely enough for the overflow sum; measured anyway). */
const TAB_GAP_FALLBACK = 4;

export interface TabBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  tabs: TabItem[];
  activeId: string;
  /** Active sub-view of the active tab, if any. */
  activeSubViewId?: string;
  /** Fired for the tab and, when chosen from the caret menu, the sub-view. Links also navigate through ShellLink. */
  onChange?: (tabId: string, subViewId?: string) => void;
  /** Right-aligned slot (saved-view selector, edit-layout button). */
  trailing?: ReactNode;
  "aria-label"?: string;
}

/** Index of the next tab for an arrow/Home/End key, wrapping. Exported for tests. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * How many tabs fit, in order, in `available` px when each takes `widths[i]` and they sit `gap` apart; when they do not
 * all fit, room is kept for the "More" trigger (`moreWidth`). Always at least one. Pure; exported for tests.
 */
export function visibleTabCount(widths: readonly number[], available: number, gap: number, moreWidth: number): number {
  const n = widths.length;
  if (n === 0 || available <= 0) return n;
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, n - 1);
  if (total <= available) return n;
  let used = moreWidth;
  let count = 0;
  for (const w of widths) {
    const next = used + w + gap;
    if (next > available) break;
    used = next;
    count++;
  }
  return Math.max(1, count);
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The 40 px tab bar (BUILD §5.3, DESIGN §8): transparent over the lit canvas with a hairline under it; 3–7 tabs in the
 * action style, sentence case, text-3 → text-1. The active tab is marked by a 2 px text-1 bar with a soft white glow that
 * **slides** to the new tab in 260 ms (ease-inout; instant under reduced motion). Counts sit in a pill (a red one with
 * ink text when `badgeTone="bad"`). Tabs with sub-views show a 12 px caret that opens a dropdown. Tabs never shrink
 * below their label: when they do not fit beside the trailing slot, the last ones move into a "More" menu (which takes
 * the active tab's name and the bar when the active tab is one of them). Arrow keys move focus (manual activation),
 * Enter opens.
 */
export function TabBar({ tabs, activeId, activeSubViewId, onChange, trailing, className, "aria-label": ariaLabel = "Screen tabs", ...rest }: TabBarProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef<Array<HTMLElement | null>>([]);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [visible, setVisible] = useState(tabs.length);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  const shown = Math.min(visible, tabs.length);
  const overflow = tabs.slice(shown);
  const activeIndex = tabs.findIndex((t) => t.id === activeId);
  const activeInMore = activeIndex >= shown && activeIndex >= 0;
  const activeTab = activeIndex >= 0 ? tabs[activeIndex] : undefined;
  const enabled = tabs.map((t, i) => (t.disabled || i >= shown ? -1 : i)).filter((i) => i >= 0);

  const measure = useCallback(() => {
    const area = areaRef.current;
    const list = listRef.current;
    if (!area || !list) return;
    const widths = tabs.map((_, i) => cellRefs.current[i]?.offsetWidth ?? 0);
    const gap = Number.parseFloat(getComputedStyle(list).columnGap) || TAB_GAP_FALLBACK;
    const moreWidth = (moreRef.current?.offsetWidth ?? 0) || 72;
    const next = visibleTabCount(widths, area.clientWidth, gap, moreWidth + gap);
    setVisible((v) => (v === next ? v : next));
    // The bar: under the active tab, or under "More" when the active tab lives in its menu.
    const target = activeInMore ? moreRef.current : activeIndex >= 0 ? tabRefs.current[activeIndex] : null;
    if (!target || target.offsetWidth === 0) {
      setIndicator(null);
      return;
    }
    const inset = Number.parseFloat(getComputedStyle(target).paddingLeft) || 0;
    const x = target.offsetLeft + inset;
    const w = Math.max(0, target.offsetWidth - inset * 2);
    setIndicator((cur) => (cur && cur.x === x && cur.w === w ? cur : { x, w }));
  }, [tabs, activeIndex, activeInMore]);

  // Measure before paint, on every change that moves a tab or the bar.
  useIsoLayoutEffect(() => {
    measure();
  }, [measure, activeSubViewId, shown]);

  // Re-measure when the bar's room changes (window, rail, trailing slot) and once the web fonts have loaded.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(area);
    let alive = true;
    void document.fonts?.ready.then(() => alive && measure());
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [measure]);

  // The first placement is instant; from then on the bar slides.
  useEffect(() => {
    if (!indicator || animate) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [indicator, animate]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const index = tabRefs.current.findIndex((el) => el === target);
    if (index < 0) return;
    const pos = enabled.indexOf(index);
    const nextPos = nextTabIndex(e.key, pos < 0 ? 0 : pos, enabled.length);
    if (nextPos === null) return;
    e.preventDefault();
    const nextIndex = enabled[nextPos];
    if (nextIndex !== undefined) tabRefs.current[nextIndex]?.focus();
  };

  const indicatorStyle = indicator ? ({ "--indicator-x": `${indicator.x}px`, "--indicator-w": `${indicator.w}px`, transition: animate ? undefined : "none" } as CSSProperties) : undefined;

  return (
    <div className={cn("tabbar", className)} data-testid="tab-bar" {...rest}>
      <div ref={areaRef} className="flex min-w-0 flex-1 items-stretch">
        <div
          ref={listRef}
          role="tablist"
          aria-label={ariaLabel}
          aria-orientation="horizontal"
          className="relative flex min-w-0 items-stretch gap-1"
          data-indicator-ready={indicator ? "" : undefined}
          onKeyDown={onKeyDown}
        >
          {tabs.map((tab, i) => {
            const active = tab.id === activeId;
            const hidden = i >= shown;
            const activeSub = active ? tab.subViews?.find((s) => s.id === activeSubViewId) : undefined;
            const inner = (
              <>
                <span>{tab.label}</span>
                {activeSub ? <span className="t-small text-secondary">· {activeSub.label}</span> : null}
                {tab.badge ? (
                  <span className="tab-count" data-tone={tab.badgeTone === "bad" ? "bad" : undefined} aria-label={`${tab.badge} items`}>
                    {tab.badge}
                  </span>
                ) : null}
                {active ? <span aria-hidden data-tab-bar /> : null}
              </>
            );
            const common = {
              role: "tab",
              id: `tab-${tab.id}`,
              "aria-selected": active,
              "aria-current": active ? ("page" as const) : undefined,
              tabIndex: active && !hidden ? 0 : -1,
              className: "shell-tab",
              "data-active": active || undefined,
            };
            const setRef = (node: HTMLElement | null) => void (tabRefs.current[i] = node);
            const el = tab.href ? (
              <ShellLink ref={setRef} href={tab.href} onClick={() => onChange?.(tab.id)} {...common}>
                {inner}
              </ShellLink>
            ) : (
              <button type="button" ref={setRef} disabled={tab.disabled} onClick={() => onChange?.(tab.id)} {...common}>
                {inner}
              </button>
            );
            return (
              <div
                key={tab.id}
                ref={(node) => void (cellRefs.current[i] = node)}
                className={cn("flex shrink-0 items-stretch", hidden && "invisible absolute left-0 top-0 h-full")}
                aria-hidden={hidden || undefined}
                data-tab-overflow={hidden || undefined}
              >
                {el}
                {tab.subViews && tab.subViews.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${tab.label} views`}
                        disabled={tab.disabled}
                        tabIndex={hidden ? -1 : undefined}
                        className={cn(
                          "-ml-1.5 inline-flex w-5 items-center justify-center rounded-xs text-tertiary outline-none transition-colors duration-hover ease-out hover:text-primary",
                          "focus-visible:shadow-ring data-[state=open]:text-primary",
                        )}
                      >
                        <Icon icon={ChevronDown} size={12} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuRadioGroup value={active ? activeSubViewId : undefined} onValueChange={(v) => onChange?.(tab.id, v)}>
                        {tab.subViews.map((sub) =>
                          sub.href ? (
                            <DropdownMenuRadioItem key={sub.id} value={sub.id} asChild>
                              <ShellLink href={sub.href}>{sub.label}</ShellLink>
                            </DropdownMenuRadioItem>
                          ) : (
                            <DropdownMenuRadioItem key={sub.id} value={sub.id}>
                              {sub.label}
                            </DropdownMenuRadioItem>
                          ),
                        )}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            );
          })}
          {overflow.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button ref={moreRef} type="button" className="shell-tab" data-active={activeInMore || undefined} data-tab-more aria-label={activeInMore && activeTab ? `More tabs, ${activeTab.label} selected` : "More tabs"}>
                  {activeInMore && activeTab ? <span>{activeTab.label}</span> : <Icon icon={Ellipsis} />}
                  <span>{activeInMore ? null : "More"}</span>
                  <Icon icon={ChevronDown} size={12} />
                  {activeInMore ? <span aria-hidden data-tab-bar /> : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {overflow.map((tab) =>
                  tab.href ? (
                    <DropdownMenuItem key={tab.id} asChild disabled={tab.disabled} data-active={tab.id === activeId || undefined}>
                      <ShellLink href={tab.href} onClick={() => onChange?.(tab.id)}>
                        {tab.label}
                        {tab.badge ? <span className="tab-count ml-auto" data-tone={tab.badgeTone === "bad" ? "bad" : undefined}>{tab.badge}</span> : null}
                      </ShellLink>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem key={tab.id} disabled={tab.disabled} onSelect={() => onChange?.(tab.id)} data-active={tab.id === activeId || undefined}>
                      {tab.label}
                      {tab.badge ? <span className="tab-count ml-auto" data-tone={tab.badgeTone === "bad" ? "bad" : undefined}>{tab.badge}</span> : null}
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // Measured even when every tab fits, so the overflow sum always knows the trigger's width.
            <button ref={moreRef} type="button" tabIndex={-1} aria-hidden className="shell-tab invisible absolute left-0 top-0">
              <Icon icon={Ellipsis} />
              <span>More</span>
              <Icon icon={ChevronDown} size={12} />
            </button>
          )}
          {indicator ? <span aria-hidden className="slide-indicator" style={indicatorStyle} data-tab-indicator /> : null}
        </div>
      </div>
      {trailing ? <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">{trailing}</div> : null}
    </div>
  );
}
