"use client";
/**
 * A 14 px Info icon button in text-3 (docs/UX_AUDIT_AND_PLAN.md §6.2 `InfoTip`): a Tooltip for one sentence, or the
 * definition card when there is somewhere to go (`learn`), the split MetricTile's provenance button already makes.
 * The button is a 24 px target (WCAG 2.5.8) named "About <label>". Hidden when guidance is off, except with
 * `always` (provenance is information, not tutoring).
 */
import type { ReactNode } from "react";
import { CircleHelp, Info } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";
import { DefinitionCard } from "./DefinitionCard";
import { useGuided } from "./GuidanceProvider";

export interface InfoTipProps {
  /** What the tip is about; the button reads "About <label>". */
  label: string;
  /** One sentence. */
  children: ReactNode;
  /** A "Learn more" target: the tip becomes a definition card so the link is reachable. */
  learn?: string;
  /** "tip" (default, an Info icon) or "why" (a question mark: why the product asks for something). */
  kind?: "tip" | "why";
  /** Render even when guidance is off. */
  always?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

export const INFO_TIP_BUTTON_CLASS =
  "inline-flex size-target shrink-0 items-center justify-center rounded-pill text-tertiary transition-colors duration-hover hover:bg-white/6 hover:text-primary focus-ring data-[state=open]:text-primary";

export function InfoTip({ label, children, learn, kind = "tip", always, side = "top", align = "center", className }: InfoTipProps) {
  const guided = useGuided();
  if (!guided && !always) return null;
  const button = (
    <button type="button" aria-label={`About ${label}`} data-info-tip={kind} className={cn(INFO_TIP_BUTTON_CLASS, className)}>
      <Icon icon={kind === "why" ? CircleHelp : Info} size="inline" />
    </button>
  );
  if (learn)
    return (
      <DefinitionCard word={label} short={children} learn={learn} side={side} align={align === "center" ? "start" : align}>
        {button}
      </DefinitionCard>
    );
  return (
    <Tooltip content={children} side={side} align={align}>
      {button}
    </Tooltip>
  );
}
