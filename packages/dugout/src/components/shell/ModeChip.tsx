import { Hand, Handshake, Globe, Lock, Zap } from "lucide-react";
import type { BusinessMode, GameMode } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import type { ChipProps } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";

export interface BusinessModeInfo {
  word: string;
  icon: IconComponent;
  /** One line from BUILD §9.6: what runs without asking. */
  summary: string;
}

/** Words and icons for the three business modes (BUILD §9.6). Never a bare colour. */
export const BUSINESS_MODE_INFO: Record<BusinessMode, BusinessModeInfo> = {
  augmented: { word: "Augmented", icon: Hand, summary: "Research, drafts and code on branches run alone. Every external action, spend and merge asks first." },
  assisted: { word: "Assisted", icon: Handshake, summary: "Routine external work runs within caps. Above caps, new counterparties, contracts and new campaigns ask first." },
  automated: { word: "Automated", icon: Zap, summary: "Everything within caps runs alone, including Chief of Staff decisions. Hard gates still queue for you." },
};

export interface ModeChipProps extends Omit<ChipProps, "children" | "tone" | "icon" | "onClick"> {
  mode: BusinessMode;
  /** Shown as a tooltip. Default: the mode summary from BUILD §9.6. */
  description?: string;
  /** Makes the chip a button (open Settings › Mode). */
  onClick?: () => void;
  /** Holiday variant: the business is on holiday and runs in Automated mode regardless. */
  holiday?: boolean;
}

/**
 * The business-mode chip on the brand slab: glass, 34 px, icon + word, so the mode reads without colour. A button when
 * it opens Settings › Mode; the tooltip says what runs without asking.
 */
export function ModeChip({ mode, description, onClick, holiday, className, mono: _mono, dot: _dot, fit: _fit, onRemove: _onRemove, removeLabel: _removeLabel, selected: _selected, ...rest }: ModeChipProps) {
  const info = BUSINESS_MODE_INFO[mode];
  const common = {
    "aria-label": `Business mode: ${info.word}${holiday ? ", on holiday" : ""}`,
    "data-mode": mode,
    "data-chip": "",
    className: cn("kitbar-glass", className),
  };
  const content = (
    <>
      <Icon icon={info.icon} size="inline" />
      <span>{holiday ? `${info.word} · Holiday` : info.word}</span>
    </>
  );
  return (
    <Tooltip content={description ?? info.summary}>
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
        <span>{live ? "LIVE" : "Personal"}</span>
      </span>
    </Tooltip>
  );
}
