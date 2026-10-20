import { Hand, Handshake, Globe, Lock, Zap } from "lucide-react";
import type { BusinessMode, GameMode } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import type { ChipProps } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";

/**
 * The top bar's first compaction step, `chips-brief` (KitBarFit): the mode chip's second phrase ("· asks before
 * spending") and the runway chip's inline reason ("· connect a bank") show only at the widest step, while the search
 * still has its whole width. The step is a token on the bar's `data-compact`; this class hides the span under it.
 * Defined here (a server-safe module) so both chips share it.
 */
export const KITBAR_BRIEF_CLASS = "[[data-compact~=chips-brief]_&]:hidden";

export interface BusinessModeInfo {
  word: string;
  icon: IconComponent;
  /** One plain sentence (docs/UX_AUDIT_AND_PLAN.md §7.7, B3): what the team does alone and what it asks you first. */
  summary: string;
  /** The second phrase the chip carries at the widest top-bar step: "asks before spending". */
  brief: string;
}

/** Words and icons for the three business modes (BUILD §9.6). Never a bare colour. */
export const BUSINESS_MODE_INFO: Record<BusinessMode, BusinessModeInfo> = {
  augmented: { word: "Augmented", icon: Hand, summary: "The team prepares and asks before every outside action or spend.", brief: "asks before acting" },
  assisted: { word: "Assisted", icon: Handshake, summary: "The team does routine work alone and asks you before spending above your limit, signing anything or contacting new people.", brief: "asks before spending" },
  automated: { word: "Automated", icon: Zap, summary: "The Chief of Staff decides inside your limits; money, signatures and contracts still wait for you.", brief: "runs inside limits" },
};

/** Where the mode is changed; the tooltip ends with it so the chip is never a dead end. */
export const MODE_SETTINGS_HINT = "Change it in Settings › Mode.";

/**
 * The chip's tooltip: "Assisted mode: the team does routine work alone and asks you before spending above your limit,
 * signing anything or contacting new people. Change it in Settings › Mode." On vacation it says Automated is the
 * vacation's and which mode comes back with the founder. Exported for tests.
 */
export function modeChipTooltip(mode: BusinessMode, holiday = false): string {
  const inForce: BusinessMode = holiday ? "automated" : mode;
  const info = BUSINESS_MODE_INFO[inForce];
  const sentence = `${info.word} mode: ${info.summary.charAt(0).toLowerCase()}${info.summary.slice(1)}`;
  const back = holiday && mode !== "automated" ? ` ${BUSINESS_MODE_INFO[mode].word} again when you come back.` : "";
  return holiday ? `On vacation. ${sentence} ${MODE_SETTINGS_HINT}${back}` : `${sentence} ${MODE_SETTINGS_HINT}`;
}

export interface ModeChipProps extends Omit<ChipProps, "children" | "tone" | "icon" | "onClick"> {
  mode: BusinessMode;
  /** Shown as a tooltip. Default: `modeChipTooltip`. */
  description?: string;
  /** Makes the chip a button (open Settings › Mode). */
  onClick?: () => void;
  /**
   * Vacation: the business runs in Automated mode while the founder is away (BUILD §9.6), so the chip shows the mode in
   * force, Automated; its label and tooltip say it is the vacation's and which mode comes back with the founder.
   */
  holiday?: boolean;
}

/**
 * The business-mode chip on the brand slab: glass, 34 px, icon + word, so the mode reads without colour. At the widest
 * top-bar step it carries a second phrase ("Assisted · asks before spending"), the first thing to give way when the bar
 * tightens (KitBarFit `chips-brief`). A button when it opens Settings › Mode; the tooltip says what the team does alone
 * and what it asks you first, and where to change it.
 */
export function ModeChip({ mode, description, onClick, holiday, className, mono: _mono, dot: _dot, fit: _fit, onRemove: _onRemove, removeLabel: _removeLabel, selected: _selected, ...rest }: ModeChipProps) {
  const inForce: BusinessMode = holiday ? "automated" : mode;
  const info = BUSINESS_MODE_INFO[inForce];
  const back = holiday && mode !== "automated" ? `; ${BUSINESS_MODE_INFO[mode].word} when you come back` : "";
  const common = {
    "aria-label": `Business mode: ${info.word}${holiday ? `, on vacation${back}` : ""}`,
    "data-mode": inForce,
    "data-base-mode": holiday ? mode : undefined,
    "data-chip": "",
    className: cn("kitbar-glass", className),
  };
  const content = (
    <>
      <Icon icon={info.icon} size="inline" />
      <span className="kitbar-chip-word">{info.word}</span>
      {/* The second phrase, at the widest step only; the tooltip and the label keep the whole sentence. */}
      <span aria-hidden className={cn("kitbar-chip-word font-normal opacity-80", KITBAR_BRIEF_CLASS)} data-chip-brief>
        {" · "}
        {info.brief}
      </span>
    </>
  );
  return (
    <Tooltip content={description ?? modeChipTooltip(mode, holiday)}>
      {onClick ? (
        <button type="button" onClick={onClick} {...common}>
          {content}
        </button>
      ) : (
        <span role="group" {...common} {...rest}>
          {content}
        </span>
      )}
    </Tooltip>
  );
}

export interface GameModeChipProps extends Omit<ChipProps, "children" | "tone" | "icon"> {
  mode: GameMode;
}

/** LIVE (public on the network, a lit globe in the brand's lift) or Personal (private, a lock). Glass on the slab. */
export function GameModeChip({ mode, className, mono: _mono, dot: _dot, fit: _fit, onRemove: _onRemove, removeLabel: _removeLabel, selected: _selected, onClick: _onClick, ...rest }: GameModeChipProps) {
  const live = mode === "live";
  return (
    <Tooltip content={live ? `Visible on ${APP_NAME} LIVE: network, communities and leaderboards.` : "Personal: private to you and your co-founders."}>
      <span
        role="group"
        aria-label={live ? "Game mode: LIVE" : "Game mode: Personal"}
        data-game-mode={mode}
        data-chip=""
        className={cn("kitbar-glass", className)}
        {...rest}
      >
        <Icon icon={live ? Globe : Lock} size="inline" />
        <span className="kitbar-chip-word">{live ? "LIVE" : "Personal"}</span>
      </span>
    </Tooltip>
  );
}
