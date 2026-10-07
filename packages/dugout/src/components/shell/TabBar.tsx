import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { Icon } from "../foundation/Icon";
import { ShellLink } from "./ShellLink";
import type { TabItem } from "./types";

export const TAB_COUNT_MIN = 3;
export const TAB_COUNT_MAX = 7;

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
 * The 40 px tab bar (BUILD §5.3, DESIGN §8): 3–7 tabs in tab style, active tab underlined 2 px in text-primary,
 * tabs with sub-views show a 12 px caret that opens a dropdown. Arrow keys move focus (manual activation), Enter opens.
 */
export function TabBar({ tabs, activeId, activeSubViewId, onChange, trailing, className, "aria-label": ariaLabel = "Screen tabs", ...rest }: TabBarProps) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const index = refs.current.findIndex((el) => el === target);
    if (index < 0) return;
    const pos = enabled.indexOf(index);
    const nextPos = nextTabIndex(e.key, pos < 0 ? 0 : pos, enabled.length);
    if (nextPos === null) return;
    e.preventDefault();
    const nextIndex = enabled[nextPos];
    if (nextIndex !== undefined) refs.current[nextIndex]?.focus();
  };

  return (
    <div className={cn("flex h-tabbar w-full items-stretch border-b border-subtle bg-panel px-2", className)} data-testid="tab-bar" {...rest}>
      <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" className="flex min-w-0 items-stretch gap-1" onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          const activeSub = active ? tab.subViews?.find((s) => s.id === activeSubViewId) : undefined;
          const tabClass = cn(
            "relative inline-flex h-full items-center gap-1.5 px-2 t-tab text-secondary outline-none transition-colors duration-micro ease-dugout",
            "hover:text-primary hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
            active && "text-primary",
            tab.disabled && "pointer-events-none opacity-50",
          );
          const inner = (
            <>
              {active ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
              <span>{tab.label}</span>
              {activeSub ? <span className="t-small normal-case tracking-normal text-secondary">· {activeSub.label}</span> : null}
              {tab.badge ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-panel-alt px-1 font-mono text-label leading-none text-primary tabular-nums" aria-label={`${tab.badge} items`}>
                  {tab.badge}
                </span>
              ) : null}
            </>
          );
          const common = {
            role: "tab",
            id: `tab-${tab.id}`,
            "aria-selected": active,
            "aria-current": active ? ("page" as const) : undefined,
            tabIndex: active ? 0 : -1,
            className: tabClass,
            "data-active": active || undefined,
          };
          const el = tab.href ? (
            <ShellLink ref={(node) => void (refs.current[i] = node)} href={tab.href} onClick={() => onChange?.(tab.id)} {...common}>
              {inner}
            </ShellLink>
          ) : (
            <button type="button" ref={(node) => void (refs.current[i] = node)} disabled={tab.disabled} onClick={() => onChange?.(tab.id)} {...common}>
              {inner}
            </button>
          );
          return (
            <div key={tab.id} className="flex items-stretch">
              {el}
              {tab.subViews && tab.subViews.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${tab.label} views`}
                      disabled={tab.disabled}
                      className={cn(
                        "-ml-1 inline-flex w-5 items-center justify-center rounded-chip text-secondary outline-none hover:text-primary",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link data-[state=open]:text-primary",
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
      </div>
      {trailing ? <div className="ml-auto flex items-center gap-2 pl-2">{trailing}</div> : null}
    </div>
  );
}
