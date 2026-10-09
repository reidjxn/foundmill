"use client";
import { forwardRef, useCallback, useMemo, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import type { BusinessMode, GameMode, Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { TooltipProvider } from "../foundation/Tooltip";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette, type CommandPaletteProps } from "./CommandPalette";
import { continueButtonAction, type ContinueHandlers } from "./ContinueButton";
import { KeyboardHelp } from "./KeyboardHelp";
import { KitBar, kitStyle, type KitBarNav } from "./KitBar";
import { NeedsLargerWindow } from "./NeedsLargerWindow";
import { ProcessingStrip } from "./ProcessingStrip";
import { RightRail } from "./RightRail";
import { Sidebar } from "./Sidebar";
import type { StopAllAgentsProps } from "./StopAllAgents";
import { TabBar, type TabBarProps } from "./TabBar";
import { departmentLetters, RESERVED_SECTION_LETTERS, useKeyboardMap, type GoToTarget, type KeyboardMapContext } from "./keyboard";
import type { BreadcrumbItem, ContinueState, Kit, ProcessingSegment, SidebarBrand, SidebarItem } from "./types";
import { isViewportTooSmall, MIN_VIEWPORT_WIDTH, useViewportWidth } from "./useViewportWidth";

export interface AppShellSidebar {
  items: SidebarItem[];
  activeId?: string;
  collapsed: boolean;
  /** Persist the collapsed state (per user, per business). */
  onCollapsedChange: (collapsed: boolean) => void;
  /** The Foundmill wordmark at the foot of the expanded sidebar (nothing when collapsed). Omit to draw none. */
  brand?: SidebarBrand;
}

export interface AppShellContinue extends ContinueHandlers {
  state: ContinueState;
  /** Change to fire the single 600 ms pulse (DESIGN §7). */
  pulseKey?: string | number;
  disabled?: boolean;
}

export interface AppShellProcessing {
  segments: ProcessingSegment[];
  /** A business cycle is running. */
  active: boolean;
}

export interface AppShellRightRail {
  title?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: ReactNode;
  children: ReactNode;
}

export type AppShellSearch = Omit<CommandPaletteProps, "open" | "onOpenChange"> & {
  /** Controlled open state; the shell keeps its own when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export interface AppShellKeyboard extends Omit<KeyboardMapContext, "departments" | "onContinue" | "onSearch" | "onHelp" | "onEscape" | "onGoTo"> {
  /** Override the default G-chord navigation (which calls `onNavigate` with the matching sidebar item). */
  onGoTo?: (target: GoToTarget, item: SidebarItem | undefined) => void;
  onEscape?: () => void;
}

export interface AppShellProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** LIVE or Personal (BUILD §5.4). Personal hides the LIVE sidebar block. */
  mode: GameMode;
  businessMode: BusinessMode;
  kit: Kit;
  /** The business's logo as a data URL (`business.logo.get`); absent or null draws the initials mark. */
  logoSrc?: string | null;
  /** A ready element instead of `logoSrc`. */
  logo?: ReactNode;
  businessName: string;
  screenTitle: ReactNode;
  sidebar: AppShellSidebar;
  /** Sidebar click, G chords and the logo button land here (apps call their router). */
  onNavigate?: (item: SidebarItem) => void;
  nav?: KitBarNav;
  continueButton: AppShellContinue;
  stopAll: StopAllAgentsProps;
  processing: AppShellProcessing;
  tabs?: TabBarProps;
  breadcrumbs?: BreadcrumbItem[];
  rightRail?: AppShellRightRail;
  /** Universal search. Without it the search trigger calls `keyboard.onSearch`‐style fallbacks only. */
  search?: AppShellSearch;
  /** Fallback when `search` is absent: the app opens its own search. */
  onSearch?: () => void;
  /** Today, runway and cash for the kit bar chip. */
  date: Date | string | number;
  runwayMonths: number | null | undefined;
  cash?: Money;
  runwayEstimate?: boolean;
  onRunwayClick?: () => void;
  onModeClick?: () => void;
  /** BUILD §5.5 callbacks. Space, G chords, / and ⌘K, ? and Esc are wired by the shell itself. */
  keyboard?: AppShellKeyboard;
  /** Measured width; defaults to the window's. Below 1280 px only NeedsLargerWindow renders. */
  viewportWidth?: number;
  /** Minimum width (default 1280). */
  minViewportWidth?: number;
  children?: ReactNode;
}

/** Sidebar items with their chords filled in: fixed surfaces from `fixed`, departments from `departmentLetters`. Exported for tests. */
export function withSidebarKeys(items: readonly SidebarItem[]): SidebarItem[] {
  const departments = items.filter((it) => it.group === "department").map((it) => ({ id: it.id, name: it.label }));
  const letters = departmentLetters(departments);
  const fixedLetter = (fixed: NonNullable<SidebarItem["fixed"]>) => Object.entries(RESERVED_SECTION_LETTERS).find(([, v]) => v === fixed)?.[0];
  return items.map((it) => {
    if (it.keys) return it;
    if (it.fixed) {
      const l = fixedLetter(it.fixed);
      return l ? { ...it, keys: ["G", l] } : it;
    }
    if (it.group === "department") {
      const l = letters.get(it.id);
      return l ? { ...it, keys: ["G", l] } : it;
    }
    return it;
  });
}

/** The sidebar item a G chord targets. Exported for tests. */
export function sidebarItemForTarget(items: readonly SidebarItem[], target: GoToTarget): SidebarItem | undefined {
  if (target.kind === "department") return items.find((it) => it.group === "department" && it.id === target.id);
  return items.find((it) => it.fixed === target.kind);
}

