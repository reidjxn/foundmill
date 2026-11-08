"use client";
import { forwardRef, useCallback, useEffect, useMemo, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import type { BusinessMode, GameMode, Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { FitText } from "../foundation/FitText";
import { useToastPlacement } from "../foundation/Toast";
import { TooltipProvider } from "../foundation/Tooltip";
import { useGuided } from "../guidance/GuidanceProvider";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette, KEYBOARD_SHORTCUTS_HELP_ITEM, type CommandPaletteProps, type PaletteItem } from "./CommandPalette";
import { continueButtonAction, type ContinueHandlers } from "./ContinueButton";
import { KeyboardHelp } from "./KeyboardHelp";
import type { ConnectionChipProps } from "./ConnectionChip";
import { KitBar, kitStyle, type KitBarBusinessMenu, type KitBarNav } from "./KitBar";
import { NeedsLargerWindow } from "./NeedsLargerWindow";
import { ProcessingStrip, processingStatusText } from "./ProcessingStrip";
import { RightRail } from "./RightRail";
import type { RunwayWords } from "./RunwayChip";
import { Sidebar } from "./Sidebar";
import type { StopAllAgentsProps } from "./StopAllAgents";
import { TabBar, type TabBarProps } from "./TabBar";
import { departmentLetters, RESERVED_SECTION_LETTERS, useKeyboardMap, type DepartmentForKeys, type GoToTarget, type KeyboardMapContext } from "./keyboard";
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
  /** The running cycle's number, for the processing tooltip ("The team is working · cycle 3"). */
  cycleNumber?: number | null;
  /** Change to fire the single 600 ms pulse (DESIGN §7). */
  pulseKey?: string | number;
  disabled?: boolean;
  /** The action is in flight: Continue keeps focus but refuses presses (ContinueButton `pending`). */
  pending?: boolean;
  /** What a press can and cannot do right now, under the tooltip's sentence (ContinueButton `caveat`). */
  caveat?: string | null;
}

export interface AppShellProcessing {
  segments: ProcessingSegment[];
  /** A business cycle is running. */
  active: boolean;
  /** The running cycle's number, for the strip's sentence ("Product and Finance are working on cycle 3"). */
  cycleNumber?: number | null;
  /**
   * The answer to a press of Continue, the moment it is known (first-time founder report, Nov 8, 2026): "Starting the
   * next cycle…", then "Cycle 2 started: 6 tasks ready to build" or "The team cannot run right now: …". While set it is
   * the strip's sentence and the tab bar's line, guidance on or off, so "No cycle running" never stays unchanged after
   * a press. The app clears it when the strip's own sentence has caught up.
   */
  notice?: string | null;
}

/** The floor the tab bar's processing line steps down to before it truncates (DESIGN §2: 11 px). */
export const PROCESSING_LINE_MIN_PX = 11;

/**
 * The tab bar's version of the strip's sentence: the sentence itself while it names one or two departments, and a count
 * once it names three or more ("4 departments are working on cycle 12"), so the line never reaches an ellipsis at
 * 1280 px. The strip's tooltip and accessible name keep every department's name. Exported for tests.
 */
export function processingLineText(segments: readonly ProcessingSegment[], active: boolean, cycleNumber?: number | null): string {
  const working = active ? segments.filter((s) => s.active).length : 0;
  if (working < 3) return processingStatusText(segments, active, cycleNumber);
  const on = typeof cycleNumber === "number" && cycleNumber > 0 ? ` on cycle ${cycleNumber}` : "";
  return `${working} departments are working${on}`;
}

/**
 * The strip's sentence in words, at the right end of the tab bar while guidance is on (B2): `t-small` in text-3,
 * inside the bar's 40 px. When the tabs leave it little room it steps its size down to 11 px first and truncates with a
 * tooltip only as the last resort (FitText, DESIGN §2). Nothing moves. It stays a plain line on purpose: `PlainFigure`
 * stacks a figure over its words, which would need a second row the bar does not have, and `ConsequenceLine` is for
 * what an action will do, not for what is happening now.
 */
