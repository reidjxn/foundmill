import { forwardRef, isValidElement, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { BusinessMode, GameMode, Money } from "@founder-manager/shared";
import { cn } from "../../lib/cn";
import { darkenHex, isHexColour, kitOnPrimary } from "../../lib/colour";
import { Crest } from "../foundation/Crest";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Kbd } from "../foundation/Kbd";
import { ContinueButton, type ContinueButtonProps } from "./ContinueButton";
import { GameModeChip, ModeChip } from "./ModeChip";
import { RunwayChip } from "./RunwayChip";
import { StopAllAgents, type StopAllAgentsProps } from "./StopAllAgents";
import type { Kit } from "./types";

/** A procedural crest from the business row, or a ready element (an uploaded crest image). */
export type CrestInput = { seed: string | number; monogram: string } | ReactNode;

export interface KitBarNav {
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface KitBarProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  kit: Kit;
  crest: CrestInput;
  businessName: string;
  /** Display-md title of the current screen. */
  screenTitle: ReactNode;
  nav?: KitBarNav;
  /** Opens the universal search (CommandPalette). */
  onSearch: () => void;
  searchPlaceholder?: string;
  /** Today, for the date + runway chip. */
  date: Date | string | number;
  runwayMonths: number | null | undefined;
  cash?: Money;
  /** Runway is modelled, not read from a ledger (default true → "Est." label). */
  runwayEstimate?: boolean;
  onRunwayClick?: () => void;
  businessMode: BusinessMode;
  onModeClick?: () => void;
  /** Shown as a second chip when LIVE; omitted in Personal mode. */
  gameMode?: GameMode;
  continueButton: ContinueButtonProps;
  stopAll: StopAllAgentsProps;
  /** Crest + name become a button (go Home). */
  onHome?: () => void;
}

/** CSS variables for a kit, applied on the shell root and the kit bar. Exported for AppShell and tests. */
export function kitStyle(kit: Kit): CSSProperties {
  const primary = isHexColour(kit.primary) ? kit.primary : undefined;
  return {
    "--kit-primary": kit.primary,
    "--kit-secondary": kit.secondary,
    "--kit-on-primary": primary ? kitOnPrimary(primary) : undefined,
  } as CSSProperties;
}

/** DESIGN §8: gradient from kit-primary to kit-primary darkened 14 %. */
export function kitBarGradient(kit: Kit): string {
  const end = isHexColour(kit.primary) ? darkenHex(kit.primary, 0.14) : "var(--kit-primary)";
  return `linear-gradient(90deg, var(--kit-primary) 0%, ${end} 100%)`;
}

function isCrestSpec(c: CrestInput): c is { seed: string | number; monogram: string } {
  return typeof c === "object" && c !== null && !isValidElement(c) && "seed" in c && "monogram" in c;
}

/**
 * The 56 px kit bar (BUILD §5.3, DESIGN §8). Left: crest 32 px, business name, back/forward. Centre: screen title and
 * the universal search trigger (320 px, bg-ink at 40 %). Right: date + runway chip, business-mode chip, Continue,
 * Stop all agents. Text is kit-on-primary so it always passes APCA on the kit colour.
 */
export const KitBar = forwardRef<HTMLElement, KitBarProps>(function KitBar(
  {
    kit,
    crest,
    businessName,
    screenTitle,
    nav,
    onSearch,
    searchPlaceholder = "Search people, organisations, agents, screens…",
    date,
    runwayMonths,
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
  const crestNode = isCrestSpec(crest) ? (
    <Crest seed={crest.seed} monogram={crest.monogram} kitPrimary={kit.primary} kitSecondary={kit.secondary} size={32} title={`${businessName} crest`} />
  ) : (
    crest
  );
  const identity = (
    <span className="flex min-w-0 items-center gap-2">
      {crestNode}
      <span className="t-display-sm truncate" data-testid="kitbar-business-name">
        {businessName}
      </span>
    </span>
  );
  const holiday = continueButton.state.kind === "holiday";
  const navButtonClass = "text-kit-on-primary/80 hover:bg-ink/30 hover:text-kit-on-primary disabled:opacity-40";

  return (
    <header
      ref={ref}
      data-testid="kit-bar"
      className={cn("flex h-kitbar shrink-0 items-center gap-3 px-3 text-kit-on-primary", className)}
      style={{ ...kitStyle(kit), backgroundImage: kitBarGradient(kit), ...style }}
      {...rest}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-1" style={{ maxWidth: "var(--sidebar-width)" }}>
        {onHome ? (
          <button type="button" onClick={onHome} className="min-w-0 rounded-panel outline-none hover:no-underline focus-visible:outline-2 focus-visible:outline-link" aria-label={`${businessName}: go to Home`}>
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

      <div className="flex min-w-0 flex-1 items-center gap-4">
        <h1 className="t-display-md min-w-0 truncate" data-testid="kitbar-screen-title">
          {screenTitle}
        </h1>
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search"
          aria-keyshortcuts="/ Meta+K"
          data-testid="kitbar-search"
          className={cn(
            "ml-auto flex h-control-md w-80 shrink-0 items-center gap-2 rounded-panel bg-ink/40 px-2 text-white outline-none",
            "transition-colors duration-micro ease-dugout hover:bg-ink/55 focus-visible:outline-2 focus-visible:outline-link",
          )}
        >
          <Icon icon={Search} size="inline" className="text-white/80" />
          <span className="min-w-0 flex-1 truncate text-left text-body text-white/70">{searchPlaceholder}</span>
          <span className="inline-flex items-center gap-1" aria-hidden>
            <Kbd>/</Kbd>
            <Kbd>⌘K</Kbd>
          </span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <RunwayChip date={date} runwayMonths={runwayMonths} cash={cash} estimate={runwayEstimate} onClick={onRunwayClick} />
        {gameMode === "live" ? <GameModeChip mode="live" /> : null}
        <ModeChip mode={businessMode} holiday={holiday} onClick={onModeClick} />
        <ContinueButton {...continueButton} />
        <StopAllAgents {...stopAll} />
      </div>
    </header>
  );
});
