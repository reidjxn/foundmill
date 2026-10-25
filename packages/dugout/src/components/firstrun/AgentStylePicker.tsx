"use client";
/**
 * AgentStylePicker (founder, 2026-10-24): when anthropomorphic agents are on, which kind of character the team wears.
 * Four radio cards (DESIGN §8), one per `AGENT_STYLES` entry, each with the label and the one-line description from
 * `AGENT_STYLE_META` (Humans, 3D cartoon humans, 2D cartoon humans and animals, Fantasy). Used by Settings › Preferences
 * (saved at once) and by the Launch step of a new business (sent with the commit).
 *
 * Controlled: `onChange` gets the style chosen; the parent saves it. The whole card is the target; arrow keys move
 * between cards and Space selects (the RadioGroup's own keyboard). The picker has no motion of its own beyond the
 * radio's pop, which the design system's reduced-motion rule already turns into an instant change.
 */
import { Box, PenTool, UserRound, Wand } from "lucide-react";
import { useId } from "react";
import { AGENT_STYLES, AGENT_STYLE_META, type AgentStyle } from "@foundmill/shared/personas";
import { cn } from "../../lib/cn";
import type { IconComponent } from "../foundation/Icon";
import { RadioCard, RadioGroup } from "../foundation/RadioGroup";

/** The glyph on each card: a plain person, a solid, a pen, a wand. Decorative; the label names the style. */
const STYLE_ICONS: Record<AgentStyle, IconComponent> = {
  humans: UserRound,
  cartoon_3d: Box,
  cartoon_2d: PenTool,
  fantasy: Wand,
};

/** The group's visible name, and its accessible name. */
export const AGENT_STYLE_LABEL = "Style";

export interface AgentStylePickerProps {
  value: AgentStyle;
  onChange: (style: AgentStyle) => void;
  /** Nothing can be chosen (a save is on its way, or the form is busy). */
  disabled?: boolean;
  /** Prefix for the cards' ids and `data-testid`s (`<testIdPrefix>-<style>`); default "agent-style". */
  testIdPrefix?: string;
  className?: string;
}

export function AgentStylePicker({ value, onChange, disabled, testIdPrefix = "agent-style", className }: AgentStylePickerProps) {
  const legend = useId();
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid={`${testIdPrefix}-picker`}>
      <h3 id={legend} className="t-label">
        {AGENT_STYLE_LABEL}
      </h3>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          if ((AGENT_STYLES as readonly string[]).includes(next)) onChange(next as AgentStyle);
        }}
        aria-labelledby={legend}
        disabled={disabled}
        className="grid-cols-2"
      >
        {AGENT_STYLES.map((style) => (
          <RadioCard key={style} value={style} label={AGENT_STYLE_META[style].label} description={AGENT_STYLE_META[style].description} icon={STYLE_ICONS[style]} data-testid={`${testIdPrefix}-${style}`} />
        ))}
      </RadioGroup>
    </div>
  );
}
