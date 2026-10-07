import { Hand, Handshake, Globe, Lock, Zap } from "lucide-react";
import type { BusinessMode, GameMode } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { Chip, type ChipProps } from "../foundation/Chip";
import type { IconComponent } from "../foundation/Icon";
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

/** The business-mode chip in the top bar. Icon + word, so the mode reads without colour. */
export function ModeChip({ mode, description, onClick, holiday, ...rest }: ModeChipProps) {
  const info = BUSINESS_MODE_INFO[mode];
  const chip = (
    <Chip tone="ink" icon={info.icon} onClick={onClick} aria-label={`Business mode: ${info.word}${holiday ? ", on holiday" : ""}`} data-mode={mode} {...rest}>
      {holiday ? `${info.word} · Holiday` : info.word}
    </Chip>
  );
  return <Tooltip content={description ?? info.summary}>{chip}</Tooltip>;
}

export interface GameModeChipProps extends Omit<ChipProps, "children" | "tone" | "icon"> {
  mode: GameMode;
}

/** LIVE (public on the network) or Personal (private). */
export function GameModeChip({ mode, ...rest }: GameModeChipProps) {
  const live = mode === "live";
  return (
    <Tooltip content={live ? `Visible on ${APP_NAME} LIVE: network, communities and leaderboards.` : "Personal: private to you and your co-founders."}>
      <Chip tone={live ? "kit" : "ink"} icon={live ? Globe : Lock} aria-label={live ? "Game mode: LIVE" : "Game mode: Personal"} data-game-mode={mode} {...rest}>
        {live ? "LIVE" : "Personal"}
      </Chip>
    </Tooltip>
  );
}