/**
 * The AppShell (BUILD §5.3, DESIGN §8): sidebar left, kit bar top, processing strip under it, tab bar, content grid,
 * optional right rail. Nothing floats. Applies the business kit as CSS variables on its root, binds the keyboard map,
 * hosts the command palette and the keyboard help, and renders NeedsLargerWindow below the minimum width.
 */
export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(function AppShell(
  {
    mode,
    businessMode,
    kit,
    logoSrc,
    logo,
    businessName,
    screenTitle,
    sidebar,
    onNavigate,
    nav,
    continueButton,
    stopAll,
    processing,
    tabs,
    breadcrumbs,
    rightRail,
    search,
    onSearch,
    date,
    runwayMonths,
    cash,
    runwayEstimate,
    onRunwayClick,
    onModeClick,
    keyboard,
    viewportWidth,
    minViewportWidth = MIN_VIEWPORT_WIDTH,
    className,
    style,
    children,
    ...rest
  },
  ref,
) {
  const measured = useViewportWidth();
  const width = viewportWidth ?? measured;
  const tooSmall = isViewportTooSmall(width, minViewportWidth);

  const items = useMemo(() => withSidebarKeys(sidebar.items), [sidebar.items]);
  const departments = useMemo(() => items.filter((it) => it.group === "department").map((it) => ({ id: it.id, name: it.label })), [items]);

  const [searchOpenState, setSearchOpenState] = useState(false);
  const searchOpen = search?.open ?? searchOpenState;
  const setSearchOpen = useCallback(
    (open: boolean) => {
      if (search?.open === undefined) setSearchOpenState(open);
      search?.onOpenChange?.(open);
    },
    [search],
  );
  const [helpOpen, setHelpOpen] = useState(false);

  const { state, pulseKey, disabled: continueDisabled, ...continueHandlers } = continueButton;
  const continueAction = continueButtonAction(state, continueHandlers);

  const openSearch = useCallback(() => {
    if (search) setSearchOpen(true);
    else onSearch?.();
  }, [search, setSearchOpen, onSearch]);

  const goTo = useCallback(
    (target: GoToTarget) => {
      const item = sidebarItemForTarget(items, target);
      if (keyboard?.onGoTo) keyboard.onGoTo(target, item);
      else if (item) onNavigate?.(item);
    },
    [items, keyboard, onNavigate],
  );

  const { chordPending, cancelChord } = useKeyboardMap({
    enabled: keyboard?.enabled ?? true,
    departments,
    onContinue: continueAction && !continueDisabled ? continueAction : undefined,
    onRefreshInbox: keyboard?.onRefreshInbox,
    onGoTo: goTo,
    onSearch: openSearch,
    onNextInboxItem: keyboard?.onNextInboxItem,
    onPrevInboxItem: keyboard?.onPrevInboxItem,
    onChooseOption: keyboard?.onChooseOption,
    onEditLayout: keyboard?.onEditLayout,
    onHelp: () => setHelpOpen(true),
    onEscape: () => {
      if (searchOpen) setSearchOpen(false);
      else if (helpOpen) setHelpOpen(false);
      else keyboard?.onEscape?.();
    },
  });

  if (tooSmall) return <NeedsLargerWindow width={width} minWidth={minViewportWidth} />;

  const homeItem = items.find((it) => it.fixed === "home");
  const rootStyle: CSSProperties = { ...kitStyle(kit), ...style };

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={300}>
      <div
        ref={ref}
        data-testid="app-shell"
        data-game-mode={mode}
        data-chord-pending={chordPending || undefined}
        className={cn("flex h-screen w-full min-w-(--min-viewport) overflow-hidden bg-base text-primary", className)}
        style={rootStyle}
        {...rest}
      >
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-panel focus:bg-panel-alt focus:px-2 focus:py-1">
          Skip to content
        </a>
        <Sidebar
          items={items}
          activeId={sidebar.activeId}
          collapsed={sidebar.collapsed}
          onCollapsedChange={sidebar.onCollapsedChange}
          brand={sidebar.brand}
          showLive={mode === "live"}
          onSelect={(item) => {
            cancelChord();
            onNavigate?.(item);
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <KitBar
            kit={kit}
            logoSrc={logoSrc}
            logo={logo}
            businessName={businessName}
            screenTitle={screenTitle}
            nav={nav}
            onSearch={openSearch}
            date={date}
            runwayMonths={runwayMonths}
            cash={cash}
            runwayEstimate={runwayEstimate}
            onRunwayClick={onRunwayClick}
            businessMode={businessMode}
            onModeClick={onModeClick}
            gameMode={mode}
            continueButton={{ state, pulseKey, disabled: continueDisabled, ...continueHandlers }}
            stopAll={stopAll}
            onHome={homeItem && onNavigate ? () => onNavigate(homeItem) : undefined}
          />
          <ProcessingStrip segments={processing.segments} active={processing.active} />
          {tabs ? <TabBar {...tabs} /> : null}
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <div className="flex h-7 shrink-0 items-center border-b border-subtle bg-panel px-gutter">
              <Breadcrumbs items={breadcrumbs} />
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1">
            <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-auto outline-none" data-testid="shell-content">
              {children}
            </main>
            {rightRail ? (
              <RightRail title={rightRail.title} open={rightRail.open} onOpenChange={rightRail.onOpenChange} actions={rightRail.actions}>
                {rightRail.children}
              </RightRail>
            ) : null}
          </div>
        </div>
        {search ? <CommandPalette {...search} open={searchOpen} onOpenChange={setSearchOpen} /> : null}
        <KeyboardHelp open={helpOpen} onOpenChange={setHelpOpen} departments={departments} />
      </div>
    </TooltipProvider>
  );
});