function ProcessingLine({ text, notice = false }: { text: string; notice?: boolean }) {
  // The answer to a press reads in the secondary ink, not the tertiary: it is news, not ambient status, and it is
  // announced once (role status) so a screen reader hears what the press did.
  return (
    <FitText minPx={PROCESSING_LINE_MIN_PX} className={cn("t-small max-w-80 min-w-0", notice ? "text-secondary" : "text-tertiary")} data-testid="processing-line" data-notice={notice ? "" : undefined} role={notice ? "status" : undefined}>
      {text}
    </FitText>
  );
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
  /** A small badge after the business name in the top bar (KitBar `businessBadge`: the Example chip). */
  businessBadge?: ReactNode;
  /**
   * Something else in Continue's slot (KitBar `continueSlot`: the Example frame's "Start your own"). Continue's
   * keyboard shortcut still follows `continueButton`, so pass it disabled alongside.
   */
  continueSlot?: ReactNode;
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
  /**
   * Today, runway and cash for the kit bar chip. Today is null until the browser knows the founder's own day (the
   * server's day is UTC, already tomorrow on a US evening), so server and browser render the same chip.
   */
  date: Date | string | number | null;
  runwayMonths: number | null | undefined;
  /** The words when there is no runway figure ("Not running out", "Not known yet") and why; see RunwayChip. */
  runwayWords?: RunwayWords | null;
  cash?: Money;
  runwayEstimate?: boolean;
  onRunwayClick?: () => void;
  /** The business's spend line for the mode chip (KitBar `spendLineMinor`). */
  spendLineMinor?: number | null;
  /** The business's own currency for the mode chip (KitBar `businessCurrency`). */
  businessCurrency?: string | null;
  onModeClick?: () => void;
  /** The logo and name become the business switcher: the founder's businesses, Create a new business, Manage businesses, Home, Your profile. */
  businessMenu?: KitBarBusinessMenu;
  /** The live connection is down: the kit bar says so (ConnectionChip). */
  connection?: ConnectionChipProps | null;
  /** BUILD §5.5 callbacks. Space, G chords, / and ⌘K, ? and Esc are wired by the shell itself. */
  keyboard?: AppShellKeyboard;
  /** Measured width; defaults to the window's. Below 1280 px only NeedsLargerWindow renders. */
  viewportWidth?: number;
  /** Minimum width (default 1280). */
  minViewportWidth?: number;
  children?: ReactNode;
}

/** The departments in sidebar order, with their stored letters, for the G chord. */
function departmentsForKeys(items: readonly SidebarItem[]): DepartmentForKeys[] {
  return items.filter((it) => it.group === "department").map((it) => ({ id: it.id, name: it.label, shortcut: it.shortcut }));
}

/** Sidebar items with their chords filled in: fixed surfaces from `fixed`, departments from `departmentLetters`. Exported for tests. */
export function withSidebarKeys(items: readonly SidebarItem[]): SidebarItem[] {
  const letters = departmentLetters(departmentsForKeys(items));
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

/** The brand variables `kitStyle` writes (the shell root carries them; so does the document while a shell is mounted). */
export const KIT_VARIABLES = ["--kit-primary", "--kit-secondary", "--kit-on-primary", "--kit-lift", "--kit-hi", "--kit-lo", "--kit-deep", "--kit-aura"] as const;

/**
 * While a shell is mounted, the document root carries the business's brand variables too, so the overlays that portal to
 * the body (the command palette, dialogs, menus, toasts) light up in the business's colour rather than the stylesheet's
 * steel. Removed again on unmount. Exported for tests.
 */
export function useDocumentKit(kit: Kit): void {
  const { primary, secondary } = kit;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const vars = kitStyle({ primary, secondary }) as Record<string, string | undefined>;
    for (const name of KIT_VARIABLES) {
      const value = vars[name];
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
    return () => {
      for (const name of KIT_VARIABLES) root.style.removeProperty(name);
    };
  }, [primary, secondary]);
}

/**
 * The AppShell (BUILD §5.3, DESIGN §8): sidebar left, kit bar top, processing strip under it, tab bar, content grid,
 * optional right rail. Nothing floats. Applies the business kit as CSS variables on its root, binds the keyboard map,
 * hosts the command palette (with its Help group) and the keyboard help (opened by ?, the sidebar's "?" cap or the
 * palette's Keyboard shortcuts row), repeats the processing strip's sentence in the tab bar while guidance is on, and
 * renders NeedsLargerWindow below the minimum width. Its root carries `data-coachmark-pause` while a cycle runs or an
 * overlay is open, so a first-time callout never starts then.
 */
