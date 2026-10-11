import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { BusinessMode, GameMode, Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { darkenHex, isHexColour, kitOnPrimary, kitRamp } from "../../lib/colour";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { FitText } from "../foundation/FitText";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { ContinueButton, type ContinueButtonProps } from "./ContinueButton";
import { KitBarFit } from "./KitBarFit";
import { GameModeChip, ModeChip } from "./ModeChip";
import { RunwayChip, type RunwayWords } from "./RunwayChip";
import { StopAllAgents, type StopAllAgentsProps } from "./StopAllAgents";
import type { Kit } from "./types";

export interface KitBarNav {
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

/** The search's placeholder: short enough never to be cut (DESIGN §8). Below 200 px it reads "Search", then just the icon. */
export const KITBAR_SEARCH_PLACEHOLDER = "Search or jump to…";
/** Smallest sizes the business name and the screen title step down to before they truncate (FitText). */
export const KITBAR_NAME_MIN_PX = 12;
export const KITBAR_TITLE_MIN_PX = 15;

export interface KitBarProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  kit: Kit;
  /**
   * The business's logo as a data URL (`business.logo.get`); absent or null draws the initials mark in the primary
   * brand colour.
   */
  logoSrc?: string | null;
  /** A ready element instead of `logoSrc` (stories, previews). */
  logo?: ReactNode;
  businessName: string;
  /** Display-md title of the current screen. */
  screenTitle: ReactNode;
  nav?: KitBarNav;
  /** Opens the universal search (CommandPalette). */
  onSearch: () => void;
  /** The search's placeholder (default "Search or jump to…"). Keep it short: the search gives way first at 1280. */
  searchPlaceholder?: string;
  /** Today, for the date + runway chip; null leaves the date out (see RunwayChip). */
  date: Date | string | number | null;
  runwayMonths: number | null | undefined;
  /** The words when there is no runway figure (the app's shared wording, as on Home's tiles), with the reason. */
  runwayWords?: RunwayWords | null;
  cash?: Money;
  /** Runway is modelled, not read from a ledger (default true → the dashed "Estimate" tag). */
  runwayEstimate?: boolean;
  onRunwayClick?: () => void;
  businessMode: BusinessMode;
  onModeClick?: () => void;
  /** Shown as a second chip when LIVE; omitted in Personal mode. */
  gameMode?: GameMode;
  continueButton: ContinueButtonProps;
  stopAll: StopAllAgentsProps;
  /** Logo + name become a button (go Home). */
  onHome?: () => void;
}

/**
 * CSS variables for a kit, applied on the shell root and the kit bar (and on any preview of a brand, such as the
 * landing deck). Besides the two brand colours it writes the computed text colour and the brand ramp derived from the
 * primary in OKLCH (`kitRamp`): --kit-lift, --kit-hi, --kit-lo, --kit-deep and --kit-aura, so any brand colour lights
 * the product correctly. A primary that is not a hex colour leaves the ramp to the stylesheet defaults (Foundmill
 * steel). Pure and server-safe. Exported for AppShell and tests.
 */
export function kitStyle(kit: Kit): CSSProperties {
  const primary = isHexColour(kit.primary) ? (kit.primary.startsWith("#") ? kit.primary : `#${kit.primary}`) : undefined;
  const ramp = primary ? kitRamp(primary) : undefined;
  return {
    "--kit-primary": kit.primary,
    "--kit-secondary": kit.secondary,
    "--kit-on-primary": primary ? kitOnPrimary(primary) : undefined,
    "--kit-lift": ramp?.lift,
    "--kit-hi": ramp?.hi,
    "--kit-lo": ramp?.lo,
    "--kit-deep": ramp?.deep,
    "--kit-aura": ramp?.aura,
  } as CSSProperties;
}

/**
 * The flat two-stop brand gradient (kit-primary to kit-primary darkened 14 %), for small brand previews (the landing
 * deck, the logo picker's strip). The top bar itself is the glass slab (`kitbar-slab`).
 */
export function kitBarGradient(kit: Kit): string {
  const end = isHexColour(kit.primary) ? darkenHex(kit.primary, 0.14) : "var(--kit-primary)";
  return `linear-gradient(90deg, var(--kit-primary) 0%, ${end} 100%)`;
}

/**
 * The 56 px top bar (BUILD §5.3, DESIGN §8): a glass slab in the brand colour (gloss, a brand gradient from 92 % to
 * 38 %, a fixed specular streak, a light top edge, a kit-lift line under it and the brand's light cast onto the canvas).
 * Left: the 32 px logo tile, the business name, back/forward, a hairline, the screen title. Then the universal search
 * and, right: date + runway, the business-mode chip, Continue, Stop all agents — all glass, 34 px. Nothing is clipped at
 * 1280: the search gives way first (its placeholder shortens, then only the icon remains); then, while the bar still
 * cannot hold everything whole or the screen title would lose its room, the chips compact one step at a time
 * (KitBarFit: dates drop the year, the vacation caption shortens to "Until Oct 21" and then its icon, LIVE and the mode
 * show their icons, the date leaves the runway chip); a long business name or screen title wraps to two lines and steps
 * its size down (FitText) before it would ever truncate.
 */
export const KitBar = forwardRef<HTMLElement, KitBarProps>(function KitBar(
  {
    kit,
    logoSrc,
    logo,
    businessName,
    screenTitle,
    nav,
    onSearch,
    searchPlaceholder = KITBAR_SEARCH_PLACEHOLDER,
    date,
    runwayMonths,
    runwayWords,
    cash,
    runwayEstimate = true,
    onRunwayClick,
    businessMode,
    onModeClick,
    gameMode,
    continueButton,
    stopAll,
    onHome,
    className,
    style,
    ...rest
  },
  ref,
) {
  const logoNode = logo ?? <BusinessLogo src={logoSrc} name={businessName} primary={kit.primary} size={32} data-testid="kitbar-logo" />;
  const identity = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex shrink-0">{logoNode}</span>
      <FitText minPx={KITBAR_NAME_MIN_PX} lines={2} className="t-display-sm leading-tight" data-testid="kitbar-business-name">
        {businessName}
      </FitText>
    </span>
  );
  const holiday = continueButton.state.kind === "holiday";
  const navButtonClass = "text-kit-on-primary hover:bg-black/20 hover:text-kit-on-primary disabled:opacity-40";
  const titleText = typeof screenTitle === "string" || typeof screenTitle === "number" ? String(screenTitle) : undefined;

  return (
    <header
      ref={ref}
      data-testid="kit-bar"
      className={cn("kitbar-slab z-10 flex h-kitbar shrink-0 items-center gap-2 px-3 text-kit-on-primary", className)}
      style={{ ...kitStyle(kit), ...style }}
      {...rest}
    >
      <div className="flex min-w-0 max-w-sidebar shrink-0 items-center">
        {onHome ? (
          <button
            type="button"
            onClick={onHome}
            className="min-w-0 rounded-sm text-left outline-none hover:no-underline focus-visible:shadow-ring"
            aria-label={`${businessName}: go to Home`}
          >
            {identity}
          </button>
        ) : (
          identity
        )}
      </div>
      {nav ? (
        <div className="flex shrink-0 items-center">
          <IconButton icon={ChevronLeft} label="Back" size="sm" disabled={nav.canGoBack === false} onClick={nav.onBack} className={navButtonClass} />
          <IconButton icon={ChevronRight} label="Forward" size="sm" disabled={nav.canGoForward === false} onClick={nav.onForward} className={navButtonClass} />
        </div>
      ) : null}
      <span aria-hidden className="kitbar-divider" />

      <h1 className="t-display-md flex min-w-0 shrink" data-testid="kitbar-screen-title">
        {titleText !== undefined ? (
          <FitText minPx={KITBAR_TITLE_MIN_PX} lines={2} className="leading-tight">
            {titleText}
          </FitText>
        ) : (
          <span className="min-w-0 truncate">{screenTitle}</span>
        )}
      </h1>

      <button
        type="button"
        onClick={onSearch}
        aria-label="Search"
        aria-keyshortcuts="/ Meta+K"
        data-testid="kitbar-search"
        className="kitbar-glass kitbar-search"
      >
        <Icon icon={Search} size="default" className="kitbar-search-icon" />
        <span className="kitbar-search-long truncate">{searchPlaceholder}</span>
        <span aria-hidden className="kitbar-search-short">
          Search
        </span>
        <span className="kitbar-search-keys" aria-hidden>
          <kbd className="kitbar-kbd">⌘K</kbd>
        </span>
      </button>

      <KitBarFit />
      <div className="flex shrink-0 items-center gap-2">
        <RunwayChip date={date} runwayMonths={runwayMonths} words={runwayWords} cash={cash} estimate={runwayEstimate} onClick={onRunwayClick} />
        {gameMode === "live" ? <GameModeChip mode="live" /> : null}
        <ModeChip mode={businessMode} holiday={holiday} onClick={onModeClick} />
        <ContinueButton {...continueButton} className={cn("h-kitbar-chip rounded-track", continueButton.className)} />
        <StopAllAgents {...stopAll} />
      </div>
    </header>
  );
});
