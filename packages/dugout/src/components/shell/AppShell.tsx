"use client";
import { forwardRef, useCallback, useEffect, useMemo, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import type { AreaKey, BusinessMode, GameMode, Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { FitText } from "../foundation/FitText";
import { useToastPlacement } from "../foundation/Toast";
import { TooltipProvider } from "../foundation/Tooltip";
import { ExplainPageButton } from "../guidance/ExplainPageButton";
import { useBuilderView } from "../guidance/BuilderView";
import { useGuided } from "../guidance/GuidanceProvider";
import { PageExplainProvider } from "../guidance/PageExplain";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette, KEYBOARD_SHORTCUTS_HELP_ITEM, type CommandPaletteProps, type PaletteItem } from "./CommandPalette";
import { type ContinueHandlers } from "./ContinueButton";
import { KeyboardHelp } from "./KeyboardHelp";
import type { ConnectionChipProps } from "./ConnectionChip";
import { KitBar, kitStyle, type KitBarBusinessMenu, type KitBarNav } from "./KitBar";
import { NeedsLargerWindow } from "./NeedsLargerWindow";
import { PhoneBar, PhoneMenu } from "./PhoneBar";
import { ProcessingStrip, processingStatusText } from "./ProcessingStrip";
import { RightRail } from "./RightRail";
import type { RunwayWords } from "./RunwayChip";
import { Sidebar } from "./Sidebar";
import type { StopAllAgentsProps } from "./StopAllAgents";
import { TabBar, type TabBarProps } from "./TabBar";
import { AREA_LETTERS, SHELL_FIXED_LETTERS, shellDepartmentLetters, useKeyboardMap, type DepartmentForKeys, type GoToTarget, type KeyboardMapContext } from "./keyboard";
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
  /** What the last cycle cost, as an Estimate (ContinueButton `hint`). */
  hint?: string | null;
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
export function processingLineText(segments: readonly ProcessingSegment[], active: boolean, cycleNumber?: number | null, builder = false): string {
  const working = active ? segments.filter((s) => s.active).length : 0;
  if (working < 3) return processingStatusText(segments, active, cycleNumber, builder);
  const on = builder && typeof cycleNumber === "number" && cycleNumber > 0 ? ` on cycle ${cycleNumber}` : "";
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
  /** A one-line caption under the business name in the top bar (KitBar `businessBadge`: "Sample business"). */
  businessBadge?: ReactNode;
  /** What that caption means, in one line (KitBar `businessBadgeLine`: joins the switcher's tooltip). */
  businessBadgeLine?: string;
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
  /**
   * The page's one "Ask <Chief of Staff>" control (`AskChiefOfStaff`), drawn beside "Explain this page" at the right end
   * of the tab row; in the breadcrumb row on a page with breadcrumbs and no tabs; and in a thin row of its own on a page
   * with neither, so every business page has exactly one. Omit when the business has no Chief of Staff.
   */
  pageActions?: ReactNode;
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
  /** BUILD §5.5 callbacks. G chords, / and ⌘K, ? and Esc are wired by the shell itself; `singleKeys` turns the single keys on (default off, WP-04 T13). */
  keyboard?: AppShellKeyboard;
  /** Measured width; defaults to the window's. Below 1280 px only NeedsLargerWindow renders. */
  viewportWidth?: number;
  /** Minimum width (default 1280). */
  minViewportWidth?: number;
  /**
   * This screen works on a phone (CLAUDE.md "Small screens"). Under the minimum width the shell draws its phone layout
   * instead of NeedsLargerWindow: a compact top bar with a menu button, no sidebar and no right rail, the page's tabs
   * scrolling sideways, the content at full width with the 16 px gutter and the shell as an `@container` (so a page can
   * use `@page-wide:`). At or over the minimum width, and without this prop, nothing changes.
   */
  phone?: boolean;
  /**
   * With the phone layout: draw the page's "Explain this page" button in the phone title row (WP-04 T7, Today only).
   * The desktop tab row always draws it; on a phone only the screens that ask for it do, to keep the row short.
   */
  phoneExplain?: boolean;
  children?: ReactNode;
}

/** The module-less departments in sidebar order, with their stored letters, for the G chord. */
function departmentsForKeys(items: readonly SidebarItem[]): DepartmentForKeys[] {
  return items.filter((it) => it.group === "department").map((it) => ({ id: it.id, name: it.label, shortcut: it.shortcut }));
}

/** The founder areas the sidebar shows, in its order, for the G chord. */
function areasForKeys(items: readonly SidebarItem[]): AreaKey[] {
  return items.flatMap((it) => (it.group === "area" && it.area ? [it.area] : []));
}

/**
 * Sidebar items with their chords filled in: Today and Needs you from `fixed` (G H, G I), the areas from
 * `AREA_LETTERS` (G P, G C, G M, G R, G T) and module-less departments from `shellDepartmentLetters`. Exported for tests.
 */
export function withSidebarKeys(items: readonly SidebarItem[]): SidebarItem[] {
  const letters = shellDepartmentLetters(departmentsForKeys(items));
  const fixedLetter = (fixed: NonNullable<SidebarItem["fixed"]>) => Object.entries(SHELL_FIXED_LETTERS).find(([, v]) => v === fixed)?.[0];
  return items.map((it) => {
    if (it.keys) return it;
    if (it.fixed) {
      const l = fixedLetter(it.fixed);
      return l ? { ...it, keys: ["G", l] } : it;
    }
    if (it.group === "area" && it.area) return { ...it, keys: ["G", AREA_LETTERS[it.area]] };
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
  if (target.kind === "area") return items.find((it) => it.group === "area" && it.area === target.area);
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
    businessBadgeLine,
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
    pageActions,
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
    phone = false,
    phoneExplain = false,
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
  const phoneLayout = phone && tooSmall;
  const [menuOpen, setMenuOpen] = useState(false);

  const items = useMemo(() => withSidebarKeys(sidebar.items), [sidebar.items]);
  const departments = useMemo(() => departmentsForKeys(items), [items]);
  const areas = useMemo(() => areasForKeys(items), [items]);

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

  const { state, cycleNumber, pulseKey, disabled: continueDisabled, pending: continuePending, caveat: continueCaveat, hint: continueHint, ...continueHandlers } = continueButton;
  const notice = processing.notice?.trim() || null;
  const builder = useBuilderView();
  const processingText = notice ?? processingStatusText(processing.segments, processing.active, processing.cycleNumber, builder);
  // The line in the tab bar: the strip's sentence while guidance is on; the answer to a press for everyone, while it stands.
  const lineText = notice ?? (guided ? processingLineText(processing.segments, processing.active, processing.cycleNumber, builder) : null);
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
    // Off unless the account turned single keys on (WP-04 T13); Space is never a page shortcut (Continue takes it only
    // with focus, as any button does).
    singleKeys: keyboard?.singleKeys === true,
    areas,
    departments,
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

  if (tooSmall && !phone) return <NeedsLargerWindow width={width} minWidth={minViewportWidth} />;

  const homeItem = items.find((it) => it.fixed === "home");
  const rootStyle: CSSProperties = { ...kitStyle(kit), ...style };
  // A first-time callout (Coachmark, next wave) never starts while a cycle runs or an overlay is open.
  const coachmarkPause = state.kind === "processing" || searchOpen || helpOpen || stopAll.open === true;

  if (phoneLayout) {
    const tabsLeading = tabs ? { ...tabs, trailing: undefined } : null;
    return (
      <TooltipProvider delayDuration={400} skipDelayDuration={300}>
        <PageExplainProvider>
          <div
            ref={ref}
            data-testid="app-shell"
            data-phone=""
            data-game-mode={mode}
            data-chord-pending={chordPending || undefined}
            data-coachmark-pause={coachmarkPause || undefined}
            className={cn("@container flex h-dvh w-full min-w-0 flex-col overflow-hidden canvas-lit text-primary type-outer", className)}
            style={rootStyle}
            {...rest}
          >
            {/* The page's header (banner): the skip link, the bar, the title and the tabs, so every one of them is inside a
                landmark (axe "region" at 390 px, WP-10 T7). The skip link stays the first thing Tab reaches. */}
            <header className="flex shrink-0 flex-col" data-testid="shell-header">
            <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-panel focus:bg-panel-alt focus:px-2 focus:py-1">
              Skip to content
            </a>
            <PhoneBar
              kit={kit}
              logoSrc={logoSrc}
              logo={logo}
              businessName={businessName}
              continueButton={{ state, cycleNumber, pulseKey, disabled: continueDisabled, pending: continuePending, caveat: continueCaveat, hint: continueHint, ...continueHandlers }}
              continueSlot={continueSlot}
              stopAll={stopAll}
              menuOpen={menuOpen}
              onMenuOpenChange={setMenuOpen}
            />
            <ProcessingStrip segments={processing.segments} active={processing.active} cycleNumber={processing.cycleNumber} label={processingText} data-notice={notice ? "" : undefined} />
            <div className="rule-under flex min-h-tap shrink-0 items-center gap-2 px-gutter" data-testid="phone-title-row">
              <h1 className="t-display-md min-w-0 flex-1 truncate" data-testid="phone-screen-title">
                {screenTitle}
              </h1>
              {pageActions || phoneExplain ? (
                <div className="flex shrink-0 items-center [&_a]:min-h-tap [&_button]:min-h-tap">
                  {pageActions}
                  {phoneExplain ? <ExplainPageButton /> : null}
                </div>
              ) : null}
            </div>
            {tabsLeading ? (
              <div className="flex shrink-0 items-stretch" data-testid="phone-tabs">
                <div className="min-w-0 flex-1 overflow-x-auto" data-testid="phone-tabs-scroll">
                  <TabBar {...tabsLeading} className={cn("min-h-tap min-w-max [&_.shell-tab]:min-h-tap", tabsLeading.className)} />
                </div>
                {tabs?.trailing ? <div className="rule-under flex shrink-0 items-center gap-2 pr-gutter [&_a]:min-h-tap [&_button]:min-h-tap">{tabs.trailing}</div> : null}
              </div>
            ) : null}
            </header>
            <main id="main" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto outline-none" data-testid="shell-content">
              {children}
            </main>
            <PhoneMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              items={items}
              activeId={sidebar.activeId}
              businessName={businessName}
              onSelect={(item) => {
                cancelChord();
                onNavigate?.(item);
              }}
              onSearch={search || onSearch ? openSearch : undefined}
            />
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
            <KeyboardHelp open={helpOpen} onOpenChange={setHelpOpen} departments={departments} areas={areas} singleKeys={keyboard?.singleKeys === true} />
          </div>
        </PageExplainProvider>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={300}>
      <PageExplainProvider>
      <div
        ref={ref}
        data-testid="app-shell"
        data-game-mode={mode}
        data-chord-pending={chordPending || undefined}
        data-coachmark-pause={coachmarkPause || undefined}
        className={cn("@container flex h-screen w-full overflow-hidden canvas-lit text-primary", !phone && "min-w-(--min-viewport)", className)}
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
          {/* The page's header (banner): the bar, the tab row and the breadcrumbs, so every one of them is inside a landmark. */}
          <header className="flex shrink-0 flex-col" data-testid="shell-header">
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
            continueButton={{ state, cycleNumber, pulseKey, disabled: continueDisabled, pending: continuePending, caveat: continueCaveat, hint: continueHint, ...continueHandlers }}
            continueSlot={continueSlot}
            businessBadge={businessBadge}
            businessBadgeLine={businessBadgeLine}
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
                <>
                  {tabs.trailing}
                  {lineText !== null ? <ProcessingLine text={lineText} notice={notice !== null} /> : null}
                  {pageActions}
                  {/* The page's one "Explain this page" button, at the right end of the tab row; nothing until a screen registered. */}
                  <ExplainPageButton />
                </>
              }
            />
          ) : null}
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <div className="rule-under flex h-control-md shrink-0 items-center px-gutter">
              <Breadcrumbs items={breadcrumbs} />
              {/* A page with breadcrumbs and no tab row keeps the buttons here, so there is still exactly one of each. */}
              {tabs ? null : (
                <div className="ml-auto flex items-center gap-1">
                  {pageActions}
                  <ExplainPageButton />
                </div>
              )}
            </div>
          ) : null}
          {/* A page with neither row: a thin row of its own for the Ask control, so no page is without it. */}
          {pageActions && !tabs && !(breadcrumbs && breadcrumbs.length > 0) ? (
            <div className="rule-under flex h-control-md shrink-0 items-center justify-end px-gutter" data-testid="page-actions-row">
              {pageActions}
            </div>
          ) : null}
          </header>
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
        <KeyboardHelp open={helpOpen} onOpenChange={setHelpOpen} departments={departments} areas={areas} singleKeys={keyboard?.singleKeys === true} />
      </div>
      </PageExplainProvider>
    </TooltipProvider>
  );
});
