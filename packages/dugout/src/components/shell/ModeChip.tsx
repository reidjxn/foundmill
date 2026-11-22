"use client";
import { Hand, Handshake, Globe, Lock, Zap } from "lucide-react";
import type { BusinessMode, GameMode } from "@foundmill/shared";
import { teamCanDoWords, TEAM_CAN_DO_SETTINGS_HINT, type TeamCanDoChipWords } from "@foundmill/shared/team-can-do";
import { APP_NAME, LIMITS } from "@foundmill/config";
import { cn } from "../../lib/cn";
import type { ChipProps } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";
import { useTerm } from "../guidance/GuidanceProvider";

/**
 * The top bar's first compaction step, `chips-brief` (KitBarFit): the mode chip's whole phrase ("Asks before spending
 * over £50") and the runway chip's inline reason ("· connect a bank") show only at the widest step, while the search
 * still has its whole width. The step is a token on the bar's `data-compact`; this class hides the span under it.
 * Defined here (a server-safe module) so both chips share it.
 */
export const KITBAR_BRIEF_CLASS = "[[data-compact~=chips-brief]_&]:hidden";

/**
 * The inverse of `KITBAR_BRIEF_CLASS`: shown only from the `chips-brief` step until `chips-icon` (the mode chip's short
 * words; shell.css `kitbar-chip-short`).
 */
export const KITBAR_BRIEF_ONLY_CLASS = "kitbar-chip-short";

export interface BusinessModeInfo {
  word: string;
  icon: IconComponent;
  /** One plain sentence (docs/UX_AUDIT_AND_PLAN.md §7.7, B3): what the team does alone and what it asks you first. */
  summary: string;
}

/**
 * Words and icons for the three business modes (BUILD §9.6). Never a bare color. The mode's word is the name a few
 * lists still show (Manage businesses); the chip and Settings say what the team does instead (`teamCanDoWords`).
 */
export const BUSINESS_MODE_INFO: Record<BusinessMode, BusinessModeInfo> = {
  augmented: { word: "Augmented", icon: Hand, summary: "The team prepares and asks before contacting anyone, spending anything or doing what can't be undone." },
  // Nothing checks whether a recipient is new, so the words never promise it (founder, 2026-11-07).
  assisted: { word: "Assisted", icon: Handshake, summary: "The team does routine work alone and asks you before spending over your line, anything it can't undo and any contract." },
  automated: { word: "Automated", icon: Zap, summary: "The team decides on its own; spending over your line, putting changes live, money and signatures still wait for you." },
};

/** Where the setting is changed; the tooltip ends with it so the chip is never a dead end. */
export const MODE_SETTINGS_HINT = TEAM_CAN_DO_SETTINGS_HINT;

export interface ModeChipWordsInput {
  mode: BusinessMode;
  holiday?: boolean;
  /** The business's spend line (`businesses.spend_cap_minor`): an amount, 0 (always ask) or null (each agent's own limit). */
  spendLineMinor?: number | null;
  /** The business's currency, for the line's narrow symbol ("£50"). */
  currency?: string | null;
}

/** The chip's words (label, short form, aria-label, tooltip) from the shared words, with the platform's default agent limit. */
export function modeChipWords({ mode, holiday, spendLineMinor, currency }: ModeChipWordsInput): TeamCanDoChipWords {
  return teamCanDoWords({ mode, holiday, lineMinor: spendLineMinor ?? null, currency: currency ?? null, agentLimitMinor: LIMITS.approvalThresholdMinorDefault });
}

/**
 * The chip's tooltip: "The team does routine work on its own. It asks you before spending over £50, before anything it
 * can't undo and before any contract. Moving money, signing and filings always come to you. Change it in Settings ›
 * What the team can do." On vacation it opens with "On vacation." and ends with what comes back. Exported for tests.
 */
export function modeChipTooltip(mode: BusinessMode, holiday = false, line: Omit<ModeChipWordsInput, "mode" | "holiday"> = {}): string {
  return modeChipWords({ mode, holiday, ...line }).tooltip;
}

export interface ModeChipProps extends Omit<ChipProps, "children" | "tone" | "icon" | "onClick"> {
  mode: BusinessMode;
  /** Shown as a tooltip. Default: `modeChipTooltip`. */
  description?: string;
  /** Makes the chip a button (open Settings › What the team can do). */
  onClick?: () => void;
  /**
   * Vacation: agents that follow the business decide on their own while the founder is away (BUILD §9.6), so the chip
   * says so; its label and tooltip say it is the vacation's and what comes back with the founder.
   */
  holiday?: boolean;
  /** The business's spend line (`businesses.spend_cap_minor`); null or absent: each agent's own limit. */
  spendLineMinor?: number | null;
  /** The business's currency, so the line reads "£50" for a GBP business. */
  currency?: string | null;
}

/**
 * What the team can do, on the brand slab: glass, 34 px, the mode's icon and the setting in plain words ("Asks before
 * spending over £50"), so it reads without color. When the bar tightens (KitBarFit `chips-brief`) the words give way to
 * their short form ("Asks over £50"); at `chips-icon` only the icon stays. A button when it opens Settings › What the
 * team can do; the tooltip says what the team does alone and what it asks you first, and where to change it.
 */
export function ModeChip({ mode, description, onClick, holiday, spendLineMinor, currency, className, mono: _mono, dot: _dot, fit: _fit, onRemove: _onRemove, removeLabel: _removeLabel, selected: _selected, ...rest }: ModeChipProps) {
  const inForce: BusinessMode = holiday ? "automated" : mode;
  const info = BUSINESS_MODE_INFO[inForce];
  const words = modeChipWords({ mode, holiday, spendLineMinor, currency });
  // The chip is a button, so its tooltip carries the definition of the spend line rather than a Term (as RunwayChip does).
  const spendLine = useTerm("spend_line");
  const tip = description ?? (spendLine ? (
    <span className="flex flex-col gap-0.5">
      <span>{words.tooltip}</span>
      <span>{`${spendLine.word}: ${spendLine.short.charAt(0).toLowerCase()}${spendLine.short.slice(1)}`}</span>
    </span>
  ) : words.tooltip);
  const common = {
    "aria-label": words.ariaLabel,
    "data-mode": inForce,
    "data-base-mode": holiday ? mode : undefined,
    "data-chip": "",
    className: cn("kitbar-glass", className),
  };
  const content = (
    <>
      <Icon icon={info.icon} size="inline" />
      {/* The whole phrase at the widest step, the short one once the bar tightens; the label and the tooltip keep it all. */}
      <span aria-hidden className={cn("kitbar-chip-word", KITBAR_BRIEF_CLASS)} data-chip-full>
        {words.label}
      </span>
      <span aria-hidden className={KITBAR_BRIEF_ONLY_CLASS} data-chip-brief>
        {words.brief}
      </span>
    </>
  );
  return (
    <Tooltip content={tip}>
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
    <Tooltip content={live ? `Visible on ${APP_NAME} LIVE: network and communities.` : "Personal: private to you and your co-founders."}>
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
