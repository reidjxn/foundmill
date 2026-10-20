"use client";
/**
 * The explanation behind an Estimate / Forecast chip (finding D3: it was a native `title`). A real Tooltip with the
 * one-sentence meaning, or the definition card when the definitions map holds `estimate` / `forecast` (so "Learn
 * more" can point at connecting a bank). Always shown: provenance is information, not tutoring. ProvenanceChip
 * (foundation/Chip, server-safe) renders the chip and hands it here.
 */
import type { ReactElement } from "react";
import type { ProvenanceKind } from "../foundation/Chip";
import { Tooltip } from "../foundation/Tooltip";
import { DefinitionCard } from "./DefinitionCard";
import { useTerm } from "./GuidanceProvider";

export interface ProvenanceTipProps {
  kind: ProvenanceKind;
  /** The sentence shown when the map has no definition. */
  sentence: string;
  /** The chip (a focusable element). */
  children: ReactElement;
}

export function ProvenanceTip({ kind, sentence, children }: ProvenanceTipProps) {
  const def = useTerm(kind);
  if (def)
    return (
      <DefinitionCard word={def.word} short={def.short} long={def.long} learn={def.learn} side="top">
        {children}
      </DefinitionCard>
    );
  return (
    <Tooltip content={sentence} side="top">
      {children}
    </Tooltip>
  );
}
