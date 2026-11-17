"use client";
/**
 * A figure that was not measured (WP-14 T7, Nov 17, 2026; DESIGN §10). The figure itself takes the one estimate
 * style (`est-figure`, a dashed underline) instead of a chip beside it. The word, Estimate or Forecast, opens with its
 * meaning on hover and focus (ProvenanceTip) and is read after the figure by a screen reader, so the button's name is
 * "$3.20 Estimate". The screen's single legend line comes from the nearest `EstimateLegendScope`.
 *
 * Keep `ProvenanceChip` where no single figure carries the estimate (a whole chart or panel) and where the word is
 * spelled out in prose (`appearance="word"`).
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { PROVENANCE_SENTENCE, type ProvenanceKind } from "../foundation/Chip";
import { useRegisterEstimate } from "./EstimateLegend";
import { ProvenanceTip } from "./ProvenanceTip";

export interface EstimatedProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> {
  kind: ProvenanceKind;
  /** The figure, as it would be shown measured. */
  children: ReactNode;
}

/** The word a screen reader hears after an estimated figure, and that the tooltip names. */
export function provenanceWord(kind: ProvenanceKind): "Estimate" | "Forecast" {
  // plain-allow: the word is defined on hover and focus by ProvenanceTip.
  return kind === "forecast" ? "Forecast" : "Estimate";
}

export function Estimated({ kind, children, className, ...rest }: EstimatedProps) {
  useRegisterEstimate();
  return (
    <ProvenanceTip kind={kind} sentence={PROVENANCE_SENTENCE[kind]}>
      <button type="button" data-estimated={kind} className={cn("est-figure in-data-[phone]:tap-reach", className)} {...rest}>
        {children}
        <span className="sr-only"> {provenanceWord(kind)}</span>
      </button>
    </ProvenanceTip>
  );
}