export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(function AppShell(
  {
    mode,
    businessMode,
    kit,
    logoSrc,
    logo,
    businessBadge,
    continueSlot,
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
    runwayWords,
    cash,
    runwayEstimate,
    onRunwayClick,
    spendLineMinor,
    businessCurrency,
    onModeClick,
    businessMenu,
    connection,
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
  const departments = useMemo(() => departmentsForKeys(items), [items]);

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
  const guided = useGuided();

  const { state, cycleNumber, pulseKey, disabled: continueDisabled, pending: continuePending, caveat: continueCaveat, ...continueHandlers } = continueButton;
  const continueAction = continueButtonAction(state, continueHandlers);
  const notice = processing.notice?.trim() || null;
  const processingText = notice ?? processingStatusText(processing.segments, processing.active, processing.cycleNumber);
  // The line in the tab bar: the strip's sentence while guidance is on; the answer to a press for everyone, while it stands.
  const lineText = notice ?? (guided ? processingLineText(processing.segments, processing.active, processing.cycleNumber) : null);
  // The Help group always offers the keyboard shortcuts; the app adds its defined terms (apps/web/lib/search.ts).
  const helpItems = useMemo(() => {
    const given = search?.helpItems ?? [];
    return given.some((it) => it.id === KEYBOARD_SHORTCUTS_HELP_ITEM.id) ? given : [KEYBOARD_SHORTCUTS_HELP_ITEM, ...given];
  }, [search?.helpItems]);
  const onPaletteSelect = useCallback(
    (item: PaletteItem) => {
      if (item.id === KEYBOARD_SHORTCUTS_HELP_ITEM.id) setHelpOpen(true);
      else search?.onSelect(item);
    },
    [search],
  );

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
    onContinue: continueAction && !continueDisabled && !continuePending ? continueAction : undefined,
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

  useDocumentKit(kit);
  // Toasts stack bottom left beside the sidebar, at its real width (collapsed or not), while the shell is mounted.
  useToastPlacement({ position: "bottom-left", sidebar: sidebar.collapsed ? "collapsed" : "expanded" });

  if (tooSmall) return <NeedsLargerWindow width={width} minWidth={minViewportWidth} />;

  const homeItem = items.find((it) => it.fixed === "home");
  const rootStyle: CSSProperties = { ...kitStyle(kit), ...style };
  // A first-time callout (Coachmark, next wave) never starts while a cycle runs or an overlay is open.
  const coachmarkPause = state.kind === "processing" || searchOpen || helpOpen || stopAll.open === true;

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={300}>
      <div
        ref={ref}
        data-testid="app-shell"
        data-game-mode={mode}
        data-chord-pending={chordPending || undefined}
        data-coachmark-pause={coachmarkPause || undefined}
        className={cn("flex h-screen w-full min-w-(--min-viewport) overflow-hidden canvas-lit text-primary", className)}
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
          live={mode === "live"}
          onHelp={() => setHelpOpen(true)}
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
            runwayWords={runwayWords}
            cash={cash}
            runwayEstimate={runwayEstimate}
            onRunwayClick={onRunwayClick}
            businessMode={businessMode}
            spendLineMinor={spendLineMinor}
            businessCurrency={businessCurrency}
            onModeClick={onModeClick}
            gameMode={mode}
            continueButton={{ state, cycleNumber, pulseKey, disabled: continueDisabled, pending: continuePending, caveat: continueCaveat, ...continueHandlers }}
            continueSlot={continueSlot}
            businessBadge={businessBadge}
            stopAll={stopAll}
            onHome={homeItem && onNavigate ? () => onNavigate(homeItem) : undefined}
            businessMenu={businessMenu}
            connection={connection}
          />
          <ProcessingStrip segments={processing.segments} active={processing.active} cycleNumber={processing.cycleNumber} label={processingText} data-notice={notice ? "" : undefined} />
          {tabs ? (
            <TabBar
              {...tabs}
              trailing={
                lineText !== null ? (
                  <>
                    {tabs.trailing}
                    <ProcessingLine text={lineText} notice={notice !== null} />
                  </>
                ) : (
                  tabs.trailing
                )
              }
            />
          ) : null}
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <div className="rule-under flex h-control-md shrink-0 items-center px-gutter">
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
        {search ? (
          <CommandPalette
            {...search}
            business={search.business ?? { name: businessName, href: homeItem?.href, logo: logoSrc !== undefined || !logo ? <BusinessLogo src={logoSrc} name={businessName} primary={kit.primary} size={20} /> : undefined }}
            helpItems={helpItems}
            onSelect={onPaletteSelect}
            open={searchOpen}
            onOpenChange={setSearchOpen}
          />
        ) : null}
        <KeyboardHelp open={helpOpen} onOpenChange={setHelpOpen} departments={departments} />
      </div>
    </TooltipProvider>
  );
});
